import { env } from "cloudflare:workers";
import { requireRole } from "../session";
import { requireProfile } from "../profile-session";

type PersonRow={
  memberId:string;
  memberName:string;
  openingBalance:number;
  charges:number;
  payments:number;
  adjustments:number;
  closingBalance:number;
  currentBalance:number;
};
type TransactionRow={
  transactionId:string;
  memberId:string;
  memberName:string;
  saleId:string|null;
  type:string;
  amount:number;
  note:string;
  createdAt:string;
  saleTime:string|null;
  saleTotal:number|null;
  saleMethod:string|null;
  saleItemCount:number|null;
  rewardAmount:number|null;
  rewardLabel:string|null;
  operatorName:string|null;
};
type SaleItemRow={
  lineId:string;
  saleId:string;
  productName:string;
  quantity:number;
  unitPrice:number;
  total:number;
  countsForConsumption:number;
};
type AllocationRow={saleId:string;memberId:string;memberName:string;amount:number;kind:string};
type BillingEntry=TransactionRow&{
  items:SaleItemRow[];
  allocations:AllocationRow[];
  shared:boolean;
  itemsLabel:string;
};
type ClosureRow={statementNumber:string;snapshotJson:string;checksum:string;closedByName:string;closedAt:string};
type ArchiveMonthRow={month:string;statementNumber:string|null;checksum:string|null;closedByName:string|null;closedAt:string|null;charges:number;people:number;salesCount:number};

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));
const eur=(value:number)=>Number(value||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const invoiceWording=(value:string)=>value.replace(new RegExp(["Ze","chen"].join(""),"gi"),"Rechnungen").replace(new RegExp(["Ze","che"].join(""),"gi"),"Rechnung");
const monthLabel=(month:string)=>new Date(`${month}-01T12:00:00Z`).toLocaleDateString("de-DE",{month:"long",year:"numeric"});
const currentBillingMonth=()=>{
  const parts=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit"}).formatToParts(new Date());
  return `${parts.find(part=>part.type==="year")?.value}-${parts.find(part=>part.type==="month")?.value}`;
};
const billingDueDate=(month:string)=>{
  const [year,monthNumber]=month.split("-").map(Number);
  return new Date(Date.UTC(year,monthNumber,10,12)).toISOString().slice(0,10);
};
const dateLabel=(date:string)=>new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});
const dateTime=(value:string)=>new Date(value).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const paymentLabel=(value:string|null)=>value==="Vertrauensliste"?"Monatsabrechnung":value||"Kontobuchung";
const cents=(value:number)=>Math.round(Number(value||0)*100);

