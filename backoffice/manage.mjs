import {loadConfig,connectDatabase} from './config.mjs';
import {migrate} from './migrate.mjs';
import {createAuth} from './auth.mjs';
import {createOutbox} from './mailer.mjs';
import {rateStorage,assert,audit,transaction,email} from './security.mjs';
import {accountService} from './accounts.mjs';

const [command,...args]=process.argv.slice(2),config=loadConfig(),pool=connectDatabase(config);
try{
  if(command==='migrate'){await migrate(pool);console.log('Verwaltungsschema geprüft und aktualisiert.');}
  else if(command==='invite'){
    const [address,name,profileId,role='admin']=args;
    assert(address&&name&&profileId,400,'Aufruf: npm run invite -- E-MAIL "Vor- Nachname" PROFIL-ID [admin|treasurer|viewer]');
    const {rows:[profile]}=await pool.query('SELECT id FROM public.profiles WHERE id=$1 AND active=1',[profileId]);
    assert(profile,400,'Aktives Kassenprofil nicht gefunden.');
    const outbox=createOutbox(pool,config),limiter=rateStorage(pool,config.secret);
    const dependencies={database:pool,config,outbox,limiter};
    const auth=createAuth(dependencies),provisioningAuth=createAuth({...dependencies,provisioning:true}),accounts=accountService(pool,auth);
    await accounts.invite({userId:null,profileId}, {email:address,name,role},provisioningAuth);
    await outbox.deliver();console.log('Einladung angelegt. Mailstatus bei ausbleibender E-Mail prüfen.');
  }else if(command==='recover-mfa'){
    const [address,confirm]=args;
    assert(confirm==='IDENTITAET-GEPRUEFT',400,'Nur nach persönlicher Identitätsprüfung: node manage.mjs recover-mfa E-MAIL IDENTITAET-GEPRUEFT');
    await transaction(pool,async db=>{
      const {rows:[user]}=await db.query('SELECT id FROM bo_user WHERE email=$1 FOR UPDATE',[email(address)]);
      assert(user,404,'Konto nicht gefunden.');
      await db.query('DELETE FROM bo_session WHERE "userId"=$1',[user.id]);
      await db.query('DELETE FROM bo_verification WHERE value=$1',[user.id]);
      await db.query('DELETE FROM bo_two_factor WHERE "userId"=$1',[user.id]);
      // Invalidate the old password as well. A new single-use reset link is required.
      await db.query('UPDATE bo_user SET "twoFactorEnabled"=false,"emailVerified"=false WHERE id=$1',[user.id]);
      await audit(db,{userId:null},'MFA_RECOVERY_BY_LOCAL_OPERATOR',user.id);
    });
    const outbox=createOutbox(pool,config),auth=createAuth({database:pool,config,outbox,limiter:rateStorage(pool,config.secret)});
    await auth.api.requestPasswordReset({body:{email:email(address)}});await outbox.deliver();
    console.log('Alle Anmeldungen beendet. Erneute Aktivierung per E-Mail und Einrichtung eines zweiten Faktors erforderlich.');
  }else throw new Error('Erlaubte Befehle: migrate, invite, recover-mfa');
}catch(error){console.error(error.status?error.message:'Verwaltungseinrichtung fehlgeschlagen. Datenbank, Schema und Secret-Dateien prüfen.');process.exitCode=1;}
finally{await pool.end();}
