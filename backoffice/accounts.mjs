import { randomBytes } from 'node:crypto';
import { assert, audit, email, roles, text, transaction } from './security.mjs';

export function accountService(pool, auth) {
  async function targetForChange(db, actor, id) {
    assert(actor.userId !== id, 409, 'Den eigenen Zugang bitte durch einen anderen Vorstand ändern lassen.');
    // Lock in a stable order, then recheck the actor: a parallel demotion must not
    // leave a previously authorized request able to remove the remaining admin.
    const { rows } = await db.query('SELECT * FROM bo_grants WHERE profile_id=$1 ORDER BY user_id FOR UPDATE', [actor.profileId]);
    const current = rows.find(row => row.user_id === actor.userId);
    assert(current?.active && current.role === 'admin', 403, 'Deine Vorstandsfreigabe ist nicht mehr aktiv. Bitte neu anmelden.');
    const target = rows.find(row => row.user_id === id);
    assert(target, 404, 'Konto nicht gefunden.');
    return { target, rows };
  }
  async function revokeAccess(db, actor, id) {
    await db.query('DELETE FROM bo_session WHERE "userId"=$1', [id]);
    await db.query('DELETE FROM bo_verification WHERE value=$1', [id]);
    // Revoke queued report jobs too. A message already handed to SMTP cannot be
    // recalled; do not pretend to cancel an in-flight delivery.
    await db.query(`UPDATE bo_outbox SET state='cancelled',payload=NULL,finished_at=now()
      WHERE state='pending' AND EXISTS (SELECT 1 FROM bo_audit a
        WHERE a.entity=bo_outbox.id AND a.profile_id=$1 AND a.action='REPORT_MAIL_QUEUED'
          AND (a.user_id=$2 OR a.details->>'recipientEmail'=(SELECT email FROM bo_user WHERE id=$2)))`, [actor.profileId, id]);
  }
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
      assert(typeof input.active === 'boolean' && (input.role === undefined || Object.hasOwn(roles, input.role)), 400, 'Ungültige Berechtigung.');
      return transaction(pool, async db => {
        const { target, rows } = await targetForChange(db, actor, id);
        const role = input.role ?? target.role;
        if (target.role === 'admin' && target.active && (!input.active || role !== 'admin')) {
          assert(rows.some(row => row.user_id !== id && row.active && row.role === 'admin'), 409, 'Mindestens ein aktiver Vorstand muss erhalten bleiben.');
        }
        await db.query('UPDATE bo_grants SET role=$1,active=$2,updated_at=now() WHERE user_id=$3', [role, input.active, id]);
        await revokeAccess(db, actor, id);
        await audit(db, actor, 'ACCESS_CHANGED', id, { from: { role: target.role, active: target.active }, to: { role, active: input.active } });
        return { ok: true };
      });
    },
    async remove(actor, id, input) {
      assert(input.confirmed === true, 400, 'Bitte das Löschen ausdrücklich bestätigen.');
      const confirmation = email(input.email);
      return transaction(pool, async db => {
        const { target, rows } = await targetForChange(db, actor, id);
        if (target.role === 'admin' && target.active) {
          assert(rows.some(row => row.user_id !== id && row.active && row.role === 'admin'), 409, 'Mindestens ein aktiver Vorstand muss erhalten bleiben.');
        }
        const { rows: [user] } = await db.query('SELECT email FROM bo_user WHERE id=$1 FOR UPDATE', [id]);
        assert(user?.email === confirmation, 409, 'Die Bestätigungsadresse stimmt nicht. Bitte den Dialog neu öffnen.');
        await revokeAccess(db, actor, id);
        await audit(db, actor, 'ACCOUNT_DELETED', id, { role: target.role, wasActive: target.active });
        // FK cascades remove only credentials, MFA, sessions and the grant. Audit,
        // invoice notes, financial records and membership are intentionally kept.
        await db.query('DELETE FROM bo_user WHERE id=$1', [id]);
        return { ok: true, message: 'Verwaltungszugang gelöscht. Mitgliedsdaten und Rechnungen bleiben erhalten. Cloudflare-Freigabe und separate E-Mail-Verteiler bitte ebenfalls prüfen.' };
      });
    },
  };
}
