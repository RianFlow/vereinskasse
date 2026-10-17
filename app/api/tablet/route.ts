import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { sessionUser } from "../session";
import { cashTransaction } from "../cash-transaction";
import { canonicalCart } from "../canonical-cart";
import { POST as legacySale, PATCH as legacyUndo } from "../data/route";
import { POST as legacyControl } from "../control/route";
import { activeFund, accountEntry, cashEntry, cents, fingerprint, remaining, restoreFund, type Fund, type OperationPayload } from "../tablet-finance";

class Invalid extends Error {constructor(message:string,readonly status=409){super(message)}}
type Body={action:string;id:string;undoToken:string;fundId?:string;revision?:number;label?:string;sponsorId?:string;kind?:"cash"|"once";amount?:number;tendered?:number;memberId?:string;cart?:Record<number,number>;priceMode?:"member"|"non_member";total?:number;coverage?:number;method?:string;eventId?:string;allocations?:{memberId:string;memberName:string;amount:number;kind:string}[];operationId?:string;[key:string]:unknown};
function fail(message:string,status=409):never {throw new Invalid(message,status)}
const validAmount=(value:unknown,max=1000000)=>Number.isFinite(Number(value))&&Number(value)>0&&cents(value)<=max&&Math.abs(Number(value)*100-cents(value))<.00001;
const tokenValid=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9-]{24,100}$/.test(value);
const forwarded=(request:Request,body:unknown)=>new Request(request.url,{method:"POST",headers:request.headers,body:JSON.stringify(body)});

export async function GET(request:Request) {
  const profile=await requireProfile(request);if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});
  return Response.json({fund:await activeFund(profile.id),undoSeconds:30},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request) {
  try{return await cashTransaction(request,()=>perform(request),true)}catch(error){return Response.json({error:error instanceof Error?error.message:"Vorgang fehlgeschlagen"},{status:error instanceof Invalid?error.status:500})}
}

