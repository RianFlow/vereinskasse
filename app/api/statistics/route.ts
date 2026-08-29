import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { requireRole } from "../session";

type SaleRow={id:string;time:string;total:number;items:number;memberId:string;memberName:string;method:string};
type ItemRow={saleId:string;saleMemberId:string;productId:number;productName:string;quantity:number;total:number};
type AllocationRow={saleId:string;memberId:string;memberName:string;amount:number};
type MemberRow={id:string;name:string};
type ProductRow={id:number;name:string};

const asNumber=(value:unknown)=>Number(value||0);
const rounded=(value:number,digits=2)=>Number(value.toFixed(digits));
const change=(current:number,previous:number)=>previous>0?rounded((current-previous)/previous*100,1):current>0?null:0;

function buildTrend(sales:SaleRow[],items:ItemRow[],from:number,to:number,days:number){
  const count=days===30?15:days===90?13:12,span=(to-from)/count;
  const format=new Intl.DateTimeFormat("de-DE",days===365?{timeZone:"Europe/Berlin",month:"short"}:{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit"});
  const buckets=Array.from({length:count},(_,index)=>({label:format.format(new Date(from+index*span)),revenue:0,items:0,sales:0}));
  const saleBucket=new Map<string,number>();
  for(const sale of sales){const index=Math.min(count-1,Math.max(0,Math.floor((Date.parse(sale.time)-from)/span)));saleBucket.set(sale.id,index);buckets[index].revenue+=asNumber(sale.total);buckets[index].sales+=1}
  for(const item of items){const index=saleBucket.get(item.saleId);if(index!==undefined)buckets[index].items+=asNumber(item.quantity)}
  return buckets.map(bucket=>({...bucket,revenue:rounded(bucket.revenue),items:rounded(bucket.items)}));
}

export async function GET(request:Request){
  try{
    const [operator,profile]=await Promise.all([requireRole(request,["Vorstand","Kassenwart"]),requireProfile(request)]);
    if(!operator||!profile)return Response.json({error:"Statistiken dürfen nur Vorstand und Kassenwart einsehen."},{status:403});
    const url=new URL(request.url),requestedDays=Number(url.searchParams.get("days")||90),days=[30,90,365].includes(requestedDays)?requestedDays:90;
    const productParam=url.searchParams.get("productId"),selectedProductId=productParam&&/^\d+$/.test(productParam)?Number(productParam):null,rankingMode=url.searchParams.get("ranking")==="all"?"all":"period";
    const now=Date.now(),periodMs=days*24*60*60*1000,from=now-periodMs,previousFrom=from-periodMs,toIso=new Date(now).toISOString(),fromIso=new Date(from).toISOString(),previousFromIso=new Date(previousFrom).toISOString();
    const [salesResult,itemsResult,allocationsResult,membersResult,productsResult]=await Promise.all([
      env.DB.prepare("SELECT s.id,s.time,s.total,s.items,s.member_id memberId,s.member memberName,s.method FROM sales s LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.profile_id=? AND s.time>=? AND s.time<? AND r.id IS NULL ORDER BY s.time").bind(profile.id,previousFromIso,toIso).all<SaleRow>(),
      env.DB.prepare("SELECT si.sale_id saleId,s.member_id saleMemberId,si.product_id productId,si.product_name productName,si.quantity,si.total FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.profile_id=? AND s.time>=? AND s.time<? AND r.id IS NULL AND si.counts_for_consumption=1").bind(profile.id,previousFromIso,toIso).all<ItemRow>(),
      env.DB.prepare("SELECT sa.sale_id saleId,sa.member_id memberId,sa.member_name memberName,sa.amount FROM sale_allocations sa JOIN sales s ON s.id=sa.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE sa.profile_id=? AND s.time>=? AND s.time<? AND r.id IS NULL").bind(profile.id,fromIso,toIso).all<AllocationRow>(),
      env.DB.prepare("SELECT id,name FROM members ORDER BY name").all<MemberRow>(),
      env.DB.prepare("SELECT id,name FROM products WHERE profile_id=? ORDER BY name").bind(profile.id).all<ProductRow>(),
    ]);
    const allSales=salesResult.results.map(row=>({...row,total:asNumber(row.total),items:asNumber(row.items)})),currentSales=allSales.filter(row=>row.time>=fromIso),previousSales=allSales.filter(row=>row.time<fromIso);
    const currentSaleIds=new Set(currentSales.map(sale=>sale.id)),previousSaleIds=new Set(previousSales.map(sale=>sale.id));
    const allItems=itemsResult.results.map(row=>({...row,productId:Number(row.productId),quantity:asNumber(row.quantity),total:asNumber(row.total)})),currentItems=allItems.filter(item=>currentSaleIds.has(item.saleId)),previousItems=allItems.filter(item=>previousSaleIds.has(item.saleId));
    const currentRevenue=currentSales.reduce((sum,row)=>sum+row.total,0),previousRevenue=previousSales.reduce((sum,row)=>sum+row.total,0),currentQuantity=currentItems.reduce((sum,row)=>sum+row.quantity,0),previousQuantity=previousItems.reduce((sum,row)=>sum+row.quantity,0);
    const productMap=new Map<number,{productId:number;productName:string;quantity:number;revenue:number}>();
    for(const product of productsResult.results)productMap.set(Number(product.id),{productId:Number(product.id),productName:product.name,quantity:0,revenue:0});
    for(const item of currentItems){const row=productMap.get(item.productId)||{productId:item.productId,productName:item.productName,quantity:0,revenue:0};row.quantity+=item.quantity;row.revenue+=item.total;productMap.set(item.productId,row)}
    const productRows=[...productMap.values()].map(row=>({...row,quantity:rounded(row.quantity),revenue:rounded(row.revenue)})),topProducts=[...productRows].sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue||a.productName.localeCompare(b.productName,"de")).slice(0,8),lowProducts=[...productRows].sort((a,b)=>a.quantity-b.quantity||a.revenue-b.revenue||a.productName.localeCompare(b.productName,"de")).slice(0,5);
    const [rankingItems,rankingAllocations]=rankingMode==="all"?await Promise.all([
      env.DB.prepare("SELECT si.sale_id saleId,s.member_id saleMemberId,si.product_id productId,si.product_name productName,si.quantity,si.total FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.profile_id=? AND r.id IS NULL AND si.counts_for_consumption=1").bind(profile.id).all<ItemRow>().then(result=>result.results.map(row=>({...row,productId:Number(row.productId),quantity:asNumber(row.quantity),total:asNumber(row.total)}))),
      env.DB.prepare("SELECT sa.sale_id saleId,sa.member_id memberId,sa.member_name memberName,sa.amount FROM sale_allocations sa JOIN sales s ON s.id=sa.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE sa.profile_id=? AND r.id IS NULL").bind(profile.id).all<AllocationRow>().then(result=>result.results),
    ]):[currentItems,allocationsResult.results];
    const allocationsBySale=new Map<string,AllocationRow[]>();for(const allocation of rankingAllocations){const rows=allocationsBySale.get(allocation.saleId)||[];rows.push({...allocation,amount:asNumber(allocation.amount)});allocationsBySale.set(allocation.saleId,rows)}
    const memberMap=new Map(membersResult.results.map(member=>[member.id,member])),memberTotals=new Map<string,{memberId:string;memberName:string;quantity:number;estimated:boolean}>();
    const currentMemberIds=new Set<string>();
    for(const sale of currentSales)if(memberMap.has(sale.memberId))currentMemberIds.add(sale.memberId);
    for(const allocation of allocationsResult.results)if(memberMap.has(allocation.memberId))currentMemberIds.add(allocation.memberId);
    const addMember=(memberId:string,quantity:number,estimated:boolean)=>{const member=memberMap.get(memberId);if(!member||quantity<=0)return;const row=memberTotals.get(memberId)||{memberId,memberName:member.name,quantity:0,estimated:false};row.quantity+=quantity;row.estimated||=estimated;memberTotals.set(memberId,row)};
    for(const item of rankingItems){
      if(selectedProductId!==null&&item.productId!==selectedProductId)continue;
      const allocations=allocationsBySale.get(item.saleId)||[];
      if(allocations.length){const allocationTotal=allocations.reduce((sum,row)=>sum+Math.max(0,row.amount),0);if(allocationTotal>0)for(const allocation of allocations)addMember(allocation.memberId,item.quantity*Math.max(0,allocation.amount)/allocationTotal,allocations.length>1)}
      else addMember(item.saleMemberId,item.quantity,false);
    }
    const memberRanking=[...memberTotals.values()].map(row=>({...row,quantity:rounded(row.quantity)})).sort((a,b)=>b.quantity-a.quantity||a.memberName.localeCompare(b.memberName,"de")).slice(0,10);
    const paymentMap=new Map<string,{method:string;revenue:number;sales:number}>();for(const sale of currentSales){const row=paymentMap.get(sale.method)||{method:sale.method,revenue:0,sales:0};row.revenue+=sale.total;row.sales+=1;paymentMap.set(sale.method,row)}
    const paymentMethods=[...paymentMap.values()].map(row=>({...row,revenue:rounded(row.revenue)})).sort((a,b)=>b.revenue-a.revenue);
    const hourMap=new Map<number,number>();for(const sale of currentSales){const hour=Number(new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",hourCycle:"h23"}).format(new Date(sale.time)));hourMap.set(hour,(hourMap.get(hour)||0)+1)}
    const peakHours=[...hourMap].map(([hour,sales])=>({hour,label:`${String(hour).padStart(2,"0")}:00–${String((hour+1)%24).padStart(2,"0")}:00`,sales})).sort((a,b)=>b.sales-a.sales||a.hour-b.hour).slice(0,3);
    const selectedProduct=selectedProductId===null?null:productRows.find(product=>product.productId===selectedProductId)||null;
    return Response.json({
      period:{days,from:fromIso,to:toIso,label:`Letzte ${days} Tage`},ranking:{mode:rankingMode,label:rankingMode==="all"?"Ewige Rangliste":`Rangliste · ${days} Tage`},selectedProduct,
      summary:{revenue:rounded(currentRevenue),sales:currentSales.length,items:rounded(currentQuantity),members:currentMemberIds.size},
      previous:{revenue:rounded(previousRevenue),sales:previousSales.length,items:rounded(previousQuantity)},
      changes:{revenue:change(currentRevenue,previousRevenue),sales:change(currentSales.length,previousSales.length),items:change(currentQuantity,previousQuantity)},
      trend:buildTrend(currentSales,currentItems,from,now,days),products:productRows.map(({productId,productName})=>({productId,productName})),topProducts,lowProducts,memberRanking,paymentMethods,peakHours,
      note:"Die Rangliste zeigt auf Mitgliedsnamen gebuchte Mengen. Bei geteilten Bestellungen werden Artikel proportional zum jeweiligen Anteil geschätzt.",
    },{headers:{"cache-control":"no-store"}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Statistiken konnten nicht geladen werden."},{status:500})}
}
