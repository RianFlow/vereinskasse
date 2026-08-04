import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";
import { hasRole, requireRole } from "../../session";

const noStore={"cache-control":"no-store"};
const hex=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");

export async function GET(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Systemadmin"]),requireProfile(request)]);
  if(!admin||!profile)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen RFID-Leser verwalten"},{status:403,headers:noStore});
  const [rows,cards]=await Promise.all([
    env.DB.prepare("SELECT id,name,hardware_id hardwareId,active,last_seen_at lastSeenAt,created_at createdAt FROM rfid_devices WHERE profile_id=? ORDER BY active DESC,name").bind(profile.id).all(),
    env.DB.prepare("SELECT c.uid,c.member_id memberId,m.name memberName,c.updated_at updatedAt FROM rfid_cards c JOIN members m ON m.id=c.member_id WHERE c.profile_id=? ORDER BY m.name,c.uid").bind(profile.id).all()
  ]);
  return Response.json({devices:rows.results,cards:cards.results},{headers:noStore});
}

export async function POST(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Systemadmin"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen RFID-Leser verwalten"},{status:403,headers:noStore});
    const body=await request.json() as {name?:string};
    const name=(body.name||"").trim().replace(/\s+/g," ").slice(0,60);
    if(name.length<3)return Response.json({error:"Bitte einen eindeutigen Gerätenamen eingeben"},{status:400,headers:noStore});
    const id=`RFID-${crypto.randomUUID()}`,token=`vrfid_${crypto.randomUUID().replaceAll("-","")}${crypto.randomUUID().replaceAll("-","")}`,now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rfid_devices (id,profile_id,name,hardware_id,token_hash,active,last_seen_at,created_by,created_at) VALUES (?,?,?,NULL,?,1,NULL,?,?)").bind(id,profile.id,name,await hex(token),admin.id,now),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RFID_DEVICE_CREATED","rfid_device",id,admin.id,JSON.stringify({profileId:profile.id,name}),now)
    ]);
    return Response.json({ok:true,device:{id,name,active:true,lastSeenAt:null,createdAt:now},token},{status:201,headers:noStore});
  }catch{
    return Response.json({error:"RFID-Leser konnte nicht eingerichtet werden"},{status:500,headers:noStore});
  }
}

export async function PATCH(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Systemadmin"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen RFID-Leser verwalten"},{status:403,headers:noStore});
    const body=await request.json() as {id?:string;active?:boolean};
    if(!body.id||body.id.length>100||typeof body.active!=="boolean")return Response.json({error:"Ungültige Geräteänderung"},{status:400,headers:noStore});
    const device=await env.DB.prepare("SELECT id,name FROM rfid_devices WHERE id=? AND profile_id=?").bind(body.id,profile.id).first<{id:string;name:string}>();
    if(!device)return Response.json({error:"RFID-Leser nicht gefunden"},{status:404,headers:noStore});
    const now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE rfid_devices SET active=? WHERE id=? AND profile_id=?").bind(body.active?1:0,device.id,profile.id),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),body.active?"RFID_DEVICE_ENABLED":"RFID_DEVICE_DISABLED","rfid_device",device.id,admin.id,JSON.stringify({profileId:profile.id,name:device.name}),now)
    ]);
    return Response.json({ok:true},{headers:noStore});
  }catch{
    return Response.json({error:"RFID-Leser konnte nicht geändert werden"},{status:500,headers:noStore});
  }
}

export async function DELETE(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Systemadmin"]),requireProfile(request)]);
    if(!admin||!profile)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen Kartenzuordnungen entfernen"},{status:403,headers:noStore});
    const body=await request.json() as {uid?:string};
    const uid=(body.uid||"").trim().toUpperCase();
    if(!/^(?:[0-9A-F]{2}:){3,9}[0-9A-F]{2}$/.test(uid))return Response.json({error:"Ungültige Karten-UID"},{status:400,headers:noStore});
    const card=await env.DB.prepare("SELECT c.member_id memberId,m.role FROM rfid_cards c JOIN members m ON m.id=c.member_id WHERE c.profile_id=? AND c.uid=?").bind(profile.id,uid).first<{memberId:string;role:string}>();
    if(!card)return Response.json({error:"Kartenzuordnung nicht gefunden"},{status:404,headers:noStore});
    if(!hasRole(admin,"Vorstand")&&(hasRole(card,"Vorstand")||hasRole(card,"Kassenwart")))return Response.json({error:"RFID-Karten von Vorstand oder Kassenwart dürfen nur durch den Vorstand entfernt werden"},{status:403,headers:noStore});
    const now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rfid_cards WHERE profile_id=? AND uid=?").bind(profile.id,uid),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RFID_CARD_UNASSIGNED","rfid_card",uid,admin.id,JSON.stringify({profileId:profile.id,memberId:card.memberId}),now)
    ]);
    return Response.json({ok:true},{headers:noStore});
  }catch{
    return Response.json({error:"Kartenzuordnung konnte nicht entfernt werden"},{status:500,headers:noStore});
  }
}
