import { randomBytes } from 'node:crypto';
import { assert, audit, email, roles, text, transaction } from './security.mjs';

export function accountService(pool, auth) {
  return {
    async grant(userId) {
      const { rows: [grant] } = await pool.query(`SELECT g.user_id AS "userId",g.profile_id AS "profileId",g.role,p.name AS "profileName"
        FROM bo_grants g JOIN public.profiles p ON p.id=g.profile_id WHERE g.user_id=$1 AND g.active=true AND p.active=1`, [userId]);
      return grant;
    },
    async activate(user) {
      await transaction(pool, async db => {
        await db.query('UPDATE bo_user SET "emailVerified"=true WHERE id=$1', [user.id]);
        // Invalidate all older reset/challenge/trusted-device tokens as well as sessions.
        await db.query('DELETE FROM bo_verification WHERE value=$1', [user.id]);
        await audit(db, { userId: user.id }, 'PASSWORD_RESET', user.id);
      });
    },
    async emailChanged(user) {
      await transaction(pool,async db=>{
        await db.query('DELETE FROM bo_session WHERE "userId"=$1',[user.id]);
        await db.query('DELETE FROM bo_verification WHERE value=$1',[user.id]);
        const {rows:[grant]}=await db.query('SELECT profile_id FROM bo_grants WHERE user_id=$1',[user.id]);
        await audit(db,{userId:user.id,profileId:grant?.profile_id},'EMAIL_CHANGED',user.id);
      });
    },
    async invite(actor, input, provisioningAuth) {
      const targetEmail = email(input.email), name = text(input.name, 'Name');
      assert(Object.hasOwn(roles, input.role), 400, 'Ungültige Berechtigung.');
      // User creation is server-only on this separate provisioning instance; its handler is never mounted.
      const { rows: [existing] } = await pool.query('SELECT u.id,u."emailVerified",g.user_id FROM bo_user u LEFT JOIN bo_grants g ON g.user_id=u.id WHERE u.email=$1', [targetEmail]);
      assert(!existing || (!existing.emailVerified && !existing.user_id), 409, 'Diese Person besitzt bereits ein Verwaltungskonto. Gegebenenfalls Passwort zurücksetzen oder Zugriff reaktivieren.');
      const result = existing ? { user: existing } : await provisioningAuth.api.signUpEmail({ body: { email: targetEmail, name, password: randomBytes(48).toString('base64url') } });
      await transaction(pool, async db => {
        await db.query('INSERT INTO bo_grants (user_id,profile_id,role) VALUES ($1,$2,$3)', [result.user.id, actor.profileId, input.role]);
        await audit(db, actor, 'ACCOUNT_INVITED', result.user.id, { role: input.role });
      });
      await auth.api.requestPasswordReset({ body: { email: targetEmail } });
      return { ok: true, message: 'Einladung für den Versand vorgemerkt. Der Mailstatus zeigt die Zustellung.' };
    },
    async change(actor, id, input) {
      assert(typeof input.active === 'boolean' && Object.hasOwn(roles, input.role), 400, 'Ungültige Berechtigung.');
      assert(actor.userId !== id, 409, 'Den eigenen Zugang bitte durch einen anderen Vorstand ändern lassen.');
      return transaction(pool, async db => {
        // Serialize administrative changes, including removal of the last active administrator.
        const { rows } = await db.query('SELECT * FROM bo_grants WHERE profile_id=$1 FOR UPDATE', [actor.profileId]);
        const target = rows.find(row => row.user_id === id);
        assert(target, 404, 'Konto nicht gefunden.');
        if (target.role === 'admin' && target.active && (!input.active || input.role !== 'admin')) {
          assert(rows.some(row => row.user_id !== id && row.active && row.role === 'admin'), 409, 'Mindestens ein aktiver Vorstand muss erhalten bleiben.');
        }
        await db.query('UPDATE bo_grants SET role=$1,active=$2,updated_at=now() WHERE user_id=$3', [input.role, input.active, id]);
        await db.query('DELETE FROM bo_session WHERE "userId"=$1', [id]);
        await db.query('DELETE FROM bo_verification WHERE value=$1', [id]);
        await audit(db, actor, 'ACCESS_CHANGED', id, { from: { role: target.role, active: target.active }, to: input });
        return { ok: true };
      });
    },
  };
}
