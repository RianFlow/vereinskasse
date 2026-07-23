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
type ItemRow={memberId:string;productName:string;quantity:number;total:number};

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));
const eur=(value:number)=>Number(value||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const monthLabel=(month:string)=>new Date(`${month}-01T12:00:00Z`).toLocaleDateString("de-DE",{month:"long",year:"numeric"});
const billingDueDate=(month:string)=>{
  const [year,monthNumber]=month.split("-").map(Number);
  return new Date(Date.UTC(year,monthNumber,10,12)).toISOString().slice(0,10);
};
const dateLabel=(date:string)=>new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});

export async function GET(request:Request){
  const [user,profile]=await Promise.all([
    requireRole(request,["Kassendienst","Vorstand"]),
    requireProfile(request)
  ]);
  if(!user||!profile)return Response.json({error:"Keine Berechtigung oder Profilanmeldung abgelaufen"},{status:403});

  const url=new URL(request.url);
  const month=url.searchParams.get("month")||new Date().toISOString().slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return Response.json({error:"Ungültiger Monat"},{status:400});

  const start=`${month}-01T00:00:00.000Z`;
  const nextDate=new Date(`${month}-01T00:00:00.000Z`);
  nextDate.setUTCMonth(nextDate.getUTCMonth()+1);
  const end=nextDate.toISOString();
  const dueDate=billingDueDate(month);
  const dueLabel=dateLabel(dueDate);

  const [activity,opening,current,items,products]=await Promise.all([
    env.DB.prepare("SELECT member_id memberId,MAX(member_name) memberName,ROUND(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),2) charges,ROUND(ABS(SUM(CASE WHEN type='Zahlung' THEN amount ELSE 0 END)),2) payments,ROUND(SUM(CASE WHEN amount<0 AND type<>'Zahlung' THEN amount ELSE 0 END),2) adjustments,ROUND(SUM(amount),2) net FROM account_transactions WHERE profile_id=? AND created_at>=? AND created_at<? GROUP BY member_id ORDER BY memberName").bind(profile.id,start,end).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT member_id memberId,MAX(member_name) memberName,ROUND(SUM(amount),2) balance FROM account_transactions WHERE profile_id=? AND created_at<? GROUP BY member_id").bind(profile.id,start).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT member_id memberId,MAX(member_name) memberName,ROUND(SUM(amount),2) balance FROM account_transactions WHERE profile_id=? GROUP BY member_id").bind(profile.id).all<Record<string,unknown>>(),
    env.DB.prepare("SELECT at.member_id memberId,si.product_name productName,SUM(si.quantity) quantity,ROUND(SUM(si.total),2) total FROM account_transactions at JOIN sale_items si ON si.sale_id=at.sale_id LEFT JOIN reversals r ON r.sale_id=at.sale_id WHERE at.profile_id=? AND at.created_at>=? AND at.created_at<? AND at.amount>0 AND r.id IS NULL GROUP BY at.member_id,si.product_name ORDER BY at.member_id,quantity DESC").bind(profile.id,start,end).all<ItemRow>(),
    env.DB.prepare("SELECT si.product_name productName,SUM(si.quantity) quantity,ROUND(SUM(si.total),2) total FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.profile_id=? AND s.time>=? AND s.time<? AND r.id IS NULL AND si.counts_for_consumption=1 GROUP BY si.product_name ORDER BY quantity DESC").bind(profile.id,start,end).all<Record<string,unknown>>()
  ]);

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

  const payload={
    month,
    label:monthLabel(month),
    dueDate,
    dueLabel,
    people,
    items:items.results,
    products:products.results.map(row=>({
      productName:String(row.productName),
      quantity:Number(row.quantity),
      total:Number(row.total)
    })),
    summary:{
      charges:people.reduce((sum,person)=>sum+person.charges,0),
      payments:people.reduce((sum,person)=>sum+person.payments,0),
      people:people.length
    }
  };

  if(url.searchParams.get("list")==="1"){
    const open=people.filter(person=>person.closingBalance>.005);
    const total=open.reduce((sum,person)=>sum+person.closingBalance,0);
    const rows=open.map(person=>`<tr><td>${esc(person.memberName)}</td><td>${eur(person.closingBalance)}</td></tr>`).join("");
    const html=`<!doctype html><html lang="de"><meta charset="utf-8"><title>Offene Zechen · ${esc(payload.label)}</title><style>body{font:16px Arial;max-width:720px;margin:30px auto;padding:24px;color:#172b25}h1{margin-bottom:4px}.meta{color:#68766f}.deadline{padding:11px 13px;background:#edf7f1;border-left:4px solid #1d5b4c}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:11px 6px;border-bottom:1px solid #ddd}th:last-child,td:last-child{text-align:right}.sum{display:flex;justify-content:space-between;border-top:2px solid #172b25;padding:12px 6px;font-size:19px}button{padding:10px 14px}@media print{button{display:none}body{margin:0}}</style><h1>Offene Zechen</h1><p class="meta">${esc(profile.name)} · ${esc(payload.label)} · Stand ${new Date().toLocaleDateString("de-DE")}</p><p class="deadline"><strong>Mitglieder:</strong> Monatsabrechnung zahlbar bis spätestens ${esc(dueLabel)}.<br><strong>Gäste:</strong> bitte zeitnah abrechnen.</p><table><thead><tr><th>Name</th><th>Offener Betrag</th></tr></thead><tbody>${rows||"<tr><td>Keine offenen Zechen</td><td>–</td></tr>"}</tbody></table><div class="sum"><strong>Gesamt</strong><strong>${eur(total)}</strong></div><button onclick="print()">Liste drucken</button></html>`;
    return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  }

  const memberId=url.searchParams.get("memberId");
  if(!memberId)return Response.json(payload,{headers:{"cache-control":"no-store"}});

  const person=people.find(candidate=>candidate.memberId===memberId);
  if(!person)return Response.json({error:"Für diese Person gibt es im gewählten Monat keine Abrechnung"},{status:404});
  const personItems=items.results.filter(item=>item.memberId===memberId);
  const rows=personItems.map(item=>`<tr><td>${esc(item.quantity)}× ${esc(item.productName)}${Number(item.total)===0?" <small>(im Paket enthalten)</small>":""}</td><td>${Number(item.total)===0?"inklusive":eur(item.total)}</td></tr>`).join("");
  const isGuest=person.memberId.startsWith("GAST-");
  const paymentNotice=isGuest?"Gastrechnung bitte zeitnah begleichen.":`Zahlbar bis spätestens ${dueLabel}.`;
  const html=`<!doctype html><html lang="de"><meta charset="utf-8"><title>Monatsabrechnung ${esc(person.memberName)} · ${esc(payload.label)}</title><style>body{font:15px Arial;max-width:720px;margin:30px auto;padding:24px;color:#172b25}h1{margin-bottom:4px}.meta{color:#68766f}table{width:100%;border-collapse:collapse;margin:22px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}th:last-child,td:last-child{text-align:right}.totals{margin-left:auto;width:min(360px,100%)}.totals div{display:flex;justify-content:space-between;padding:8px}.due{font-size:20px;font-weight:bold;border-top:2px solid #173b32}.payment-note{margin-top:18px;padding:12px 14px;background:#edf7f1;border-left:4px solid #1d5b4c;font-size:17px;font-weight:bold}.note{font-size:12px;color:#68766f;margin-top:25px}@media print{button{display:none}body{margin:0}}</style><h1>Monatsabrechnung</h1><p class="meta">${esc(profile.name)} · ${esc(payload.label)}<br>${esc(person.memberName)} · ${esc(person.memberId)}</p><h2>Getränke und Artikel</h2><table><thead><tr><th>Artikel</th><th>Betrag</th></tr></thead><tbody>${rows||"<tr><td>Keine einzelnen Artikel vorhanden</td><td>–</td></tr>"}</tbody></table><div class="totals"><div><span>Stand Monatsanfang</span><b>${eur(person.openingBalance)}</b></div><div><span>Neue Buchungen</span><b>${eur(person.charges)}</b></div><div><span>Zahlungen</span><b>− ${eur(person.payments)}</b></div>${person.adjustments?`<div><span>Korrekturen/Storno</span><b>${eur(person.adjustments)}</b></div>`:""}<div class="due"><span>Stand Monatsende</span><b>${eur(person.closingBalance)}</b></div></div>${person.closingBalance>.005?`<p class="payment-note">${esc(paymentNotice)}</p>`:""}<p class="note">Digital erzeugte Vereinsabrechnung. Der aktuelle Gesamtsaldo kann durch spätere Buchungen vom Monatsendstand abweichen.</p><button onclick="print()">Abrechnung drucken</button></html>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}
