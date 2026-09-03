import {assert,audit,email} from './security.mjs';

// Only mounted behind a full, active MFA session. Raw Better Auth email endpoints
// remain inaccessible, so a mail link alone can never create a logged-in session.
export function emailChangeService({auth,limiter,pool,config}) {
  async function rate(actor) {
    assert((await limiter.consume(`email-change:${actor.userId}`,{window:900,max:10})).allowed,429,'Zu viele Versuche. Bitte 15 Minuten warten.');
  }
  return {
    async start(actor,headers,input) {
      await rate(actor);
      const newEmail=email(input.newEmail);
      assert(newEmail!==actor.email,400,'Bitte eine andere E-Mail-Adresse eingeben.');
      assert(typeof input.password==='string' && input.password.length<=128,400,'Bitte dein aktuelles Passwort eingeben.');
      try { await auth.api.verifyPassword({headers,body:{password:input.password}}); }
      catch { assert(false,400,'Das aktuelle Passwort stimmt nicht. Bitte erneut eingeben.'); }
      // Deliberately return the same result for an already occupied destination.
      await auth.api.changeEmail({headers,body:{newEmail}});
      await audit(pool,actor,'EMAIL_CHANGE_REQUESTED',actor.userId);
      return {ok:true,message:'Wenn die neue Adresse verfügbar ist, erhältst du zuerst eine Bestätigung an deine bisherige Adresse. Danach bestätigst du die neue Adresse. Bis dahin bleibt alles unverändert.'};
    },
    async confirm(actor,headers,input) {
      await rate(actor);
      assert(['current','new'].includes(input.stage) && typeof input.token==='string' && input.token.length<=4096,400,'Ungültiger Bestätigungslink.');
      const {internalAdapter}=await auth.$context, identifier=`bo-email-${input.stage}-${input.token}`;
      const pending=await internalAdapter.findVerificationValue(identifier);
      assert(pending?.value===actor.userId && new Date(pending.expiresAt).getTime()>Date.now(),400,'Dieser Link ist abgelaufen, gehört zu einem anderen Konto oder wurde bereits verwendet.');
      const claim=await internalAdapter.consumeVerificationValue(identifier);
      assert(claim?.value===actor.userId,400,'Dieser Link wurde bereits verwendet.');
      try { await auth.api.verifyEmail({headers,query:{token:input.token}}); }
      catch { assert(false,400,'Die Adresse konnte nicht bestätigt werden. Bitte die Änderung unter „Mein Konto“ erneut anfordern.'); }
      if(input.stage==='current')return {ok:true,message:'Bisherige Adresse bestätigt. Öffne jetzt das neue Postfach und bestätige dort den zweiten Link.'};
      const legacy=(config.cashManagerRecipients||[]).includes(actor.email);
      return {ok:true,signInAgain:true,message:`Neue E-Mail-Adresse gespeichert. Bitte mit der neuen Adresse, deinem bisherigen Passwort und dem zweiten Faktor anmelden.${legacy?' Deine alte Adresse ist zusätzlich im allgemeinen Kassenwart-Verteiler hinterlegt. Bitte den Vorstand bitten, diesen auf der Wartungsseite zu ändern.':''}`};
    }
  };
}
