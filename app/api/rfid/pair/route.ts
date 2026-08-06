import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";
import { requireRole } from "../../session";

type PairingRequest={
  id:string;hardwareId:string;name:string;codeHash:string;tokenHash:string;status:string;
  deviceId:string|null;failedAttempts:number;createdAt:string;expiresAt:string;
};

const noStore={"cache-control":"no-store"};
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const hardwareId=(value:unknown)=>{
  const normalized=String(value||"").trim().toUpperCase();
  return /^ESP(?:8266|32)-[0-9A-F]{6}$/.test(normalized)?normalized:null;
};
const pairingCode=(value:unknown)=>{
  const normalized=String(value||"").replace(/\s+/g,"");
  return /^\d{6}$/.test(normalized)?normalized:null;
};
const pairingSecret=(value:unknown)=>{
  const normalized=String(value||"").trim();
  return /^[0-9A-Fa-f]{64}$/.test(normalized)?normalized:null;
};
const cleanName=(value:unknown,fallback:string)=>String(value||fallback).trim().replace(/\s+/g," ").slice(0,60)||fallback;

export async function POST(request:Request){
  try{
    const body=await request.json() as {hardwareId?:unknown;code?:unknown;secret?:unknown;name?:unknown};
    const idValue=hardwareId(body.hardwareId),code=pairingCode(body.code),secret=pairingSecret(body.secret);
    if(!idValue||!code||!secret)return Response.json({error:"Ungültige Kopplungsanfrage"},{status:400,headers:noStore});
    const nowDate=new Date(),now=nowDate.toISOString(),expiresAt=new Date(nowDate.getTime()+10*60_000).toISOString();
    await env.DB.prepare("UPDATE rfid_pairing_requests SET status='expired' WHERE status='pending' AND expires_at<=?").bind(now).run();
    const tokenHash=await hash(secret),codeHash=await hash(`${idValue}:${code}`);
    const existing=await env.DB.prepare("SELECT id,code_hash codeHash,token_hash tokenHash,status,expires_at expiresAt FROM rfid_pairing_requests WHERE hardware_id=?").bind(idValue).first<{id:string;codeHash:string;tokenHash:string;status:string;expiresAt:string}>();
    if(existing?.status==="pending"&&existing.expiresAt>now){
      if(existing.tokenHash===tokenHash&&existing.codeHash===codeHash)return Response.json({state:"pending",id:existing.id,hardwareId:idValue,expiresAt:existing.expiresAt},{status:202,headers:noStore});
      return Response.json({error:"Für diesen Leser läuft bereits eine Kopplung. Bitte den angezeigten Code verwenden oder zehn Minuten warten."},{status:409,headers:noStore});
    }
    if(!existing){
      const pending=await env.DB.prepare("SELECT COUNT(*) count FROM rfid_pairing_requests WHERE status='pending' AND expires_at>?").bind(now).first<{count:number}>();
      if(Number(pending?.count||0)>=20)return Response.json({error:"Zu viele offene Kopplungen. Bitte später erneut versuchen."},{status:429,headers:noStore});
    }
    const id=crypto.randomUUID(),name=cleanName(body.name,`RFID-Leser ${idValue.slice(-6)}`);
    await env.DB.prepare("INSERT INTO rfid_pairing_requests (id,hardware_id,name,code_hash,token_hash,status,device_id,failed_attempts,created_at,expires_at,approved_at,consumed_at) VALUES (?,?,?,?,?,'pending',NULL,0,?,?,NULL,NULL) ON CONFLICT(hardware_id) DO UPDATE SET id=excluded.id,name=excluded.name,code_hash=excluded.code_hash,token_hash=excluded.token_hash,status='pending',device_id=NULL,failed_attempts=0,created_at=excluded.created_at,expires_at=excluded.expires_at,approved_at=NULL,consumed_at=NULL").bind(id,idValue,name,codeHash,tokenHash,now,expiresAt).run();
    return Response.json({state:"pending",id,hardwareId:idValue,expiresAt},{status:202,headers:noStore});
  }catch{
    return Response.json({error:"Kopplungsanfrage konnte nicht gespeichert werden"},{status:500,headers:noStore});
  }
}

