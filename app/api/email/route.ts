import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { requireRole } from "../session";
import { GET as monthlyReport } from "../monthly/route";
import { sendSmtpMessage, smtpPublicStatus, verifySmtp } from "../../email-smtp";

type EmailMember={id:string;name:string;invoiceEmail:string|null;invoiceEmailConsentAt:string|null};
type Closure={statementNumber:string;snapshotJson:string;closedAt:string};
type SentAudit={detailsJson:string;createdAt:string};
type MonthlyPerson={memberId:string;memberName:string;closingBalance:number;children?:MonthlyPerson[]};
type MonthlySnapshot={label:string;dueLabel:string;people:MonthlyPerson[]};
const monthValid=(value:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const emailValid=(value:string)=>value.length<=254&&!/[\r\n]/.test(value)&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
const safeHeader=(value:string)=>value.replace(/[\r\n]+/g," ").trim().slice(0,180);
const money=(value:number)=>Number(value||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const safeError=(error:unknown)=>{
  const message=error instanceof Error?error.message:"";
  if(message==="SMTP_NOT_CONFIGURED")return "Der E-Mail-Versand ist auf dem Raspberry noch nicht eingerichtet.";
  if(message==="SMTP_RUNTIME_UNAVAILABLE")return "E-Mail-Versand steht nur auf dem Raspberry zur Verfügung.";
  if(/auth|credential|login|535/i.test(message))return "Der Mailserver hat die Anmeldung abgelehnt. Bitte SMTP-Zugang prüfen.";
  if(/timeout|timed out|connect|socket|dns|enotfound|econn/i.test(message))return "Der Mailserver ist derzeit nicht erreichbar.";
  return "Die Rechnung konnte nicht per E-Mail versendet werden.";
};
const personFrom=(snapshot:MonthlySnapshot,memberId:string)=>snapshot.people.find(person=>person.memberId===memberId)||snapshot.people.flatMap(person=>person.children||[]).find(person=>person.memberId===memberId);

export async function GET(request:Request){
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
  return Response.json({...smtpPublicStatus(),members:memberRows.results.map(member=>({memberId:member.id,emailAddress:member.invoiceEmail,optIn:Boolean(member.invoiceEmailConsentAt),lastSentAt:lastSent.get(member.id)||null}))},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const [user,profile]=await Promise.all([requireRole(request,["Kassenwart","Vorstand"]),requireProfile(request)]);
  if(!user||!profile)return Response.json({error:"Nur Kassenwart oder Vorstand dürfen Rechnungen per E-Mail senden."},{status:403});
  let body:{action?:string;month?:string;memberId?:string;confirmation?:string};
  try{body=await request.json() as typeof body}catch{return Response.json({error:"Ungültige Anfrage"},{status:400})}
  if(body.action==="verify"){
    try{await verifySmtp();return Response.json({ok:true,message:"Verbindung zum Mailserver ist bereit."})}catch(error){return Response.json({error:safeError(error)},{status:503})}
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
