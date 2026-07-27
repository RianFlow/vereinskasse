import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";
import { requireRole } from "../../session";

type Device={id:string;profileId:string};
type Command={id:string;profileId:string;deviceId:string;uid:string;block:number;payloadHex:string;status:string;error:string|null;createdAt:string;expiresAt:string;completedAt:string|null};
type DisplayState={state:string;customerName:string|null;itemsText:string|null;itemCount:number;totalCents:number;revision:string;updatedAt:string};
const headers={"cache-control":"no-store"};
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const uid=(value:unknown)=>String(value||"").trim().toUpperCase();

async function deviceFrom(request:Request){
  const token=request.headers.get("x-rfid-token")?.trim();
  if(!token||token.length<32||token.length>200)return null;
  return env.DB.prepare("SELECT id,profile_id profileId FROM rfid_devices WHERE token_hash=? AND active=1").bind(await hash(token)).first<Device>();
}

export async function GET(request:Request){
  try{
    const device=await deviceFrom(request);
    if(device){
      const now=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE rfid_write_commands SET status='expired',error='Zeitfenster abgelaufen',completed_at=? WHERE device_id=? AND status IN ('pending','processing') AND expires_at<=?").bind(now,device.id,now),
        env.DB.prepare("UPDATE rfid_devices SET last_seen_at=? WHERE id=?").bind(now,device.id)
      ]);
      const command=await env.DB.prepare("SELECT id,uid,block,payload_hex payloadHex,status,expires_at expiresAt FROM rfid_write_commands WHERE device_id=? AND status IN ('pending','processing') AND expires_at>? ORDER BY created_at LIMIT 1").bind(device.id,now).first<{id:string;uid:string;block:number;payloadHex:string;status:string;expiresAt:string}>();
      if(!command){
        const knownRevision=request.headers.get("x-display-revision")||"";
        let display=await env.DB.prepare("SELECT state,customer_name customerName,items_text itemsText,item_count itemCount,total_cents totalCents,revision,updated_at updatedAt FROM rfid_display_states WHERE profile_id=?").bind(device.profileId).first<DisplayState>();
        if(display?.state==="cart"&&Date.parse(display.updatedAt)<Date.now()-90_000){
          const previousRevision=display.revision,revision=crypto.randomUUID(),updatedAt=new Date().toISOString();
          const expired=await env.DB.prepare("UPDATE rfid_display_states SET state='idle',customer_name=NULL,items_text=NULL,item_count=0,total_cents=0,revision=?,updated_at=? WHERE profile_id=? AND revision=?").bind(revision,updatedAt,device.profileId,previousRevision).run();
          display=expired.meta.changes
            ?{state:"idle",customerName:null,itemsText:null,itemCount:0,totalCents:0,revision,updatedAt}
            :await env.DB.prepare("SELECT state,customer_name customerName,items_text itemsText,item_count itemCount,total_cents totalCents,revision,updated_at updatedAt FROM rfid_display_states WHERE profile_id=?").bind(device.profileId).first<DisplayState>();
        }
        if(!display||display.revision===knownRevision)return new Response(null,{status:204,headers});
        return Response.json({command:{action:"display",...display}},{headers});
      }
      if(command.status==="pending"){
        const claimed=await env.DB.prepare("UPDATE rfid_write_commands SET status='processing',claimed_at=? WHERE id=? AND device_id=? AND status='pending'").bind(now,command.id,device.id).run();
        if(!claimed.meta.changes)return new Response(null,{status:204,headers});
      }
      return Response.json({command:{id:command.id,action:command.block===-1?"restart":"write",uid:command.uid,block:command.block,hex:command.payloadHex,expiresAt:command.expiresAt}},{headers});
    }

    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Keine Berechtigung"},{status:403,headers});
    const id=new URL(request.url).searchParams.get("id");
    if(!id||id.length>100)return Response.json({error:"Schreibauftrag fehlt"},{status:400,headers});
    const command=await env.DB.prepare("SELECT id,profile_id profileId,device_id deviceId,uid,block,payload_hex payloadHex,status,error,created_at createdAt,expires_at expiresAt,completed_at completedAt FROM rfid_write_commands WHERE id=? AND profile_id=?").bind(id,profile.id).first<Command>();
    if(!command)return Response.json({error:"Schreibauftrag nicht gefunden"},{status:404,headers});
    return Response.json({command},{headers});
  }catch{
    return Response.json({error:"RFID-Schreibauftrag konnte nicht geladen werden"},{status:500,headers});
  }
}