export async function GET(request:Request){
  const [user,profile]=await Promise.all([
    requireRole(request,["Kassendienst","Kassenwart","Vorstand"]),
    requireProfile(request)
  ]);
  if(!user||!profile)return Response.json({error:"Keine Berechtigung oder Profilanmeldung abgelaufen"},{status:403});

  const url=new URL(request.url);
  const month=url.searchParams.get("month")||currentBillingMonth();
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return Response.json({error:"Ungültiger Monat"},{status:400});
  if(url.searchParams.get("archive")==="1"){
    const currentMonth=currentBillingMonth();
    const archive=await env.DB.prepare(`WITH activity AS (
      SELECT substr(created_at,1,7) month,ROUND(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),2) charges,COUNT(DISTINCT member_id) people
      FROM account_transactions WHERE profile_id=? GROUP BY substr(created_at,1,7)
    ), sale_months AS (
      SELECT substr(time,1,7) month,COUNT(*) salesCount FROM sales WHERE profile_id=? GROUP BY substr(time,1,7)
    ), used_months AS (
      SELECT month FROM activity UNION SELECT month FROM sale_months UNION SELECT month FROM monthly_closures WHERE profile_id=?
    )
    SELECT u.month,c.statement_number statementNumber,c.checksum,c.closed_by_name closedByName,c.closed_at closedAt,
      COALESCE(a.charges,0) charges,COALESCE(a.people,0) people,COALESCE(s.salesCount,0) salesCount
    FROM used_months u
    LEFT JOIN activity a ON a.month=u.month
    LEFT JOIN sale_months s ON s.month=u.month
    LEFT JOIN monthly_closures c ON c.profile_id=? AND c.month=u.month
    WHERE u.month<? ORDER BY u.month DESC`).bind(profile.id,profile.id,profile.id,profile.id,currentMonth).all<ArchiveMonthRow>();
    return Response.json({currentMonth,archive:archive.results.map(entry=>({
      ...entry,
      label:monthLabel(entry.month),
      dueDate:billingDueDate(entry.month),
      dueLabel:dateLabel(billingDueDate(entry.month)),
      charges:Number(entry.charges||0),
      people:Number(entry.people||0),
      salesCount:Number(entry.salesCount||0),
      closed:Boolean(entry.statementNumber)
    }))},{headers:{"cache-control":"no-store"}});
  }

  const start=`${month}-01T00:00:00.000Z`;
  const nextDate=new Date(`${month}-01T00:00:00.000Z`);
  nextDate.setUTCMonth(nextDate.getUTCMonth()+1);
  const end=nextDate.toISOString();
  const dueDate=billingDueDate(month);
  const dueLabel=dateLabel(dueDate);
  const closure=await env.DB.prepare("SELECT statement_number statementNumber,snapshot_json snapshotJson,checksum,closed_by_name closedByName,closed_at closedAt FROM monthly_closures WHERE profile_id=? AND month=?").bind(profile.id,month).first<ClosureRow>();

  const [activity,opening,current,transactions,saleItems,allocations,products]=await Promise.all([
    env.DB.prepare("SELECT member_id memberId,MAX(member_name) memberName,ROUND(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),2) charges,ROUND(ABS(SUM(CASE WHEN type='Zahlung' THEN amount ELSE 0 END)),2) payments,ROUND(SUM(CASE WHEN amount<0 AND type<>'Zahlung' THEN amount ELSE 0 END),2) adjustments,ROUND(SUM(amount),2) net FROM account_transactions WHERE profile_id=? AND created_at>=? AND created_at<? GROUP BY member_id ORDER BY memberName").bind(profile.id,start,end).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT member_id memberId,MAX(member_name) memberName,ROUND(SUM(amount),2) balance FROM account_transactions WHERE profile_id=? AND created_at<? GROUP BY member_id").bind(profile.id,start).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT member_id memberId,MAX(member_name) memberName,ROUND(SUM(amount),2) balance FROM account_transactions WHERE profile_id=? GROUP BY member_id").bind(profile.id).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT at.id transactionId,at.member_id memberId,at.member_name memberName,at.sale_id saleId,at.type,at.amount,at.note,at.created_at createdAt,COALESCE(op.name,at.operator_id) operatorName,s.time saleTime,s.total saleTotal,s.method saleMethod,s.items saleItemCount,rr.reward_amount rewardAmount,rr.reward_label rewardLabel FROM account_transactions at LEFT JOIN sales s ON s.id=at.sale_id AND s.profile_id=at.profile_id LEFT JOIN random_reward_slots rr ON rr.sale_id=s.id AND rr.profile_id=at.profile_id LEFT JOIN members op ON op.id=at.operator_id WHERE at.profile_id=? AND at.created_at>=? AND at.created_at<? ORDER BY at.created_at,at.id").bind(profile.id,start,end).all<TransactionRow>(),
    env.DB.prepare("SELECT DISTINCT si.id lineId,si.sale_id saleId,si.product_name productName,si.quantity,si.unit_price unitPrice,si.total,si.counts_for_consumption countsForConsumption FROM account_transactions at JOIN sale_items si ON si.sale_id=at.sale_id JOIN sales s ON s.id=si.sale_id AND s.profile_id=at.profile_id WHERE at.profile_id=? AND at.created_at>=? AND at.created_at<? ORDER BY si.sale_id,si.id").bind(profile.id,start,end).all<SaleItemRow>(),
    env.DB.prepare("SELECT DISTINCT sa.id allocationId,sa.sale_id saleId,sa.member_id memberId,sa.member_name memberName,sa.amount,sa.kind FROM account_transactions at JOIN sale_allocations sa ON sa.sale_id=at.sale_id AND sa.profile_id=at.profile_id WHERE at.profile_id=? AND at.created_at>=? AND at.created_at<? ORDER BY sa.sale_id,sa.id").bind(profile.id,start,end).all<AllocationRow>(),
    env.DB.prepare("SELECT si.product_name productName,SUM(si.quantity) quantity,ROUND(SUM(si.total),2) total FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.profile_id=? AND s.time>=? AND s.time<? AND r.id IS NULL AND si.counts_for_consumption=1 GROUP BY si.product_name ORDER BY quantity DESC").bind(profile.id,start,end).all<Record<string,unknown>>()
  ]);

  const itemsBySale=new Map<string,SaleItemRow[]>();
  for(const item of saleItems.results){
    const list=itemsBySale.get(item.saleId)||[];
    list.push({...item,quantity:Number(item.quantity),unitPrice:Number(item.unitPrice),total:Number(item.total),countsForConsumption:Number(item.countsForConsumption)});
    itemsBySale.set(item.saleId,list);
  }
  const allocationsBySale=new Map<string,AllocationRow[]>();
  for(const allocation of allocations.results){
    const list=allocationsBySale.get(allocation.saleId)||[];
    list.push({...allocation,amount:Number(allocation.amount)});
    allocationsBySale.set(allocation.saleId,list);
  }
  const entries:BillingEntry[]=transactions.results.map(transaction=>{
    const items=transaction.saleId?itemsBySale.get(transaction.saleId)||[]:[];
    const saleAllocations=transaction.saleId?allocationsBySale.get(transaction.saleId)||[]:[];
    const fallbackCount=Math.max(0,Number(transaction.saleItemCount||0));
    return {
      ...transaction,
      amount:Number(transaction.amount),
      saleTotal:transaction.saleTotal===null?null:Number(transaction.saleTotal),
      rewardAmount:transaction.rewardAmount===null?null:Number(transaction.rewardAmount),
      items,
      allocations:saleAllocations,
      shared:saleAllocations.length>1,
      itemsLabel:items.length
        ?items.map(item=>`${item.quantity}× ${item.productName}${item.total===0?" (inklusive)":""}`).join(", ")
        :transaction.saleId&&fallbackCount?`${fallbackCount} Artikel · ältere Buchung ohne einzelne Positionsdaten`:""
    };
  });

  const openingMap=new Map(opening.results.map(row=>[String(row.memberId),row]));
  const currentMap=new Map(current.results.map(row=>[String(row.memberId),row]));
  const activityMap=new Map(activity.results.map(row=>[String(row.memberId),row]));
  const ids=[...new Set([
    ...activityMap.keys(),
    ...opening.results.filter(row=>Math.abs(Number(row.balance||0))>.001).map(row=>String(row.memberId))
  ])];
  const people:PersonRow[]=ids.map(id=>{
    const row=activityMap.get(id);
    const openingRow=openingMap.get(id);
    const openingBalance=Number(openingRow?.balance||0);
    const net=Number(row?.net||0);
    const currentRow=currentMap.get(id);
    return {
      memberId:id,
      memberName:String(row?.memberName||currentRow?.memberName||openingRow?.memberName||id),
      openingBalance,
      charges:Number(row?.charges||0),
      payments:Number(row?.payments||0),
      adjustments:Number(row?.adjustments||0),
      closingBalance:Math.round((openingBalance+net)*100)/100,
      currentBalance:Number(currentRow?.balance||0)
    };
  }).sort((left,right)=>left.memberName.localeCompare(right.memberName,"de"));

  const itemDetails=entries.filter(entry=>entry.amount>0&&entry.saleId).flatMap(entry=>
    entry.items.map(item=>({
      memberId:entry.memberId,
      saleId:entry.saleId,
      createdAt:entry.createdAt,
      productName:item.productName,
      quantity:item.quantity,
      total:item.total,
      shared:entry.shared,
      allocatedAmount:entry.amount
    }))
  );
  let payload={
    month,
    label:monthLabel(month),
    dueDate,
    dueLabel,
    people,
    items:itemDetails,
    products:products.results.map(row=>({
      productName:String(row.productName),
      quantity:Number(row.quantity),
      total:Number(row.total)
    })),
    summary:{
      charges:people.reduce((sum,person)=>sum+person.charges,0),
      payments:people.reduce((sum,person)=>sum+person.payments,0),
      people:people.length
    },
    closure:closure?{closed:true,statementNumber:closure.statementNumber,checksum:closure.checksum,closedByName:closure.closedByName,closedAt:closure.closedAt}:{closed:false}
  };
  if(closure){
    const frozen=JSON.parse(closure.snapshotJson) as typeof payload;
    payload={...frozen,closure:{closed:true,statementNumber:closure.statementNumber,checksum:closure.checksum,closedByName:closure.closedByName,closedAt:closure.closedAt}};
  }

  if(url.searchParams.get("list")==="1"){
    const open=people.filter(person=>person.closingBalance>.005);
    const total=open.reduce((sum,person)=>sum+person.closingBalance,0);
    const rows=open.map(person=>`<tr><td>${esc(person.memberName)}</td><td>${eur(person.closingBalance)}</td></tr>`).join("");
    const html=`<!doctype html><html lang="de"><meta charset="utf-8"><title>Offene Rechnungen · ${esc(payload.label)}</title><style>body{font:16px Arial;max-width:720px;margin:30px auto;padding:24px;color:#172b25}h1{margin-bottom:4px}.meta{color:#68766f}.deadline{padding:11px 13px;background:#edf7f1;border-left:4px solid #1d5b4c}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:11px 6px;border-bottom:1px solid #ddd}th:last-child,td:last-child{text-align:right}.sum{display:flex;justify-content:space-between;border-top:2px solid #172b25;padding:12px 6px;font-size:19px}button{padding:10px 14px}@media print{button{display:none}body{margin:0}}</style><h1>Offene Rechnungen</h1><p class="meta">${esc(profile.name)} · ${esc(payload.label)} · Stand ${new Date().toLocaleDateString("de-DE")}</p><p class="deadline"><strong>Mitglieder:</strong> Monatsabrechnung zahlbar bis spätestens ${esc(dueLabel)}.<br><strong>Gäste:</strong> bitte zeitnah abrechnen.</p><table><thead><tr><th>Name</th><th>Offener Betrag</th></tr></thead><tbody>${rows||"<tr><td>Keine offenen Rechnungen</td><td>–</td></tr>"}</tbody></table><div class="sum"><strong>Gesamt</strong><strong>${eur(total)}</strong></div><button onclick="print()">Liste drucken</button></html>`;
    return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  }

  const memberId=url.searchParams.get("memberId");
  if(!memberId)return Response.json(payload,{headers:{"cache-control":"no-store"}});

  const person=people.find(candidate=>candidate.memberId===memberId);
  if(!person)return Response.json({error:"Für diese Person gibt es im gewählten Monat keine Abrechnung"},{status:404});
  const personEntries=entries.filter(entry=>entry.memberId===memberId);
  const charges=personEntries.filter(entry=>entry.amount>0);
  const payments=personEntries.filter(entry=>entry.type==="Zahlung"&&entry.amount<0);
  const corrections=personEntries.filter(entry=>entry.type!=="Zahlung"&&entry.amount<0);

  const chargeRows=charges.map(entry=>{
    if(!entry.saleId){
      return `<tbody class="booking"><tr class="booking-head"><td>${esc(invoiceWording(entry.note||entry.type))}<small>${dateTime(entry.createdAt)}</small></td><td>${eur(entry.amount)}</td></tr></tbody>`;
    }
    const bookingDate=dateTime(entry.saleTime||entry.createdAt);
    const participants=entry.allocations.map(allocation=>allocation.memberName).join(", ");
    const itemRows=entry.items.length
      ?entry.items.map(item=>`<tr><td>${esc(item.quantity)}× ${esc(item.productName)}${item.total===0?" <small>(im Paket enthalten)</small>":""}</td><td>${item.total===0?"inklusive":entry.shared?"Teil des Gesamtbons":eur(item.total)}</td></tr>`).join("")
      :`<tr><td>${esc(entry.itemsLabel||"Artikeldetails dieser älteren Buchung fehlen")}</td><td>${entry.shared?"geteilt":eur(entry.amount)}</td></tr>`;
    const itemTotal=entry.items.reduce((sum,item)=>sum+item.total,0);
    const rewardAmount=Number(entry.rewardAmount||0);
    const expectedAfterReward=Math.round((itemTotal-rewardAmount)*100)/100;
    const unexplainedAdjustment=!entry.shared&&Math.abs(expectedAfterReward-entry.amount)>.005
      ?entry.amount-expectedAfterReward
      :0;
    const rewardRow=rewardAmount>0
      ?`<tr class="discount"><td>★ ${esc(entry.rewardLabel||"Rabatt / Freigetränk")}</td><td>− ${eur(rewardAmount)}</td></tr>`
      :"";
    const adjustmentRow=unexplainedAdjustment
      ?`<tr class="discount"><td>Preis- oder Rundungsanpassung</td><td>${unexplainedAdjustment>0?"+ ":"− "}${eur(Math.abs(unexplainedAdjustment))}</td></tr>`
      :"";
    const shareRow=entry.shared
      ?`<tr class="personal-share"><td><strong>Persönlicher Anteil</strong><small>Geteilt mit: ${esc(participants)}</small></td><td><strong>${eur(entry.amount)}</strong></td></tr>`
      :"";
    return `<tbody class="booking${entry.shared?" shared":""}"><tr class="booking-head"><td><strong>${entry.shared?"Geteilte Bestellung":"Bestellung"}</strong><small>${bookingDate} · ${esc(paymentLabel(entry.saleMethod))} · Beleg ${esc(entry.saleId)}</small></td><td>${entry.shared?`Gesamt ${eur(Number(entry.saleTotal||0))}`:eur(entry.amount)}</td></tr>${itemRows}${rewardRow}${adjustmentRow}${shareRow}</tbody>`;
  }).join("");
  const correctionRows=corrections.map(entry=>`<tr class="correction"><td><strong>${esc(entry.type||"Korrektur")}</strong><small>${dateTime(entry.createdAt)}${entry.operatorName?` · ${esc(entry.operatorName)}`:""}${entry.itemsLabel?` · ${esc(entry.itemsLabel)}`:""}${entry.note?` · ${esc(invoiceWording(entry.note))}`:""}</small></td><td>− ${eur(Math.abs(entry.amount))}</td></tr>`).join("");
  const paymentRows=payments.map(entry=>`<tr class="payment"><td><strong>Zahlung</strong><small>${dateTime(entry.createdAt)}${entry.operatorName?` · erfasst von ${esc(entry.operatorName)}`:""} · ${esc(invoiceWording(entry.note||"Kontenausgleich"))}</small></td><td>− ${eur(Math.abs(entry.amount))}</td></tr>`).join("");
  const isGuest=person.memberId.startsWith("GAST-");
  const paymentNotice=isGuest?"Gastrechnung bitte zeitnah begleichen.":`Zahlbar bis spätestens ${dueLabel}.`;
  const reconciliation=cents(person.openingBalance)+cents(person.charges)-cents(person.payments)+cents(person.adjustments)===cents(person.closingBalance);
  const html=`<!doctype html><html lang="de"><meta charset="utf-8"><title>Monatsabrechnung ${esc(person.memberName)} · ${esc(payload.label)}</title><style>body{font:15px Arial;max-width:780px;margin:30px auto;padding:24px;color:#172b25}h1{margin-bottom:4px}.meta{color:#68766f;line-height:1.5}h2{margin-top:26px}table{width:100%;border-collapse:collapse;margin:14px 0 24px}td{padding:9px 10px;border-bottom:1px solid #ddd;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}td small{display:block;color:#68766f;margin-top:3px}.booking{border-top:2px solid #9caaa3}.booking-head{background:#edf3f0}.booking.shared .booking-head{background:#fff4df}.booking-head td{padding-top:12px}.personal-share{background:#f6faf8}.personal-share small{max-width:520px}.discount{color:#684181}.correction{color:#a33131;background:#fff4f2}.payment{color:#176044;background:#f0faf5}.totals{margin-left:auto;width:min(430px,100%)}.totals div{display:flex;justify-content:space-between;padding:8px}.due{font-size:20px;font-weight:bold;border-top:2px solid #173b32}.payment-note{margin-top:18px;padding:12px 14px;background:#edf7f1;border-left:4px solid #1d5b4c;font-size:17px;font-weight:bold}.check{font-size:12px;color:${reconciliation?"#176044":"#a33131"};text-align:right}.note{font-size:12px;color:#68766f;margin-top:25px}@media print{button{display:none}body{margin:0;padding:0}.booking{break-inside:avoid}}</style><h1>Monatsabrechnung</h1><p class="meta">${esc(profile.name)} · ${esc(payload.label)}<br>${esc(person.memberName)} · ${esc(person.memberId)}</p><h2>Bestellungen und Artikel</h2><table>${chargeRows||"<tbody><tr><td>Keine neuen Bestellungen in diesem Monat</td><td>–</td></tr></tbody>"}</table>${correctionRows?`<h2>Stornos und Korrekturen</h2><table>${correctionRows}</table>`:""}${paymentRows?`<h2>Zahlungen</h2><table>${paymentRows}</table>`:""}<div class="totals"><div><span>Stand Monatsanfang</span><b>${eur(person.openingBalance)}</b></div><div><span>Neue Buchungen</span><b>${eur(person.charges)}</b></div><div><span>Zahlungen</span><b>− ${eur(person.payments)}</b></div>${person.adjustments?`<div><span>Stornos / Korrekturen</span><b>${eur(person.adjustments)}</b></div>`:""}<div class="due"><span>Stand Monatsende</span><b>${eur(person.closingBalance)}</b></div></div><p class="check">${reconciliation?"✓ Rechnung rechnerisch vollständig":"⚠ Summenprüfung fehlgeschlagen – bitte Kassenwart informieren"}</p>${person.closingBalance>.005?`<p class="payment-note">${esc(paymentNotice)}</p>`:""}<p class="note">Geteilte Einkäufe zeigen den vollständigen gemeinsamen Bon und den tatsächlich auf dieses Konto gebuchten Anteil. Inklusivartikel werden für den Verbrauch aufgeführt, aber nicht erneut berechnet. Der aktuelle Gesamtsaldo kann durch spätere Buchungen vom Monatsendstand abweichen.</p><button onclick="print()">Abrechnung drucken</button></html>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}

export async function POST(request:Request){
  const [user,profile]=await Promise.all([requireRole(request,["Vorstand","Kassenwart"]),requireProfile(request)]);
  if(!user||!profile)return Response.json({error:"Nur Vorstand oder Kassenwart dürfen einen Monat festschreiben"},{status:403});
  try{
    const body=await request.json() as {month?:string};
    const month=body.month||"";
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return Response.json({error:"Ungültiger Monat"},{status:400});
    if(month>=currentBillingMonth())return Response.json({error:"Ein Monat kann erst nach seinem Monatsende festgeschrieben werden"},{status:409});
    const existing=await env.DB.prepare("SELECT statement_number statementNumber,checksum,closed_at closedAt FROM monthly_closures WHERE profile_id=? AND month=?").bind(profile.id,month).first();
    if(existing)return Response.json({ok:true,alreadyClosed:true,closure:existing});
    const reportUrl=new URL(request.url);reportUrl.search="";reportUrl.searchParams.set("month",month);
    const report=await GET(new Request(reportUrl,{headers:request.headers}));
    if(!report.ok) return report;
    const snapshot=await report.json() as Record<string,unknown>;
    delete snapshot.closure;
    const snapshotJson=JSON.stringify(snapshot),checksum=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(snapshotJson))),byte=>byte.toString(16).padStart(2,"0")).join("");
    const statementNumber=`VK-${profile.id.replace(/[^a-zA-Z0-9]/g,"").slice(0,12).toUpperCase()}-${month.replace("-","")}`,now=new Date().toISOString(),id=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO monthly_closures (id,profile_id,month,statement_number,snapshot_json,checksum,closed_by,closed_by_name,closed_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,profile.id,month,statementNumber,snapshotJson,checksum,user.id,user.name,now),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MONTH_CLOSED","monthly_closure",id,user.id,JSON.stringify({profileId:profile.id,month,statementNumber,checksum}),now)
    ]);
    await env.BACKUPS.put(`monthly-closures/${profile.id}/${month}/${statementNumber}.json`,JSON.stringify({profileId:profile.id,month,statementNumber,checksum,closedBy:user,closedAt:now,snapshot}),{httpMetadata:{contentType:"application/json"}});
    return Response.json({ok:true,closure:{closed:true,statementNumber,checksum,closedByName:user.name,closedAt:now}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Monat konnte nicht festgeschrieben werden"},{status:500})}
}
