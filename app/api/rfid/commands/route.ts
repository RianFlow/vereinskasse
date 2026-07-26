import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";
import { requireRole } from "../../session";

type Device={id:string;profileId:string};
type Command={id:string;profileId:string;deviceId:string;uid:string;block:number;payloadHex:string;status:string;error:string|null;createdAt:string;expiresAt:string;completedAt:string|null};
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
      if(!command)return new Response(null,{status:204,headers});
      if(command.status==="pending"){
        const claimed=await env.DB.prepare("UPDATE rfid_write_commands SET status='processing',claimed_at=? WHERE id=? AND device_id=? AND status='pending'").bind(now,command.id,device.id).run();
        if(!claimed.meta.changes)return new Response(null,{status:204,headers});
      }
      return Response.json({command:{id:command.id,uid:command.uid,block:command.block,hex:command.payloadHex,expiresAt:command.expiresAt}},{headers});
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