export async function POST(request:Request){
  try{
    const device=await deviceFrom(request);
    if(!device)return Response.json({error:"RFID-Leser nicht freigegeben"},{status:401,headers});
    const body=await request.json() as {id?:unknown;success?:unknown;uid?:unknown;hex?:unknown;error?:unknown};
    const id=String(body.id||""),scannedUid=uid(body.uid),success=body.success===true;
    if(!id||id.length>100||!scannedUid)return Response.json({error:"Ungültiges Ergebnis"},{status:400,headers});
    const command=await env.DB.prepare("SELECT id,profile_id profileId,uid,payload_hex payloadHex,status FROM rfid_write_commands WHERE id=? AND device_id=?").bind(id,device.id).first<{id:string;profileId:string;uid:string;payloadHex:string;status:string}>();
    if(!command)return Response.json({error:"Schreibauftrag nicht gefunden"},{status:404,headers});
    if(command.status==="succeeded"||command.status==="failed")return Response.json({ok:true,duplicate:true},{headers});
    if(scannedUid!==command.uid)return Response.json({error:"Falsche Karte aufgelegt"},{status:409,headers});
    const returnedHex=String(body.hex||"").toUpperCase().replace(/[^0-9A-F]/g,"");
    if(success&&returnedHex!==command.payloadHex)return Response.json({error:"Rücklesedaten stimmen nicht überein"},{status:400,headers});
    const now=new Date().toISOString(),error=success?null:String(body.error||"Schreiben fehlgeschlagen").slice(0,240);
    await env.DB.batch([
      env.DB.prepare("UPDATE rfid_write_commands SET status=?,error=?,completed_at=? WHERE id=? AND device_id=?").bind(success?"succeeded":"failed",error,now,command.id,device.id),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),success?"RFID_WRITE_SUCCEEDED":"RFID_WRITE_FAILED","rfid_write_command",command.id,device.id,JSON.stringify({profileId:command.profileId,uid:command.uid,error}),now)
    ]);
    return Response.json({ok:true,status:success?"succeeded":"failed"},{headers});
  }catch{
    return Response.json({error:"RFID-Schreibergebnis konnte nicht gespeichert werden"},{status:500,headers});
  }
}

export async function PUT(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Nur der Vorstand darf den RFID-Leser neu starten"},{status:403,headers});
    const body=await request.json() as {deviceId?:unknown},deviceId=String(body.deviceId||"");
    if(!deviceId||deviceId.length>100)return Response.json({error:"RFID-Leser fehlt"},{status:400,headers});
    const device=await env.DB.prepare("SELECT id,name FROM rfid_devices WHERE id=? AND profile_id=? AND active=1").bind(deviceId,profile.id).first<{id:string;name:string}>();
    if(!device)return Response.json({error:"Aktiver RFID-Leser nicht gefunden"},{status:404,headers});
    const active=await env.DB.prepare("SELECT id FROM rfid_write_commands WHERE device_id=? AND status IN ('pending','processing') AND expires_at>? LIMIT 1").bind(device.id,new Date().toISOString()).first();
    if(active)return Response.json({error:"Der Leser bearbeitet gerade einen Kartenauftrag. Bitte danach erneut starten."},{status:409,headers});
    const id=crypto.randomUUID(),now=new Date(),expires=new Date(now.getTime()+45000).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rfid_write_commands (id,profile_id,device_id,uid,block,payload_hex,status,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?,?)").bind(id,profile.id,device.id,"DEVICE-RESTART",-1,"",admin.id,now.toISOString(),expires),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RFID_RESTART_QUEUED","rfid_device",device.id,admin.id,JSON.stringify({profileId:profile.id,name:device.name}),now.toISOString())
    ]);
    return Response.json({ok:true,id},{status:201,headers});
  }catch{
    return Response.json({error:"Neustartauftrag konnte nicht erstellt werden"},{status:500,headers});
  }
}
