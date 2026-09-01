import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { requireRole } from "../session";
import { GET as monthlyReport } from "../monthly/route";
import { sendSmtpMessage, smtpCashManagerRecipients, smtpPublicStatus, verifySmtp } from "../../email-smtp";
import { monthlyCashManagerLastSent, sendMonthlyCashManagerReport } from "../../monthly-cash-manager-email";

type EmailMember={id:string;name:string;invoiceEmail:string|null;invoiceEmailConsentAt:string|null};
type Closure={statementNumber:string;snapshotJson:string;closedAt:string};
type SentAudit={detailsJson:string;createdAt:string};
type MonthlyPerson={memberId:string;memberName:string;closingBalance:number;children?:MonthlyPerson[]};
type MonthlySnapshot={label:string;dueLabel:string;people:MonthlyPerson[]};
const monthValid=(value:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const emailValid=(value:string)=>value.length<=254&&!/[\r\n]/.test(value)&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
const safeHeader=(value:string)=>value.replace(/[\r\n]+/g," ").trim().slice(0,180);
const safeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]||character));
const money=(value:number)=>Number(value||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const safeError=(error:unknown)=>{
  const message=error instanceof Error?error.message:"";
  if(message==="SMTP_NOT_CONFIGURED")return "Der E-Mail-Versand ist auf dem Raspberry noch nicht eingerichtet.";
  if(message==="SMTP_RUNTIME_UNAVAILABLE")return "E-Mail-Versand steht nur auf dem Raspberry zur Verfügung.";
  if(message==="NO_CASH_MANAGER_RECIPIENTS")return "In der Wartungsseite ist noch keine Kassenwart-Adresse eingetragen.";
  if(message==="MONTH_NOT_CLOSED")return "Der Monat muss vor dem Versand festgeschrieben werden.";
  if(message==="MONTHLY_REPORT_RECENTLY_SENT")return "Dieser Monatsabschluss wurde gerade bereits versendet. Bitte eine Minute warten.";
  if(/auth|credential|login|535/i.test(message))return "Der Mailserver hat die Anmeldung abgelehnt. Bitte SMTP-Zugang prüfen.";
  if(/timeout|timed out|connect|socket|dns|enotfound|econn/i.test(message))return "Der Mailserver ist derzeit nicht erreichbar.";
  return "Die Rechnung konnte nicht per E-Mail versendet werden.";
};
const personFrom=(snapshot:MonthlySnapshot,memberId:string)=>snapshot.people.find(person=>person.memberId===memberId)||snapshot.people.flatMap(person=>person.children||[]).find(person=>person.memberId===memberId);

export async function GET(request:Request){
  try{
    const [user,profile]=await Promise.all([requireRole(request,["Kassenwart","Vorstand"]),requireProfile(request)]);
    if(!user||!profile)return Response.json({error:"Nur Kassenwart oder Vorstand dürfen E-Mail-Rechnungen verwalten."},{status:403});
    const month=new URL(request.url).searchParams.get("month")||"";
    if(month&&!monthValid(month))return Response.json({error:"Ungültiger Monat"},{status:400});
    const [memberRows,audits]=await Promise.all([
      env.DB.prepare("SELECT id,name,invoice_email invoiceEmail,invoice_email_consent_at invoiceEmailConsentAt FROM members ORDER BY name").all<EmailMember>(),
      month?env.DB.prepare("SELECT details_json detailsJson,created_at createdAt FROM audit_logs WHERE action='MONTHLY_INVOICE_EMAIL_SENT' ORDER BY created_at DESC LIMIT 1000").all<SentAudit>():Promise.resolve({results:[]} as {results:SentAudit[]})
    ]);
    const lastSent=new Map<string,string>();
    for(const audit of audits.results){try{const details=JSON.parse(audit.detailsJson) as {profileId?:string;month?:string;memberId?:string};if(details.profileId===profile.id&&details.month===month&&details.memberId&&!lastSent.has(details.memberId))lastSent.set(details.memberId,audit.createdAt)}catch{}}
    const cashManagerRecipients=smtpCashManagerRecipients(),cashManagerLastSentAt=month?await monthlyCashManagerLastSent(profile.id,month):null;
    return Response.json({...smtpPublicStatus(),cashManagerRecipients,cashManagerLastSentAt,members:memberRows.results.map(member=>({memberId:member.id,emailAddress:member.invoiceEmail,optIn:Boolean(member.invoiceEmailConsentAt),lastSentAt:lastSent.get(member.id)||null}))},{headers:{"cache-control":"no-store"}});
  }catch(error){
    console.error("E-Mail-Status konnte nicht geladen werden",error);
    return Response.json({error:"Der E-Mail-Status konnte nicht geladen werden. Die Monatsabrechnung bleibt weiterhin nutzbar."},{status:500,headers:{"cache-control":"no-store"}});
  }
}

export async function POST(request:Request){
  const [user,profile]=await Promise.all([requireRole(request,["Kassenwart","Vorstand"]),requireProfile(request)]);
  if(!user||!profile)return Response.json({error:"Nur Kassenwart oder Vorstand dürfen Rechnungen per E-Mail senden."},{status:403});
  let body:{action?:string;month?:string;memberId?:string;confirmation?:string};
  try{body=await request.json() as typeof body}catch{return Response.json({error:"Ungültige Anfrage"},{status:400})}
  if(body.action==="verify"){
    try{await verifySmtp();return Response.json({ok:true,message:"Verbindung zum Mailserver ist bereit."})}catch(error){return Response.json({error:safeError(error)},{status:503})}
  }
  if(body.action==="send_test"){
    const recipients=smtpCashManagerRecipients();
    if(!recipients.length)return Response.json({error:safeError(new Error("NO_CASH_MANAGER_RECIPIENTS"))},{status:409});
    const now=new Date(),sentAt=now.toISOString(),subject=safeHeader(`Clubiq Ledger · Test-E-Mail · ${profile.name}`);
    const text=["Clubiq Ledger – Test-E-Mail","",`Profil: ${profile.name}`,`Versendet: ${now.toLocaleString("de-DE",{timeZone:"Europe/Berlin"})}`,"","Der E-Mail-Versand ist richtig eingerichtet.","Diese technische Testnachricht enthält keine Abrechnungs- oder Mitgliederdaten.","Auch wenn noch keine Buchungen vorhanden sind, kann Clubiq Ledger E-Mails versenden."].join("\n");
    const html=`<!doctype html><html lang="de"><body style="margin:0;background:#f4f2ec;color:#17201d;font-family:Arial,sans-serif"><main style="max-width:620px;margin:24px auto;padding:28px;background:#fff;border-top:6px solid #b79550"><p style="margin:0 0 8px;color:#80662f;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Clubiq Ledger</p><h1 style="margin:0 0 20px;font-size:26px">Test-E-Mail erfolgreich</h1><p>Der E-Mail-Versand für <strong>${safeHtml(profile.name)}</strong> ist richtig eingerichtet.</p><div style="margin:22px 0;padding:16px;background:#edf6f1;border-left:4px solid #1d5b4c"><strong>Keine Abrechnungsdaten enthalten</strong><br><span style="color:#53615b">Diese Nachricht prüft ausschließlich den technischen Versand. Sie enthält keine Buchungen oder Mitgliederdaten.</span></div><p style="font-size:13px;color:#68766f">Versendet am ${safeHtml(now.toLocaleString("de-DE",{timeZone:"Europe/Berlin"}))}</p></main></body></html>`;
    const messageIds:string[]=[];
    try{
      for(const recipient of recipients){const sent=await sendSmtpMessage({to:recipient,replyTo:recipient,subject,text,html});if(sent.messageId)messageIds.push(sent.messageId)}
      await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"SMTP_TEST_EMAIL_SENT","email_settings",profile.id,user.id,JSON.stringify({profileId:profile.id,recipientCount:recipients.length,recipientDomains:recipients.map(address=>address.split("@")[1]),messageIds}),sentAt).run();
      return Response.json({ok:true,recipients:recipients.length,sentAt,message:`Test-E-Mail wurde an ${recipients.length} Kassenwart${recipients.length===1?"":"e"} gesendet.`});
    }catch(error){
      console.error("Test-E-Mail fehlgeschlagen",error);
      await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"SMTP_TEST_EMAIL_FAILED","email_settings",profile.id,user.id,JSON.stringify({profileId:profile.id,recipientCount:recipients.length}),sentAt).run();
      return Response.json({error:safeError(error)},{status:502});
    }
  }
  if(body.action==="send_cash_manager_summary"){
    if(!body.month||!monthValid(body.month))return Response.json({error:"Ein gültiger Abrechnungsmonat fehlt."},{status:400});
    if(body.confirmation!=="MONATSABSCHLUSS SENDEN")return Response.json({error:"Der Versand muss ausdrücklich bestätigt werden."},{status:400});
    try{return Response.json(await sendMonthlyCashManagerReport({profileId:profile.id,profileName:profile.name,month:body.month,operatorId:user.id,mode:"manual"}))}
    catch(error){console.error("Kassenwart-Monatsversand fehlgeschlagen",error);return Response.json({error:safeError(error)},{status:502})}
  }
  if(body.action!=="send_invoice"||!body.month||!monthValid(body.month)||!body.memberId)return Response.json({error:"Monat und Mitglied fehlen."},{status:400});
  if(body.confirmation!=="RECHNUNG SENDEN")return Response.json({error:"Der Versand muss ausdrücklich bestätigt werden."},{status:400});
  const [closure,member]=await Promise.all([
    env.DB.prepare("SELECT statement_number statementNumber,snapshot_json snapshotJson,closed_at closedAt FROM monthly_closures WHERE profile_id=? AND month=?").bind(profile.id,body.month).first<Closure>(),
    env.DB.prepare("SELECT id,name,invoice_email invoiceEmail,invoice_email_consent_at invoiceEmailConsentAt FROM members WHERE id=?").bind(body.memberId).first<EmailMember>()
  ]);
  if(!closure)return Response.json({error:"Der Monat muss vor dem E-Mail-Versand festgeschrieben werden."},{status:409});
  if(!member)return Response.json({error:"Mitglied nicht gefunden."},{status:404});
  if(!member.invoiceEmailConsentAt||!member.invoiceEmail||!emailValid(member.invoiceEmail))return Response.json({error:"Für dieses Mitglied ist keine freigegebene Rechnungsadresse hinterlegt."},{status:409});
  const recent=await env.DB.prepare("SELECT created_at createdAt FROM audit_logs WHERE action='MONTHLY_INVOICE_EMAIL_SENT' AND entity_type='monthly_invoice' AND entity_id=? ORDER BY created_at DESC LIMIT 1").bind(`${body.month}:${member.id}`).first<{createdAt:string}>();
  if(recent&&Date.now()-new Date(recent.createdAt).getTime()<60_000)return Response.json({error:"Diese Rechnung wurde gerade bereits versendet. Bitte eine Minute warten, bevor sie erneut gesendet wird."},{status:409});
  const snapshot=JSON.parse(closure.snapshotJson) as MonthlySnapshot,person=personFrom(snapshot,member.id);
  if(!person)return Response.json({error:"Für dieses Mitglied gibt es in diesem Monat keine Rechnung."},{status:404});
  const reportUrl=new URL(request.url);reportUrl.pathname="/api/monthly";reportUrl.search="";reportUrl.searchParams.set("month",body.month);reportUrl.searchParams.set("memberId",member.id);
  const report=await monthlyReport(new Request(reportUrl,{headers:request.headers}));
  if(!report.ok)return report;
  const invoiceHtml=(await report.text()).replace(/<button[^>]*onclick="print\(\)"[^>]*>[\s\S]*?<\/button>/gi,"").replace("</html>",`<p style="margin-top:28px;font-size:12px;color:#68766f">Diese Nachricht wurde am ${new Date().toLocaleString("de-DE")} von Clubiq Ledger erstellt.</p></html>`);
  const subject=safeHeader(`Monatsabrechnung ${snapshot.label} · ${profile.name}`);
  const text=[`Hallo ${member.name},`,``,`anbei erhältst du deine Monatsabrechnung für ${snapshot.label}.`,`Rechnungsnummer: ${closure.statementNumber}`,`Stand Monatsende: ${money(person.closingBalance)}`,person.closingBalance>.005?`Zahlbar bis: ${snapshot.dueLabel}`:"Die Rechnung ist bereits ausgeglichen.",``,`Viele Grüße`,profile.name].join("\n");
  const now=new Date().toISOString();
  try{
    const sent=await sendSmtpMessage({to:member.invoiceEmail,subject,text,html:invoiceHtml});
    await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MONTHLY_INVOICE_EMAIL_SENT","monthly_invoice",`${body.month}:${member.id}`,user.id,JSON.stringify({profileId:profile.id,month:body.month,memberId:member.id,statementNumber:closure.statementNumber,messageId:sent.messageId,recipientDomain:member.invoiceEmail.split("@")[1]}),now).run();
    return Response.json({ok:true,sentAt:now,messageId:sent.messageId});
  }catch(error){
    console.error("Rechnungsversand fehlgeschlagen",error);
    await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MONTHLY_INVOICE_EMAIL_FAILED","monthly_invoice",`${body.month}:${member.id}`,user.id,JSON.stringify({profileId:profile.id,month:body.month,memberId:member.id,statementNumber:closure.statementNumber}),now).run();
    return Response.json({error:safeError(error)},{status:502});
  }
}