export async function GET(request:Request){
  try{
    const url=new URL(request.url),secret=pairingSecret(request.headers.get("x-rfid-pairing-secret"));
    if(secret){
      const id=(url.searchParams.get("id")||"").trim();
      if(!id||id.length>100)return Response.json({error:"Kopplungsnummer fehlt"},{status:400,headers:noStore});
      const row=await env.DB.prepare("SELECT id,hardware_id hardwareId,name,code_hash codeHash,token_hash tokenHash,status,device_id deviceId,failed_attempts failedAttempts,created_at createdAt,expires_at expiresAt FROM rfid_pairing_requests WHERE id=? AND token_hash=?").bind(id,await hash(secret)).first<PairingRequest>();
      if(!row)return Response.json({error:"Kopplung nicht gefunden"},{status:404,headers:noStore});
      const now=new Date().toISOString();
      if(row.status==="pending"&&row.expiresAt<=now){
        await env.DB.prepare("UPDATE rfid_pairing_requests SET status='expired' WHERE id=? AND status='pending'").bind(row.id).run();
        return Response.json({state:"expired"},{status:410,headers:noStore});
      }
      if(row.status==="approved"){
        await env.DB.prepare("UPDATE rfid_pairing_requests SET consumed_at=COALESCE(consumed_at,?) WHERE id=?").bind(now,row.id).run();
        return Response.json({state:"approved",deviceId:row.deviceId},{headers:noStore});
      }
      return Response.json({state:row.status,expiresAt:row.expiresAt},{headers:noStore});
    }

    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Systemadmin"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen RFID-Leser koppeln"},{status:403,headers:noStore});
    const now=new Date().toISOString();
    await env.DB.prepare("UPDATE rfid_pairing_requests SET status='expired' WHERE status='pending' AND expires_at<=?").bind(now).run();
    const rows=await env.DB.prepare("SELECT id,hardware_id hardwareId,name,created_at createdAt,expires_at expiresAt FROM rfid_pairing_requests WHERE status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 20").bind(now).all();
    return Response.json({pairings:rows.results},{headers:noStore});
  }catch{
    return Response.json({error:"Offene RFID-Kopplungen konnten nicht geladen werden"},{status:500,headers:noStore});
  }
}

