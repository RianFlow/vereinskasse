import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";

type ReceiptItem={productName:string;quantity:number;unitPrice:number;total:number};
type ReceiptAllocation={memberName:string;amount:number;kind:string};
const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const eur=(value:number)=>Number(value||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const cents=(value:number)=>Math.round(Number(value||0)*100);

export async function GET(request:Request){
  const profile=await requireProfile(request);
  if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});
  const id=new URL(request.url).searchParams.get("id");
  if(!id)return Response.json({error:"Belegnummer fehlt"},{status:400});

  const sale=await env.DB.prepare("SELECT s.*,p.tendered,p.change_due changeDue,rr.reward_amount rewardAmount,rr.reward_label rewardLabel,r.id reversalId,r.reason reversalReason,r.operator_name reversalOperatorName,r.created_at reversedAt FROM sales s LEFT JOIN payments p ON p.sale_id=s.id LEFT JOIN random_reward_slots rr ON rr.sale_id=s.id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.id=? AND s.profile_id=?").bind(id,profile.id).first<Record<string,unknown>>();
  if(!sale)return Response.json({error:"Beleg nicht gefunden"},{status:404});
  const [itemsResult,allocationsResult]=await Promise.all([
    env.DB.prepare("SELECT product_name productName,quantity,unit_price unitPrice,total FROM sale_items WHERE sale_id=? ORDER BY id").bind(id).all<ReceiptItem>(),
    env.DB.prepare("SELECT member_name memberName,amount,kind FROM sale_allocations WHERE sale_id=? AND profile_id=? ORDER BY id").bind(id,profile.id).all<ReceiptAllocation>()
  ]);
  const items=itemsResult.results.map(item=>({...item,quantity:Number(item.quantity),unitPrice:Number(item.unitPrice),total:Number(item.total)}));
  const allocations=allocationsResult.results.map(allocation=>({...allocation,amount:Number(allocation.amount)}));
  const itemSubtotal=items.reduce((sum,item)=>sum+item.total,0);
  const rewardAmount=Number(sale.rewardAmount||0);
  const total=Number(sale.total||0);
  const calculated=Math.round((itemSubtotal-rewardAmount)*100)/100;
  const adjustment=Math.abs(calculated-total)>.005?total-calculated:0;
  const allocationsTotal=allocations.reduce((sum,allocation)=>sum+allocation.amount,0);
  const reconciled=cents(calculated+adjustment)===cents(total)&&(!allocations.length||cents(allocationsTotal)===cents(total));

  const rows=items.length
    ?items.map(item=>`<tr><td>${esc(item.quantity)}× ${esc(item.productName)}${item.total===0?" <small>(im Paket enthalten)</small>":""}</td><td>${item.total===0?"inklusive":eur(item.total)}</td></tr>`).join("")
    :`<tr><td>${esc(sale.items)} Artikel <small>(ältere Buchung ohne einzelne Positionsdaten)</small></td><td>${eur(total)}</td></tr>`;
  const rewardRow=rewardAmount>0?`<tr class="reward"><td>★ ${esc(sale.rewardLabel||"Rabatt / Freigetränk")}</td><td>− ${eur(rewardAmount)}</td></tr>`:"";
  const adjustmentRow=adjustment?`<tr class="reward"><td>Preis- oder Rundungsanpassung</td><td>${adjustment>0?"+ ":"− "}${eur(Math.abs(adjustment))}</td></tr>`:"";
  const allocationRows=allocations.length
    ?`<section class="split"><h2>${allocations.length>1?"Aufteilung · Persönliche Anteile":"Gebuchtes Konto"}</h2>${allocations.map(allocation=>`<div><span>${esc(allocation.memberName)}${allocation.kind==="runde"?" <small>(Runde)</small>":""}</span><b>${eur(allocation.amount)}</b></div>`).join("")}<p>Summe der Anteile <strong>${eur(allocationsTotal)}</strong></p></section>`
    :"";
  const method=sale.method==="Vertrauensliste"?"Monatsabrechnung":String(sale.method||"");
  const reversal=sale.reversalId?`<section class="reversal"><strong>STORNIERT</strong><span>${esc(sale.reversalReason||"Korrektur")} · ${new Date(String(sale.reversedAt)).toLocaleString("de-DE")} · ${esc(sale.reversalOperatorName||"Verantwortliche Person unbekannt")}</span></section>`:"";
  const payment=sale.tendered!=null?`<section class="payment"><div><span>Erhalten</span><b>${eur(Number(sale.tendered))}</b></div><div><span>Rückgeld</span><b>${eur(Number(sale.changeDue))}</b></div></section>`:"";
  const html=`<!doctype html><html lang="de"><meta charset="utf-8"><title>Beleg ${esc(id)}</title><style>body{font:15px Arial;max-width:440px;margin:30px auto;padding:20px;color:#172b25}h1{font-size:22px;margin-bottom:5px}h2{font-size:16px}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:8px 0;border-bottom:1px solid #ddd;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}td small,.split small{color:#68766f}.reward{color:#684181;font-weight:bold}.sum{font-size:20px;font-weight:bold;text-align:right}.split{margin:20px 0;padding:12px;background:#f1f6f3;border-left:4px solid #1d5b4c}.split div,.payment div{display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #d9e4de}.split p{display:flex;justify-content:space-between;margin:10px 0 0;padding-top:8px;border-top:2px solid #b9c9c0}.payment{margin:18px 0}.meta{color:#68766f;font-size:12px;line-height:1.5}.reversal{display:flex;flex-direction:column;gap:4px;margin:15px 0;padding:12px;background:#fff0ed;border:2px solid #b53229;color:#8c241d}.check{font-size:12px;text-align:right;color:${reconciled?"#176044":"#a33131"};font-weight:bold}@media print{button{display:none}body{margin:0}}</style><h1>Vereinskasse · ${esc(profile.name)}</h1><div class="meta">Beleg ${esc(id)}<br>${new Date(String(sale.time)).toLocaleString("de-DE")} · ${esc(method)}</div>${reversal}<table>${rows}${rewardRow}${adjustmentRow}</table><p class="sum">Gesamt: ${eur(total)}</p>${allocationRows}${payment}<p class="check">${reconciled?"✓ Beleg rechnerisch vollständig":"⚠ Belegsumme prüfen"}</p><p class="meta">Inklusivartikel werden im Verbrauch erfasst, aber nicht ein zweites Mal berechnet. Geteilte Einkäufe zeigen die verbindlichen persönlichen Anteile.</p><button onclick="print()">Beleg drucken</button></html>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}
