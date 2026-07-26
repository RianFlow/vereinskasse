import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { sessionUser } from "../session";

type RfidDevice={id:string;profileId:string;name:string};
type RfidScan={id:string;uid:string;deviceId:string;deviceName:string;cardType:string|null;blocks:number|null;createdAt:string};
type RfidMember={id:string;name:string;role:string;initials:string};

const jsonHeaders={"cache-control":"no-store"};
const normalizeUid=(value:unknown)=>{
  const compact=String(value||"").toUpperCase().replace(/[^0-9A-F]/g,"");
  if(![8,14,20].includes(compact.length))return null;
  return compact.match(/.{2}/g)!.join(":");
};
const hex=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");

export async function POST(request:Request){
  try{
    const token=request.headers.get("x-rfid-token")?.trim();
    if(!token||token.length<32||token.length>200)return Response.json({error:"RFID-Gerätekennung fehlt"},{status:401,headers:jsonHeaders});
    const device=await env.DB.prepare("SELECT id,profile_id profileId,name FROM rfid_devices WHERE token_hash=? AND active=1").bind(await hex(token)).first<RfidDevice>();
    if(!device)return Response.json({error:"RFID-Leser nicht freigegeben"},{status:401,headers:jsonHeaders});
    const body=await request.json() as {uid?:unknown;type?:unknown;blocks?:unknown};
    const uid=normalizeUid(body.uid),cardType=String(body.type||"").trim().slice(0,60)||null,blocks=Number(body.blocks);
    if(!uid)return Response.json({error:"Ungültige RFID-UID"},{status:400,headers:jsonHeaders});
    if(body.blocks!=null&&(!Number.isInteger(blocks)||blocks<1||blocks>512))return Response.json({error:"Ungültige Blockanzahl"},{status:400,headers:jsonHeaders});
    const now=new Date(),nowIso=now.toISOString(),duplicateCutoff=new Date(now.getTime()-2500).toISOString();
    const duplicate=await env.DB.prepare("SELECT id FROM rfid_scans WHERE device_id=? AND uid=? AND created_at>=? ORDER BY created_at DESC LIMIT 1").bind(device.id,uid,duplicateCutoff).first<{id:string}>();
    await env.DB.prepare("UPDATE rfid_devices SET last_seen_at=? WHERE id=?").bind(nowIso,device.id).run();
    if(duplicate)return Response.json({accepted:true,id:duplicate.id,duplicate:true},{status:202,headers:jsonHeaders});
    const id=crypto.randomUUID(),expiresAt=new Date(now.getTime()+30_000).toISOString();
    await env.DB.prepare("INSERT INTO rfid_scans (id,profile_id,device_id,uid,card_type,blocks,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?,?,?,NULL)").bind(id,device.profileId,device.id,uid,cardType,Number.isInteger(blocks)?blocks:null,nowIso,expiresAt).run();
    return Response.json({accepted:true,id},{status:202,headers:jsonHeaders});
  }catch{
    return Response.json({error:"RFID-Scan konnte nicht angenommen werden"},{status:500,headers:jsonHeaders});
  }
}

export async function GET(request:Request){
  try{
    const profile=await requireProfile(request);
    if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401,headers:jsonHeaders});
    const now=new Date().toISOString();
    const [scan,deviceCount]=await Promise.all([
      env.DB.prepare("SELECT s.id,s.uid,s.device_id deviceId,d.name deviceName,s.card_type cardType,s.blocks,s.created_at createdAt FROM rfid_scans s JOIN rfid_devices d ON d.id=s.device_id WHERE s.profile_id=? AND s.consumed_at IS NULL AND s.expires_at>? ORDER BY s.created_at LIMIT 1").bind(profile.id,now).first<RfidScan>(),
      env.DB.prepare("SELECT COUNT(*) count FROM rfid_devices WHERE profile_id=? AND active=1").bind(profile.id).first<{count:number}>()
    ]);
    if(!scan)return Response.json({state:"waiting",deviceCount:Number(deviceCount?.count||0)},{headers:jsonHeaders});
    const consumed=await env.DB.prepare("UPDATE rfid_scans SET consumed_at=? WHERE id=? AND profile_id=? AND consumed_at IS NULL").bind(now,scan.id,profile.id).run();
    if(!consumed.meta.changes)return Response.json({state:"waiting",deviceCount:Number(deviceCount?.count||0)},{headers:jsonHeaders});
    const member=await env.DB.prepare("SELECT m.id,m.name,m.role,m.initials FROM rfid_cards c JOIN members m ON m.id=c.member_id WHERE c.profile_id=? AND c.uid=? AND m.active=1").bind(profile.id,scan.uid).first<RfidMember>();
    return Response.json({state:member?"recognized":"unknown",deviceCount:Number(deviceCount?.count||0),scan,member:member||null},{headers:jsonHeaders});
  }catch{
    return Response.json({error:"RFID-Leser ist momentan nicht erreichbar"},{status:500,headers:jsonHeaders});
  }
}

export async function PUT(request:Request){
  try{
    const profile=await requireProfile(request);
    if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401,headers:jsonHeaders});
    const body=await request.json() as {scanId?:string;memberId?:string};
    if(!body.scanId||body.scanId.length>100||!body.memberId||body.memberId.length>100)return Response.json({error:"Scan und Mitglied sind erforderlich"},{status:400,headers:jsonHeaders});
    const [scan,member,operator]=await Promise.all([
      env.DB.prepare("SELECT id,uid,device_id deviceId FROM rfid_scans WHERE id=? AND profile_id=?").bind(body.scanId,profile.id).first<{id:string;uid:string;deviceId:string}>(),
      env.DB.prepare("SELECT id,name,role,initials FROM members WHERE id=? AND active=1").bind(body.memberId).first<RfidMember>(),
      sessionUser(request)
    ]);
    if(!scan)return Response.json({error:"Der Kartenscan ist abgelaufen. Karte bitte erneut auflegen."},{status:404,headers:jsonHeaders});
    if(!member)return Response.json({error:"Mitglied nicht gefunden"},{status:404,headers:jsonHeaders});
    const now=new Date().toISOString(),id=crypto.randomUUID(),operatorId=operator?.id||`PROFILE-${profile.id}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rfid_cards (id,profile_id,uid,member_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(profile_id,uid) DO UPDATE SET member_id=excluded.member_id,updated_at=excluded.updated_at").bind(id,profile.id,scan.uid,member.id,now,now),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RFID_CARD_ASSIGNED","rfid_card",scan.uid,operatorId,JSON.stringify({profileId:profile.id,memberId:member.id,deviceId:scan.deviceId}),now)
    ]);
    return Response.json({ok:true,member},{headers:jsonHeaders});
  }catch{
    return Response.json({error:"RFID-Karte konnte nicht zugeordnet werden"},{status:500,headers:jsonHeaders});
  }
}
