import { env } from "cloudflare:workers";
import { sendSmtpMessage, smtpCashManagerRecipients } from "./email-smtp";
import { buildCashManagerReport, type CashManagerSnapshot } from "./monthly-cash-manager-report";

type Closure={statementNumber:string;snapshotJson:string};
export type MonthlyReportMode="manual"|"automatic";

export async function monthlyCashManagerLastSent(profileId:string,month:string){
  const row=await env.DB.prepare("SELECT created_at createdAt FROM audit_logs WHERE action='MONTHLY_CASH_MANAGER_EMAIL_SENT' AND entity_type='monthly_closure' AND entity_id=? ORDER BY created_at DESC LIMIT 1").bind(`${profileId}:${month}`).first<{createdAt:string}>();
  return row?.createdAt||null;
}

export async function sendMonthlyCashManagerReport(input:{profileId:string;profileName:string;month:string;operatorId:string;mode:MonthlyReportMode}){
  const recipients=smtpCashManagerRecipients();
  if(!recipients.length)throw new Error("NO_CASH_MANAGER_RECIPIENTS");
  const closure=await env.DB.prepare("SELECT statement_number statementNumber,snapshot_json snapshotJson FROM monthly_closures WHERE profile_id=? AND month=?").bind(input.profileId,input.month).first<Closure>();
  if(!closure)throw new Error("MONTH_NOT_CLOSED");
  const lastSentAt=await monthlyCashManagerLastSent(input.profileId,input.month);
  if(input.mode==="automatic"&&lastSentAt)return {ok:true,skipped:true,lastSentAt,recipients:recipients.length};
  if(input.mode==="manual"&&lastSentAt&&Date.now()-new Date(lastSentAt).getTime()<60_000)throw new Error("MONTHLY_REPORT_RECENTLY_SENT");
  const report=buildCashManagerReport(input.profileName,closure.statementNumber,JSON.parse(closure.snapshotJson) as CashManagerSnapshot);
  const now=new Date().toISOString(),messageIds:string[]=[];
  try{
    for(const recipient of recipients){const result=await sendSmtpMessage({...report,to:recipient,replyTo:recipient});if(result.messageId)messageIds.push(result.messageId)}
    await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MONTHLY_CASH_MANAGER_EMAIL_SENT","monthly_closure",`${input.profileId}:${input.month}`,input.operatorId,JSON.stringify({profileId:input.profileId,month:input.month,mode:input.mode,statementNumber:closure.statementNumber,recipientCount:recipients.length,recipientDomains:recipients.map(value=>value.split("@")[1]),messageIds}),now).run();
    return {ok:true,skipped:false,sentAt:now,recipients:recipients.length};
  }catch(error){
    await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MONTHLY_CASH_MANAGER_EMAIL_FAILED","monthly_closure",`${input.profileId}:${input.month}`,input.operatorId,JSON.stringify({profileId:input.profileId,month:input.month,mode:input.mode,statementNumber:closure.statementNumber}),now).run();
    throw error;
  }
}
