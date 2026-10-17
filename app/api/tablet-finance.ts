import { env } from "cloudflare:workers";

export type Fund = {id:string;profile_id:string;label:string;sponsor_id:string;sponsor_name:string;kind:"cash"|"once";state:"active"|"paused"|"closed";budget_cents:number;spent_cents:number;refunded_cents:number;revision:number;created_at:string;updated_at:string};
export const cents=(value:unknown)=>Math.round(Number(value)*100);
export const remaining=(fund:Fund)=>fund.budget_cents-fund.spent_cents-fund.refunded_cents;
export async function fingerprint(value:string) {return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("")}
export const activeFund=async(profileId:string)=>env.DB.prepare("SELECT * FROM tablet_funds WHERE profile_id=? AND state IN ('active','paused')").bind(profileId).first<Fund>();
export function restoreFund(fund:Fund,now:string) {
  return env.DB.prepare("UPDATE tablet_funds SET state=?,budget_cents=?,spent_cents=?,refunded_cents=?,revision=revision+1,updated_at=? WHERE id=? AND profile_id=?").bind(fund.state,fund.budget_cents,fund.spent_cents,fund.refunded_cents,now,fund.id,fund.profile_id);
}
export function cashEntry(id:string,profileId:string,amountCents:number,operator:string,now:string,note:string,tenderedCents=amountCents) {
  // Standalone signed payments are understood by the previous cash-closing code.
  return env.DB.prepare("INSERT INTO payments (id,profile_id,method,amount,tendered,change_due,note,operator_id,created_at) VALUES (?,?,'Bar',?,?,?,?,?,?)").bind(id,profileId,amountCents/100,tenderedCents/100,(tenderedCents-amountCents)/100,note,operator,now);
}
export function accountEntry(id:string,profileId:string,memberId:string,name:string,amountCents:number,operator:string,now:string,note:string,saleId:string|null=null) {
  return env.DB.prepare("INSERT INTO account_transactions (id,profile_id,member_id,member_name,sale_id,type,amount,note,operator_id,created_at) VALUES (?,?,?,?,?,'Getränketopf',?,?,?,?)").bind(id,profileId,memberId,name,saleId,amountCents/100,note,operator,now);
}
export type OperationPayload={fundBefore?:Fund|null;fundAfter?:Fund;cashCents?:number;accountEntries?:{id:string;name:string;cents:number}[];saleId?:string;shiftId:string};

// Used by both immediate undo and the existing protected admin reversal.
export async function fundSaleReversal(profileId:string,saleId:string,operator:string,now:string,administrative=false) {
  const row=await env.DB.prepare("SELECT id,payload_json,undone_at FROM tablet_operations WHERE id=? AND profile_id=? AND kind='fund-sale'").bind(saleId,profileId).first<{id:string;payload_json:string;undone_at:string|null}>();
  if(!row||row.undone_at)return [];
  const payload=JSON.parse(row.payload_json) as OperationPayload;
  const before=payload.fundBefore!,after=payload.fundAfter!;
  const current=await env.DB.prepare("SELECT * FROM tablet_funds WHERE id=? AND profile_id=?").bind(after.id,profileId).first<Fund>();
  if(!current)throw new Error("Der Getränketopf ist nicht mehr verfügbar.");
  if(administrative) {
    const contribution=after.spent_cents-before.spent_cents;
    if(current.spent_cents<contribution)throw new Error("Der Verbrauch des Getränketopfs muss zuerst geprüft werden.");
    const refund=current.kind==="cash"&&current.state==="closed"?contribution:0;
    return [
      env.DB.prepare("UPDATE tablet_funds SET spent_cents=spent_cents-?,refunded_cents=refunded_cents+?,revision=revision+1,updated_at=? WHERE id=? AND profile_id=?").bind(contribution,refund,now,current.id,profileId),
      ...(payload.cashCents?[cashEntry(`${saleId}-cash-undo`,profileId,-payload.cashCents,operator,now,`Rückzahlung zu ${saleId}`)]:[]),
      ...(refund?[cashEntry(`${saleId}-fund-refund`,profileId,-refund,operator,now,`Storno · Restguthaben an ${current.sponsor_name} auszahlen`),accountEntry(`${saleId}-fund-refund-account`,profileId,current.id,`Getränketopf · ${current.label}`,refund,operator,now,"Restguthaben nach Storno ausgezahlt")]:[]),
      env.DB.prepare("UPDATE tablet_operations SET undone_at=? WHERE id=? AND profile_id=?").bind(now,saleId,profileId)
    ];
  }
  if(current.revision!==after.revision)throw new Error("Der Getränketopf wurde inzwischen verändert. Bitte die spätere Topfbewegung zuerst korrigieren.");
  const other=await activeFund(profileId);
  if(other&&other.id!==before.id)throw new Error("Zuerst den neueren Getränketopf beenden, bevor diese Runde zurückgenommen wird.");
  return [restoreFund(before,now),...(payload.cashCents?[cashEntry(`${saleId}-cash-undo`,profileId,-payload.cashCents,operator,now,`Rückzahlung zu ${saleId}`)]:[]),env.DB.prepare("UPDATE tablet_operations SET undone_at=? WHERE id=? AND profile_id=?").bind(now,saleId,profileId)];
}