export async function PUT(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Systemadmin"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen RFID-Leser koppeln"},{status:403,headers:noStore});
    const body=await request.json() as {id?:unknown;code?:unknown;name?:unknown};
    const id=String(body.id||"").trim(),code=pairingCode(body.code);
    if(!id||id.length>100||!code)return Response.json({error:"Kopplung und sechsstelliger Code sind erforderlich"},{status:400,headers:noStore});
    const pairing=await env.DB.prepare("SELECT id,hardware_id hardwareId,name,code_hash codeHash,token_hash tokenHash,status,device_id deviceId,failed_attempts failedAttempts,created_at createdAt,expires_at expiresAt FROM rfid_pairing_requests WHERE id=?").bind(id).first<PairingRequest>();
    if(!pairing)return Response.json({error:"Kopplung nicht gefunden"},{status:404,headers:noStore});
    const now=new Date().toISOString();
    if(pairing.status!=="pending"||pairing.expiresAt<=now)return Response.json({error:"Diese Kopplung ist nicht mehr gültig. Am Leser bitte neu starten."},{status:410,headers:noStore});
    if(await hash(`${pairing.hardwareId}:${code}`)!==pairing.codeHash){
      const attempts=Number(pairing.failedAttempts||0)+1,status=attempts>=5?"rejected":"pending";
      await env.DB.batch([
        env.DB.prepare("UPDATE rfid_pairing_requests SET failed_attempts=?,status=? WHERE id=? AND status='pending'").bind(attempts,status,pairing.id),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RFID_PAIRING_CODE_REJECTED","rfid_pairing",pairing.id,admin.id,JSON.stringify({profileId:profile.id,hardwareId:pairing.hardwareId,attempt:attempts}),now)
      ]);
      return Response.json({error:attempts>=5?"Zu viele falsche Versuche. Am Leser bitte einen neuen Code erzeugen.":"Der Code stimmt nicht mit diesem Leser überein."},{status:403,headers:noStore});
    }
    const existing=await env.DB.prepare("SELECT id,name,profile_id profileId FROM rfid_devices WHERE hardware_id=?").bind(pairing.hardwareId).first<{id:string;name:string;profileId:string}>();
    const deviceId=existing?.id||`RFID-${crypto.randomUUID()}`,name=cleanName(body.name,pairing.name);
    const claimed=await env.DB.prepare("UPDATE rfid_pairing_requests SET status='approving' WHERE id=? AND status='pending' AND expires_at>?").bind(pairing.id,now).run();
    if(!claimed.meta.changes)return Response.json({error:"Diese Kopplung wurde bereits bearbeitet"},{status:409,headers:noStore});
    const statements=existing
      ?[env.DB.prepare("UPDATE rfid_devices SET profile_id=?,name=?,token_hash=?,active=1,last_seen_at=NULL,created_by=? WHERE id=?").bind(profile.id,name,pairing.tokenHash,admin.id,deviceId)]
      :[env.DB.prepare("INSERT INTO rfid_devices (id,profile_id,name,hardware_id,token_hash,active,last_seen_at,created_by,created_at) VALUES (?,?,?,?,?,1,NULL,?,?)").bind(deviceId,profile.id,name,pairing.hardwareId,pairing.tokenHash,admin.id,now)];
    statements.push(
      env.DB.prepare("UPDATE rfid_pairing_requests SET status='approved',device_id=?,approved_at=? WHERE id=? AND status='approving'").bind(deviceId,now,pairing.id),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),existing?"RFID_DEVICE_REPAIRED":"RFID_DEVICE_PAIRED","rfid_device",deviceId,admin.id,JSON.stringify({profileId:profile.id,hardwareId:pairing.hardwareId,name,previousProfileId:existing?.profileId||null}),now)
    );
    try{await env.DB.batch(statements)}catch(error){await env.DB.prepare("UPDATE rfid_pairing_requests SET status='pending' WHERE id=? AND status='approving' AND expires_at>?").bind(pairing.id,new Date().toISOString()).run();throw error}
    return Response.json({ok:true,device:{id:deviceId,name,hardwareId:pairing.hardwareId,active:true,lastSeenAt:null,createdAt:now}},{headers:noStore});
  }catch{
    return Response.json({error:"RFID-Leser konnte nicht gekoppelt werden"},{status:500,headers:noStore});
  }
}

export async function DELETE(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Systemadmin"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen Kopplungen verwerfen"},{status:403,headers:noStore});
    const body=await request.json() as {id?:unknown};
    const id=String(body.id||"").trim();
    if(!id||id.length>100)return Response.json({error:"Kopplung fehlt"},{status:400,headers:noStore});
    const pairing=await env.DB.prepare("SELECT hardware_id hardwareId FROM rfid_pairing_requests WHERE id=? AND status='pending'").bind(id).first<{hardwareId:string}>();
    if(!pairing)return Response.json({error:"Offene Kopplung nicht gefunden"},{status:404,headers:noStore});
    const now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE rfid_pairing_requests SET status='rejected' WHERE id=? AND status='pending'").bind(id),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RFID_PAIRING_REJECTED","rfid_pairing",id,admin.id,JSON.stringify({profileId:profile.id,hardwareId:pairing.hardwareId}),now)
    ]);
    return Response.json({ok:true},{headers:noStore});
  }catch{
    return Response.json({error:"Kopplung konnte nicht verworfen werden"},{status:500,headers:noStore});
  }
}
