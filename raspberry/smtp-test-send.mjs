import fs from "node:fs";
import nodemailer from "nodemailer";

const required=name=>{const value=process.env[name]?.trim();if(!value)throw new Error(`SMTP_NOT_CONFIGURED:${name}`);return value};
const passwordFile=required("CLUBIQ_SMTP_PASSWORD_FILE");
const password=fs.readFileSync(passwordFile,"utf8").trim();
if(!password)throw new Error("SMTP_NOT_CONFIGURED:PASSWORD");
const recipients=(process.env.CLUBIQ_SMTP_REPLY_TO||"").split(",").map(value=>value.trim()).filter(Boolean);
if(!recipients.length)throw new Error("NO_CASH_MANAGER_RECIPIENTS");
const security=(process.env.CLUBIQ_SMTP_SECURITY||"starttls").trim();
const profileName=(process.env.CLUBIQ_PROFILE_NAME||"Vereinskasse").trim();
const sentAt=new Date();
const transport=nodemailer.createTransport({
  host:required("CLUBIQ_SMTP_HOST"),
  port:Number(required("CLUBIQ_SMTP_PORT")),
  secure:security==="tls",
  requireTLS:security==="starttls",
  auth:{user:required("CLUBIQ_SMTP_USER"),pass:password},
  tls:{minVersion:"TLSv1.2"},
  disableFileAccess:true,
  disableUrlAccess:true
});
for(const recipient of recipients){
  await transport.sendMail({
    from:required("CLUBIQ_SMTP_FROM"),
    to:recipient,
    replyTo:recipient,
    subject:`Clubiq Ledger · Test-E-Mail · ${profileName}`.replace(/[\r\n]+/g," ").slice(0,180),
    text:["Clubiq Ledger – Test-E-Mail","","Der E-Mail-Versand ist richtig eingerichtet.","Diese technische Testnachricht enthält keine Abrechnungs- oder Mitgliederdaten.",`Versendet: ${sentAt.toLocaleString("de-DE",{timeZone:"Europe/Berlin"})}`].join("\n"),
    html:`<!doctype html><html lang="de"><body style="font-family:Arial,sans-serif;background:#f4f2ec;color:#17201d"><main style="max-width:620px;margin:24px auto;padding:28px;background:#fff;border-top:6px solid #b79550"><h1>Test-E-Mail erfolgreich</h1><p>Der E-Mail-Versand ist richtig eingerichtet.</p><p style="padding:16px;background:#edf6f1;border-left:4px solid #1d5b4c"><strong>Keine Abrechnungsdaten enthalten</strong><br>Diese Nachricht prüft ausschließlich den technischen Versand.</p></main></body></html>`
  });
}
console.log(`Test-E-Mail wurde an ${recipients.length} Kassenwart${recipients.length===1?"":"e"} gesendet.`);
