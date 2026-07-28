import { env } from "cloudflare:workers";
import { requireRole } from "../session";
import { requireProfile } from "../profile-session";

type EventRow={id:string;name:string;startsAt:string;endsAt:string|null;status:string;notes:string|null;createdBy:string;salesCount:number;itemsCount:number;revenue:number};
type ProductRow={productId:number;productName:string;quantity:number;total:number};

const listSql=`SELECT e.id,e.name,e.starts_at startsAt,e.ends_at endsAt,e.status,e.notes,e.created_by createdBy,
  (SELECT COUNT(*) FROM sales s LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.event_id=e.id AND r.id IS NULL) salesCount,
  COALESCE((SELECT SUM(s.total) FROM sales s LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.event_id=e.id AND r.id IS NULL),0) revenue,
  COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.event_id=e.id AND r.id IS NULL AND si.counts_for_consumption=1),0) itemsCount
  FROM events e WHERE e.profile_id=? ORDER BY CASE WHEN e.status='active' THEN 0 ELSE 1 END,e.starts_at DESC`;

export async function GET(request:Request){
  try{
    const profile=await requireProfile(request);if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});
    const id=new URL(request.url).searchParams.get("id");
    const events=await env.DB.prepare(listSql).bind(profile.id).all<EventRow>();
    if(!id)return Response.json({events:events.results});
    const selected=events.results.find(e=>e.id===id);if(!selected)return Response.json({error:"Veranstaltung nicht gefunden"},{status:404});
    const products=await env.DB.prepare("SELECT si.product_id productId,si.product_name productName,SUM(si.quantity) quantity,ROUND(SUM(si.total),2) total FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.event_id=? AND r.id IS NULL AND si.counts_for_consumption=1 GROUP BY si.product_id,si.product_name ORDER BY quantity DESC,si.product_name").bind(id).all<ProductRow>();
    const previous=events.results.filter(e=>e.startsAt<selected.startsAt&&e.id!==id).sort((a,b)=>b.startsAt.localeCompare(a.startsAt))[0]||null;
    const previousProducts=previous?await env.DB.prepare("SELECT si.product_id productId,si.product_name productName,SUM(si.quantity) quantity,ROUND(SUM(si.total),2) total FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.event_id=? AND r.id IS NULL AND si.counts_for_consumption=1 GROUP BY si.product_id,si.product_name").bind(previous.id).all<ProductRow>():{results:[] as ProductRow[]};
    const current=new Map(products.results.map(p=>[p.productId,p])),comparison=new Map(previousProducts.results.map(p=>[p.productId,p]));
    const productIds=[...new Set([...current.keys(),...comparison.keys()])];
    const rows=productIds.map(productId=>{const now=current.get(productId),before=comparison.get(productId),quantity=Number(now?.quantity||0);return {productId,productName:now?.productName||before?.productName||"Unbekannter Artikel",quantity,total:Number(now?.total||0),previousQuantity:Number(before?.quantity||0),recommendedQuantity:Math.ceil(quantity*1.1)}}).sort((a,b)=>b.quantity-a.quantity||a.productName.localeCompare(b.productName,"de"));
    return Response.json({event:selected,previous,products:rows});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Veranstaltungen konnten nicht geladen werden"},{status:500})}
}

export async function POST(request:Request){
  try{
    const [operator,profile]=await Promise.all([requireRole(request,["Vorstand","Kassenwart","Kassendienst"]),requireProfile(request)]);if(!operator||!profile)return Response.json({error:"Keine Berechtigung"},{status:403});
    const body=await request.json() as {name?:string;notes?:string};const name=(body.name||"").trim().slice(0,80);if(name.length<3)return Response.json({error:"Bitte einen Veranstaltungsnamen eingeben"},{status:400});
    if(await env.DB.prepare("SELECT id FROM events WHERE profile_id=? AND status='active' LIMIT 1").bind(profile.id).first())return Response.json({error:"Bitte zuerst die laufende Veranstaltung beenden"},{status:409});
    const id=`EVENT-${crypto.randomUUID()}`,now=new Date().toISOString(),notes=(body.notes||"").trim().slice(0,300)||null;
    await env.DB.batch([env.DB.prepare("INSERT INTO events (id,profile_id,name,starts_at,status,notes,created_by,created_at) VALUES (?,?,?,?,'active',?,?,?)").bind(id,profile.id,name,now,notes,operator.id,now),env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"EVENT_CREATED","event",id,operator.id,JSON.stringify({profileId:profile.id,name}),now)]);
    await env.BACKUPS.put(`events/${now.slice(0,10)}/${id}.json`,JSON.stringify({id,name,notes,status:"active",createdBy:operator,createdAt:now}),{httpMetadata:{contentType:"application/json"}});
    return Response.json({ok:true,event:{id,name,startsAt:now,endsAt:null,status:"active",notes,createdBy:operator.id,salesCount:0,itemsCount:0,revenue:0}},{status:201});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Veranstaltung konnte nicht angelegt werden"},{status:500})}
}

export async function PATCH(request:Request){
  try{
    const [operator,profile]=await Promise.all([requireRole(request,["Vorstand","Kassenwart","Kassendienst"]),requireProfile(request)]);if(!operator||!profile)return Response.json({error:"Keine Berechtigung"},{status:403});
    const body=await request.json() as {id?:string;action?:"close"|"reopen"};if(!body.id||!body.action)return Response.json({error:"Ungültige Aktion"},{status:400});
    const event=await env.DB.prepare("SELECT id,name,status FROM events WHERE id=? AND profile_id=?").bind(body.id,profile.id).first<{id:string;name:string;status:string}>();if(!event)return Response.json({error:"Veranstaltung nicht gefunden"},{status:404});
    if(body.action==="reopen"&&await env.DB.prepare("SELECT id FROM events WHERE profile_id=? AND status='active' AND id<>? LIMIT 1").bind(profile.id,body.id).first())return Response.json({error:"Es läuft bereits eine andere Veranstaltung"},{status:409});
    const now=new Date().toISOString(),status=body.action==="close"?"closed":"active",endsAt=body.action==="close"?now:null;
    await env.DB.batch([env.DB.prepare("UPDATE events SET status=?,ends_at=? WHERE id=? AND profile_id=?").bind(status,endsAt,body.id,profile.id),env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),body.action==="close"?"EVENT_CLOSED":"EVENT_REOPENED","event",body.id,operator.id,JSON.stringify({profileId:profile.id,name:event.name}),now)]);
    return Response.json({ok:true,status,endsAt});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Veranstaltung konnte nicht geändert werden"},{status:500})}
}
