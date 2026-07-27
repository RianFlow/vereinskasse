import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";

const headers={"cache-control":"no-store"};

export async function POST(request:Request){
  try{
    const profile=await requireProfile(request);
    if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401,headers});
    const body=await request.json() as {state?:unknown;customerName?:unknown;itemCount?:unknown;totalCents?:unknown};
    const state=body.state==="cart"?"cart":"idle";
    const itemCount=Math.trunc(Number(body.itemCount||0));
    const totalCents=Math.trunc(Number(body.totalCents||0));
    const customerName=String(body.customerName||"").trim().slice(0,60)||null;
    if(itemCount<0||itemCount>999||totalCents<0||totalCents>9999999)
      return Response.json({error:"Ungültiger Displayinhalt"},{status:400,headers});
    const now=new Date().toISOString(),revision=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO rfid_display_states (profile_id,state,customer_name,item_count,total_cents,revision,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET state=excluded.state,customer_name=excluded.customer_name,item_count=excluded.item_count,total_cents=excluded.total_cents,revision=excluded.revision,updated_at=excluded.updated_at")
      .bind(profile.id,state,customerName,state==="cart"?itemCount:0,state==="cart"?totalCents:0,revision,now).run();
    return Response.json({ok:true,revision},{headers});
  }catch{
    return Response.json({error:"Kundendisplay konnte nicht aktualisiert werden"},{status:500,headers});
  }
}