async function perform(request:Request):Promise<Response> {
  const profile=(await requireProfile(request))!,operator=await sessionUser(request),operatorId=operator?.id||`PROFILE-${profile.id}`;
  const body=await request.json() as Body;
  if(!body||typeof body!=="object"||Array.isArray(body))fail("Ungültiger Vorgang",400);
  if(body.action==="undo")return undo(request,profile.id,body,operatorId);
  if(typeof body.id!=="string"||!/^[-a-zA-Z0-9]{16,100}$/.test(body.id)||!tokenValid(body.undoToken))fail("Vorgangsnummer fehlt",400);
  const requestHash=await fingerprint(JSON.stringify(body));
  const previous=await env.DB.prepare("SELECT request_hash,result_json FROM tablet_operations WHERE id=? AND profile_id=?").bind(body.id,profile.id).first<{request_hash:string;result_json:string}>();
  if(previous){if(previous.request_hash!==requestHash)fail("Diese Vorgangsnummer wurde bereits anders verwendet");return Response.json({...JSON.parse(previous.result_json),duplicate:true})}
  const shift=await env.DB.prepare("SELECT id FROM shifts WHERE profile_id=? AND status='open'").bind(profile.id).first<{id:string}>();
  if(!shift)fail("Bitte zuerst die Kasse eröffnen. Es wurde nichts gebucht.");
  const now=new Date().toISOString(),payload:OperationPayload={shiftId:shift.id};
  const statements:D1PreparedStatement[]=[];
  let result:Record<string,unknown>={ok:true,id:body.id,undoUntil:Date.now()+30000};
  let kind=body.action;
  if(body.action==="payment") {
    if(!validAmount(body.amount,100000000)||!validAmount(body.tendered,100000000))fail("Bitte gültige Eurobeträge mit höchstens zwei Nachkommastellen eingeben",400);
    const response=await legacyControl(forwarded(request,{...body,action:"payment",paymentMethod:"Bar"}));
    if(!response.ok)return response;
    const paid=await response.json() as {amount:number;changeDue:number;remaining:number;distribution:{memberId:string;memberName:string;amount:number}[]};
    payload.cashCents=cents(paid.amount);payload.accountEntries=paid.distribution.map(share=>({id:share.memberId,name:share.memberName,cents:-cents(share.amount)}));
    result={...result,...paid};
  } else if(body.action==="sale") {
    if(!body.fundId) {
      const response=await legacySale(forwarded(request,{...body,memberId:body.memberId||operatorId,member:operator?.name||`${profile.shortName} Kasse`,time:now,items:1,rewardEligible:true}));
      if(!response.ok)return response;
      const sale=await response.json() as Record<string,unknown>;
      payload.saleId=body.id;kind="sale";result={...result,...sale};
    } else {
      kind="fund-sale";
      const fund=await activeFund(profile.id);
      if(!fund||fund.id!==body.fundId||fund.state!=="active"||fund.revision!==body.revision)fail("Der Getränketopf hat sich geändert. Bitte den Betrag erneut prüfen.");
      const canonical=await canonicalCart(profile.id,body.cart,body.priceMode==="member"?"member":"non_member");
      if(canonical.total<=0||cents(canonical.total)!==cents(body.total))fail("Die Preise haben sich geändert. Bitte die Kasse neu laden.");
      if(body.eventId) {
        const event=await env.DB.prepare("SELECT product_ids_json FROM events WHERE id=? AND profile_id=? AND status='active'").bind(body.eventId,profile.id).first<{product_ids_json:string|null}>();
        if(!event||event.product_ids_json!==null&&Object.keys(canonical.cart).some(id=>!(JSON.parse(event.product_ids_json!) as number[]).includes(Number(id))))fail("Das Sortiment der Veranstaltung hat sich geändert.");
      }
      const eligible=canonical.lines.filter(line=>line.category==="Getränke").reduce((sum,line)=>sum+cents(line.total),0);
      const coverage=fund.kind==="cash"?Math.min(eligible,remaining(fund)):eligible;
      if(coverage<=0||coverage!==cents(body.coverage))fail("Der Betrag aus dem Getränketopf hat sich geändert. Bitte erneut prüfen.");
      const rest=cents(canonical.total)-coverage,allocations=body.allocations||[];
      if(!Array.isArray(allocations)||allocations.length>100||new Set(allocations.map(a=>a.memberId)).size!==allocations.length)fail("Ungültige Aufteilung",400);
      if(body.method!=="Bar"&&body.method!=="Mitgliedskonto")fail("Ungültige Zahlungsart",400);
      if(body.method==="Bar"&&allocations.length||body.method!=="Bar"&&allocations.reduce((sum,a)=>sum+cents(a.amount),0)!==rest)fail("Die Aufteilung deckt den Restbetrag nicht ab",400);
      if(body.method==="Bar"&&(!Number.isFinite(Number(body.tendered))||cents(body.tendered)<rest||cents(body.tendered)>100000000))fail("Erhaltener Barbetrag ist zu niedrig oder ungültig",400);
      for(const allocation of allocations) {
        if(!validAmount(allocation.amount,100000000)||typeof allocation.memberId!=="string"||allocation.memberId===fund.id)fail("Ungültiger Anteil",400);
        const target=await account(profile.id,allocation.memberId);allocation.memberName=target.name;
      }
      const fundAccount=fund.kind==="cash"?{id:fund.id,name:`Getränketopf · ${fund.label}`} : await account(profile.id,fund.sponsor_id);
      const all=[...allocations.map(a=>({...a,cents:cents(a.amount)})),{memberId:fundAccount.id,memberName:fundAccount.name,cents:coverage,kind:"runde"}];
      const after:Fund={...fund,spent_cents:fund.spent_cents+coverage,revision:fund.revision+1,state:fund.kind==="once"||remaining(fund)===coverage?"closed":"active",updated_at:now};
      const key=`sales/${profile.id}/${now.slice(0,10)}/${body.id}.json`;
      await env.BACKUPS.put(key,JSON.stringify({...body,total:canonical.total,profileId:profile.id,backedUpAt:now,coverage:coverage/100}),{httpMetadata:{contentType:"application/json"}});
      statements.push(env.DB.prepare("INSERT INTO sales (id,total,items,time,member,member_id,method,profile_id,event_id,cart_json,backup_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(body.id,canonical.total,canonical.items,now,operator?.name||`${profile.shortName} Kasse`,operatorId,rest?"Gemischt":"Getränketopf",profile.id,body.eventId||null,JSON.stringify(canonical.cart),key));
      canonical.lines.forEach((line,index)=>statements.push(env.DB.prepare("INSERT INTO sale_items (id,sale_id,product_id,product_name,quantity,unit_price,total,counts_for_consumption) VALUES (?,?,?,?,?,?,?,?)").bind(`${body.id}-line-${index}`,body.id,line.productId,line.productName,line.quantity,line.unitPrice,line.total,line.countsForConsumption===false?0:1)));
      all.forEach((share,index)=>{
        statements.push(env.DB.prepare("INSERT INTO sale_allocations (id,profile_id,sale_id,member_id,member_name,amount,kind) VALUES (?,?,?,?,?,?,?)").bind(`${body.id}-alloc-${index}`,profile.id,body.id,share.memberId,share.memberName,share.cents/100,share.kind||"anteil"));
        statements.push(accountEntry(`${body.id}-acct-${index}`,profile.id,share.memberId,share.memberName,share.cents,operatorId,now,`Bestellung · ${fund.label}`,body.id));
      });
      if(body.method==="Bar"&&rest)statements.push(cashEntry(`${body.id}-cash`,profile.id,rest,operatorId,now,`Baranteil zu ${body.id}`,cents(body.tendered)));
      statements.push(env.DB.prepare("UPDATE tablet_funds SET spent_cents=?,state=?,revision=?,updated_at=? WHERE id=? AND profile_id=?").bind(after.spent_cents,after.state,after.revision,now,fund.id,profile.id));
      payload.fundBefore=fund;payload.fundAfter=after;payload.saleId=body.id;payload.cashCents=body.method==="Bar"?rest:0;
      result={...result,total:canonical.total,coverage:coverage/100,changeDue:body.method==="Bar"?(cents(body.tendered)-rest)/100:0,fund:after};
    }
  } else {
    const fund=await activeFund(profile.id);
    if(body.action==="fund-create") {
      if(fund)fail("Es gibt bereits einen offenen Getränketopf");
      if(body.kind!=="cash"&&body.kind!=="once")fail("Bitte die Art der Runde wählen",400);
      const sponsor=await account(profile.id,body.sponsorId||"");
      const label=String(body.label||`Runde von ${sponsor.name}`).trim().slice(0,100);
      if(!label||body.kind==="cash"&&!validAmount(body.amount))fail("Bitte einen gültigen Betrag eingeben",400);
      const amount=body.kind==="cash"?cents(body.amount):0;
      if(amount&&(!Number.isFinite(Number(body.tendered))||cents(body.tendered)<amount))fail("Der Barbetrag wurde noch nicht vollständig erhalten",400);
      const created:Fund={id:`FUND-${body.id}`,profile_id:profile.id,label,sponsor_id:sponsor.id,sponsor_name:sponsor.name,kind:body.kind,state:"active",budget_cents:amount,spent_cents:0,refunded_cents:0,revision:0,created_at:now,updated_at:now};
      statements.push(env.DB.prepare("INSERT INTO tablet_funds (id,profile_id,label,sponsor_id,sponsor_name,kind,state,budget_cents,spent_cents,refunded_cents,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',?,0,0,0,?,?)").bind(created.id,profile.id,label,sponsor.id,sponsor.name,body.kind,amount,now,now));
      if(amount){statements.push(cashEntry(`${body.id}-cash`,profile.id,amount,operatorId,now,`Einzahlung · ${label}`,cents(body.tendered)),accountEntry(`${body.id}-fund`,profile.id,created.id,`Getränketopf · ${label}`,-amount,operatorId,now,"Vorauszahlung"));payload.cashCents=amount;payload.accountEntries=[{id:created.id,name:`Getränketopf · ${label}`,cents:-amount}]}
      payload.fundBefore=null;payload.fundAfter=created;result={...result,fund:created,changeDue:amount?(cents(body.tendered)-amount)/100:0};
    } else {
      if(!fund||fund.id!==body.fundId||fund.revision!==body.revision)fail("Der Getränketopf hat sich geändert. Bitte erneut öffnen.");
      payload.fundBefore=fund;
      const after:Fund={...fund,revision:fund.revision+1,updated_at:now};
      if(body.action==="fund-pause")after.state="paused";
      else if(body.action==="fund-resume")after.state="active";
      else if(body.action==="fund-topup") {
        if(fund.kind!=="cash"||!validAmount(body.amount)||after.budget_cents+cents(body.amount)>1000000)fail("Ungültiger Betrag",400);
        const amount=cents(body.amount);if(!Number.isFinite(Number(body.tendered))||cents(body.tendered)<amount)fail("Erhaltener Betrag ist zu niedrig",400);
        after.budget_cents+=amount;
        statements.push(cashEntry(`${body.id}-cash`,profile.id,amount,operatorId,now,`Nachzahlung · ${fund.label}`,cents(body.tendered)),accountEntry(`${body.id}-fund`,profile.id,fund.id,`Getränketopf · ${fund.label}`,-amount,operatorId,now,"Nachzahlung"));
        payload.cashCents=amount;payload.accountEntries=[{id:fund.id,name:`Getränketopf · ${fund.label}`,cents:-amount}];result.changeDue=(cents(body.tendered)-amount)/100;
      } else if(body.action==="fund-close") {
        const refund=fund.kind==="cash"?remaining(fund):0;after.state="closed";after.refunded_cents+=refund;
        if(refund){statements.push(cashEntry(`${body.id}-cash`,profile.id,-refund,operatorId,now,`Restguthaben ausgezahlt · ${fund.label}`),accountEntry(`${body.id}-fund`,profile.id,fund.id,`Getränketopf · ${fund.label}`,refund,operatorId,now,"Restguthaben ausgezahlt"));payload.cashCents=-refund;payload.accountEntries=[{id:fund.id,name:`Getränketopf · ${fund.label}`,cents:refund}]}
        result.refund=refund/100;
      } else fail("Unbekannte Aktion",400);
      statements.push(env.DB.prepare("UPDATE tablet_funds SET state=?,budget_cents=?,spent_cents=?,refunded_cents=?,revision=?,updated_at=? WHERE id=? AND profile_id=?").bind(after.state,after.budget_cents,after.spent_cents,after.refunded_cents,after.revision,now,after.id,profile.id));
      payload.fundAfter=after;result.fund=after;
    }
  }
  const undoHash=await fingerprint(body.undoToken);
  statements.push(env.DB.prepare("INSERT INTO tablet_operations (id,profile_id,kind,request_hash,undo_hash,payload_json,result_json,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(body.id,profile.id,kind,requestHash,undoHash,JSON.stringify(payload),JSON.stringify(result),now),env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(`${body.id}-tablet-audit`,kind.toUpperCase(),"tablet_operation",body.id,operatorId,JSON.stringify({profileId:profile.id,...payload}),now));
  await env.BACKUPS.put(`tablet/${profile.id}/${now.slice(0,10)}/${body.id}.json`,JSON.stringify({id:body.id,kind,payload,result,createdAt:now}),{httpMetadata:{contentType:"application/json"}});
  await env.DB.batch(statements);
  return Response.json(result,{status:201});
}

async function account(profileId:string,id:string) {
  const target=await env.DB.prepare("SELECT id,name FROM members WHERE id=? AND active=1").bind(id).first<{id:string;name:string}>()||await env.DB.prepare("SELECT id,name FROM guest_accounts WHERE id=? AND profile_id=? AND active=1").bind(id,profileId).first<{id:string;name:string}>();
  if(!target)fail("Das ausgewählte Konto ist nicht mehr verfügbar");return target;
}

async function undo(request:Request,profileId:string,body:Body,operator:string) {
  const row=await env.DB.prepare("SELECT * FROM tablet_operations WHERE id=? AND profile_id=?").bind(body.operationId||"",profileId).first<{id:string;kind:string;undo_hash:string;payload_json:string;created_at:string;undone_at:string|null}>();
  if(!row||!tokenValid(body.undoToken)||row.undo_hash!==await fingerprint(body.undoToken))fail("Rücknahmeschlüssel ungültig",403);
  if(row.undone_at)return Response.json({ok:true,duplicate:true});
  if(Date.now()-Date.parse(row.created_at)>30000)fail("Die 30 Sekunden sind abgelaufen. Bitte die Verwaltung verwenden.",410);
  const payload=JSON.parse(row.payload_json) as OperationPayload;
  if(!await env.DB.prepare("SELECT id FROM shifts WHERE id=? AND profile_id=? AND status='open'").bind(payload.shiftId,profileId).first())fail("Die Schicht wurde bereits abgeschlossen");
  if(row.kind==="sale"||row.kind==="fund-sale") {
    const response=await legacyUndo(new Request(request.url,{method:"PATCH",headers:request.headers,body:JSON.stringify({saleId:row.id,undoToken:body.undoToken})}));
    if(response.ok)await env.DB.prepare("UPDATE tablet_operations SET undone_at=? WHERE id=? AND profile_id=?").bind(new Date().toISOString(),row.id,profileId).run();
    return response;
  }
  const now=new Date().toISOString(),statements:D1PreparedStatement[]=[];
  if(payload.fundAfter) {
    const current=await env.DB.prepare("SELECT * FROM tablet_funds WHERE id=? AND profile_id=?").bind(payload.fundAfter.id,profileId).first<Fund>();
    if(!current||current.revision!==payload.fundAfter.revision)fail("Der Getränketopf wurde inzwischen verändert. Diese Bewegung kann nicht mehr sofort zurückgenommen werden.");
    const other=await activeFund(profileId);if(other&&other.id!==current.id)fail("Es gibt bereits einen neueren Getränketopf");
    if(payload.fundBefore)statements.push(restoreFund(payload.fundBefore,now));
    else statements.push(env.DB.prepare("UPDATE tablet_funds SET state='closed',refunded_cents=budget_cents,revision=revision+1,updated_at=? WHERE id=? AND profile_id=?").bind(now,current.id,profileId));
  }
  if(payload.cashCents)statements.push(cashEntry(`${row.id}-undo-cash`,profileId,-payload.cashCents,operator,now,"Sofort rückgängig"));
  for(const [index,entry] of (payload.accountEntries||[]).entries())statements.push(accountEntry(`${row.id}-undo-${index}`,profileId,entry.id,entry.name,-entry.cents,operator,now,"Sofort rückgängig"));
  statements.push(env.DB.prepare("UPDATE tablet_operations SET undone_at=? WHERE id=? AND profile_id=?").bind(now,row.id,profileId),env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(`${row.id}-undo-audit`,"TABLET_UNDONE","tablet_operation",row.id,operator,JSON.stringify({profileId,kind:row.kind}),now));
  await env.BACKUPS.put(`tablet/${profileId}/${now.slice(0,10)}/${row.id}-undo.json`,JSON.stringify({operationId:row.id,kind:row.kind,payload,createdAt:now}),{httpMetadata:{contentType:"application/json"}});
  await env.DB.batch(statements);return Response.json({ok:true});
}
