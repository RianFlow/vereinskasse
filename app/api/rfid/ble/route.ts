import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";
import { requireRole } from "../../session";

type Device={
  id:string;profileId:string;name:string;hardwareId:string;tokenHash:string;active:number;
  bleSessionId:string|null;bleSessionCounter:number;bleSessionExpiresAt:string|null;
};
type Command={id:string;uid:string;block:number;payloadHex:string;status:string;expiresAt:string};

const headers={"cache-control":"no-store"};
const encoder=new TextEncoder();
const cleanHardwareId=(value:unknown)=>{const result=String(value||"").trim().toUpperCase();return /^ESP32-[0-9A-F]{6}$/.test(result)?result:null};
const cleanUid=(value:unknown)=>{const compact=String(value||"").toUpperCase().replace(/[^0-9A-F]/g,"");return [8,14,20].includes(compact.length)?compact.match(/.{2}/g)!.join(":"):null};
const cleanHex=(value:unknown,length:number)=>{const result=String(value||"").trim().toLowerCase();return new RegExp(`^[0-9a-f]{${length}}$`).test(result)?result:null};
const bytesFromHex=(value:string)=>Uint8Array.from(value.match(/.{2}/g)!.map(part=>Number.parseInt(part,16)));
const hmacKey=(tokenHash:string,usages:KeyUsage[])=>crypto.subtle.importKey("raw",bytesFromHex(tokenHash),{name:"HMAC",hash:"SHA-256"},false,usages);
const hmac=async(tokenHash:string,message:string)=>{
  const signature=await crypto.subtle.sign("HMAC",await hmacKey(tokenHash,["sign"]),encoder.encode(message));
  return [...new Uint8Array(signature)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
};
const sha256Hex=async(value:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",value))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const verifyHmac=async(tokenHash:string,message:string,signature:string)=>crypto.subtle.verify("HMAC",await hmacKey(tokenHash,["verify"]),bytesFromHex(signature),encoder.encode(message));
const randomHex=(bytes:number)=>[...crypto.getRandomValues(new Uint8Array(bytes))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const deviceByHardware=(hardwareId:string)=>env.DB.prepare("SELECT id,profile_id profileId,name,hardware_id hardwareId,token_hash tokenHash,active,ble_session_id bleSessionId,ble_session_counter bleSessionCounter,ble_session_expires_at bleSessionExpiresAt FROM rfid_devices WHERE hardware_id=?").bind(hardwareId).first<Device>();
const deviceForSession=async(profileId:string|null,hardwareId:string,sessionId:string)=>{
  const device=await deviceByHardware(hardwareId);
  return device&&(!profileId||device.profileId===profileId)&&Boolean(device.active)&&device.bleSessionId===sessionId&&(device.bleSessionExpiresAt||"")>new Date().toISOString()?device:null;
};
const scanIdentity=async(profileId:string,uid:string)=>env.DB.prepare("SELECT m.id memberId,m.name memberName,m.role memberRole,m.initials memberInitials FROM rfid_cards c JOIN members m ON m.id=c.member_id AND m.active=1 WHERE c.profile_id=? AND c.uid=? LIMIT 1").bind(profileId,uid).first<{memberId:string;memberName:string;memberRole:string;memberInitials:string}>();

export async function POST(request:Request){
  try{
    const body=await request.json() as Record<string,unknown>,action=String(body.action||"");
    const profile=await requireProfile(request);

    if(action==="pair"){
      if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401,headers});
      const admin=await requireRole(request,["Vorstand","Systemadmin"]);
      if(!admin)return Response.json({error:"Nur Vorstand oder Systemadministration dürfen einen Leser verbinden"},{status:403,headers});
      const hardwareId=cleanHardwareId(body.hardwareId),tokenHash=cleanHex(body.tokenHash,64),proof=cleanHex(body.proof,64);
      const name=String(body.name||"").trim().replace(/\s+/g," ").slice(0,60);
      if(!hardwareId||!tokenHash||name.length<3)return Response.json({error:"Ungültige Bluetooth-Kopplung"},{status:400,headers});
      const existing=await deviceByHardware(hardwareId);
      if(existing){
        const verified=Boolean(proof)&&await verifyHmac(existing.tokenHash,`pair|${hardwareId}|${tokenHash}`,proof!);
        if(!verified&&Boolean(existing.active))return Response.json({error:"Der vorhandene Leser hat die sichere Übernahme nicht bestätigt. Nach einem vollständigen Flash-Reset den alten Leser zuerst bewusst deaktivieren."},{status:403,headers});
      }
      const deviceId=existing?.id||`RFID-${crypto.randomUUID()}`,now=new Date().toISOString();
      const statements=existing
        ?[env.DB.prepare("UPDATE rfid_devices SET profile_id=?,name=?,token_hash=?,active=1,firmware_version=NULL,last_seen_at=NULL,ble_session_id=NULL,ble_session_counter=0,ble_session_expires_at=NULL,created_by=? WHERE id=?").bind(profile.id,name,tokenHash,admin.id,deviceId)]
        :[env.DB.prepare("INSERT INTO rfid_devices (id,profile_id,name,hardware_id,token_hash,active,firmware_version,last_seen_at,ble_session_id,ble_session_counter,ble_session_expires_at,created_by,created_at) VALUES (?,?,?,?,?,1,NULL,NULL,NULL,0,NULL,?,?)").bind(deviceId,profile.id,name,hardwareId,tokenHash,admin.id,now)];
      statements.push(env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),existing?"RFID_BLE_REPAIRED":"RFID_BLE_PAIRED","rfid_device",deviceId,admin.id,JSON.stringify({profileId:profile.id,hardwareId,name,previousProfileId:existing?.profileId||null}),now));
      await env.DB.batch(statements);
      return Response.json({ok:true,device:{id:deviceId,name,hardwareId},approval:await hmac(tokenHash,`activate|${hardwareId}|${tokenHash}`)},{status:existing?200:201,headers});
    }

    const hardwareId=cleanHardwareId(body.hardwareId);
    if(!hardwareId)return Response.json({error:"Ungültiger Bluetooth-Leser"},{status:400,headers});
    if(action==="session"){
      const device=await deviceByHardware(hardwareId);
      if(!device||!device.active||(profile&&device.profileId!==profile.id))return Response.json({error:"Bluetooth-Leser ist für dieses Profil nicht freigegeben"},{status:403,headers});
      const helloNonce=cleanHex(body.nonce,48),proof=cleanHex(body.proof,64),firmwareVersion=String(body.firmwareVersion||"").slice(0,32);
      if(!helloNonce||!proof||!await verifyHmac(device.tokenHash,`hello|${hardwareId}|${helloNonce}|${firmwareVersion}`,proof))return Response.json({error:"Bluetooth-Leser hat den Sitzungsaufbau nicht bestätigt"},{status:403,headers});
      const sessionId=crypto.randomUUID(),sessionNonce=randomHex(24),expiresAt=new Date(Date.now()+10*60_000).toISOString();
      await env.DB.prepare("UPDATE rfid_devices SET ble_session_id=?,ble_session_counter=0,ble_session_expires_at=?,last_seen_at=?,firmware_version=? WHERE id=?").bind(sessionId,expiresAt,new Date().toISOString(),firmwareVersion||null,device.id).run();
      const authorization=await hmac(device.tokenHash,`session|${hardwareId}|${sessionId}|${sessionNonce}|${expiresAt}`);
      return Response.json({sessionId,nonce:sessionNonce,expiresAt,authorization},{headers});
    }

    const sessionId=String(body.sessionId||"").trim();
    if(!sessionId||sessionId.length>100)return Response.json({error:"Bluetooth-Sitzung fehlt"},{status:400,headers});
    const device=await deviceForSession(profile?.id||null,hardwareId,sessionId);
    if(!device)return Response.json({error:"Bluetooth-Sitzung ist abgelaufen"},{status:409,headers});

    if(action==="heartbeat"){
      const counter=Number(body.counter),firmwareVersion=String(body.firmwareVersion||"").slice(0,32),signature=cleanHex(body.signature,64);
      if(!Number.isInteger(counter)||counter<0||!signature||!await verifyHmac(device.tokenHash,`heartbeat|${hardwareId}|${sessionId}|${counter}|${firmwareVersion}`,signature))return Response.json({error:"Bluetooth-Status konnte nicht bestätigt werden"},{status:403,headers});
      await env.DB.prepare("UPDATE rfid_devices SET last_seen_at=?,firmware_version=? WHERE id=?").bind(new Date().toISOString(),firmwareVersion||null,device.id).run();
      return Response.json({ok:true},{headers});
    }

    if(action==="scan"){
      const uid=cleanUid(body.uid),blocks=Number(body.blocks),counter=Number(body.counter),firmwareVersion=String(body.firmwareVersion||"").slice(0,32),signature=cleanHex(body.signature,64);
      if(!uid||!Number.isInteger(blocks)||blocks<0||blocks>512||!Number.isInteger(counter)||counter<1||counter>2147483647||!signature)return Response.json({error:"Ungültiger Bluetooth-Scan"},{status:400,headers});
      if(!await verifyHmac(device.tokenHash,`scan|${hardwareId}|${sessionId}|${counter}|${uid}|${blocks}|${firmwareVersion}`,signature))return Response.json({error:"Bluetooth-Scan wurde nicht vom Leser bestätigt"},{status:403,headers});
      const nowDate=new Date(),now=nowDate.toISOString();
      if(counter<Number(device.bleSessionCounter||0))return Response.json({error:"Veralteter Bluetooth-Scan"},{status:409,headers});
      const duplicateCutoff=new Date(nowDate.getTime()-(counter===Number(device.bleSessionCounter||0)?30_000:1500)).toISOString();
      let scan=await env.DB.prepare("SELECT id FROM rfid_scans WHERE device_id=? AND uid=? AND created_at>=? ORDER BY created_at DESC LIMIT 1").bind(device.id,uid,duplicateCutoff).first<{id:string}>();
      if(counter===Number(device.bleSessionCounter||0)&&!scan)return Response.json({error:"Bluetooth-Scan ist nicht mehr wiederholbar"},{status:409,headers});
      if(counter>Number(device.bleSessionCounter||0)){
        const claimed=await env.DB.prepare("UPDATE rfid_devices SET ble_session_counter=?,last_seen_at=?,firmware_version=? WHERE id=? AND ble_session_id=? AND ble_session_counter<?").bind(counter,now,firmwareVersion||null,device.id,sessionId,counter).run();
        if(!claimed.meta.changes)return Response.json({error:"Bluetooth-Scan wurde bereits verarbeitet"},{status:409,headers});
        if(!scan){
          scan={id:crypto.randomUUID()};
          await env.DB.prepare("INSERT INTO rfid_scans (id,profile_id,device_id,uid,card_type,blocks,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?,?,?,NULL)").bind(scan.id,device.profileId,device.id,uid,String(body.cardType||"").slice(0,60)||null,blocks||null,now,new Date(nowDate.getTime()+30_000).toISOString()).run();
        }
      }
      const member=await scanIdentity(device.profileId,uid),state=member?"recognized":"unknown",memberName=member?.memberName||"";
      const acknowledgement=await hmac(device.tokenHash,`ack|${hardwareId}|${sessionId}|${counter}|${uid}|${state}|${memberName}`);
      return Response.json({accepted:true,id:scan?.id,duplicate:counter===Number(device.bleSessionCounter||0),state,memberName:memberName||null,acknowledgement},{status:202,headers});
    }

    if(action==="client_command_failure"){
      if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401,headers});
      const admin=await requireRole(request,["Vorstand","Systemadmin"]);
      if(!admin)return Response.json({error:"Keine Berechtigung für RFID-Aufträge"},{status:403,headers});
      const commandId=String(body.commandId||""),error=String(body.error||"Bluetooth-Übertragung fehlgeschlagen").replace(/[|\r\n]/g," ").slice(0,240);
      if(!commandId||commandId.length>100)return Response.json({error:"RFID-Auftrag fehlt"},{status:400,headers});
      const command=await env.DB.prepare("SELECT id,block,status FROM rfid_write_commands WHERE id=? AND device_id=?").bind(commandId,device.id).first<{id:string;block:number;status:string}>();
      if(!command)return Response.json({error:"RFID-Auftrag nicht gefunden"},{status:404,headers});
      if(!["succeeded","failed","expired"].includes(command.status)){
        const now=new Date().toISOString(),auditAction=command.block===-2?"RFID_FIRMWARE_UPDATE_FAILED":command.block===-1?"RFID_RESTART_FAILED":"RFID_WRITE_FAILED";
        const failed=await env.DB.prepare("UPDATE rfid_write_commands SET status='failed',error=?,completed_at=? WHERE id=? AND device_id=? AND status IN ('pending','processing')").bind(error,now,command.id,device.id).run();
        if(failed.meta.changes)await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),auditAction,"rfid_device",device.id,admin.id,JSON.stringify({profileId:device.profileId,commandId,error,source:"tablet_transport"}),now).run();
      }
      return Response.json({ok:true,status:"failed"},{headers});
    }

    if(action==="authorize_command"){
      if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401,headers});
      const admin=await requireRole(request,["Vorstand","Systemadmin"]);
      if(!admin)return Response.json({error:"RFID-Aufträge müssen im geschützten Adminbereich bestätigt werden"},{status:403,headers});
      const commandId=String(body.commandId||""),size=Number(body.size||0),sha256=String(body.sha256||"").toLowerCase();
      if(!commandId||commandId.length>100||!Number.isInteger(size)||size<0||size>4_000_000||(sha256&&!/^[0-9a-f]{64}$/.test(sha256)))return Response.json({error:"Ungültige Befehlsfreigabe"},{status:400,headers});
      const command=await env.DB.prepare("SELECT id,uid,block,payload_hex payloadHex,status,expires_at expiresAt FROM rfid_write_commands WHERE id=? AND device_id=? AND status='processing' AND expires_at>?").bind(commandId,device.id,new Date().toISOString()).first<Command>();
      if(!command)return Response.json({error:"RFID-Auftrag ist nicht mehr aktiv"},{status:404,headers});
      const commandAction=command.block===-2?"firmware":command.block===-1?"restart":"write";
      if(commandAction==="firmware"&&(!size||!sha256))return Response.json({error:"Firmware-Prüfsumme fehlt"},{status:400,headers});
      if(commandAction==="firmware"){
        const runtime=(env as unknown as {VEREINSKASSE_RUNTIME?:string}).VEREINSKASSE_RUNTIME;
        const origin=runtime==="raspberry"?"http://127.0.0.1:3000":new URL(request.url).origin;
        const response=await fetch(new URL("/firmware/clubiq-rfid-esp32.bin",origin),{redirect:"error"});
        if(!response.ok)return Response.json({error:"Freigegebene Firmwaredatei ist nicht verfügbar"},{status:503,headers});
        const official=await response.arrayBuffer();
        if(official.byteLength!==size||await sha256Hex(official)!==sha256)return Response.json({error:"Firmwaredatei stimmt nicht mit der freigegebenen ClubIQ-Version überein"},{status:409,headers});
      }
      const authorization=await hmac(device.tokenHash,`command|${hardwareId}|${sessionId}|${command.id}|${commandAction}|${command.uid}|${command.block}|${command.payloadHex}|${command.expiresAt}|${size}|${sha256}`);
      return Response.json({authorization},{headers});
    }

    if(action==="command_result"){
      const commandId=String(body.commandId||""),success=body.success===true,uid=String(body.uid||"").trim().toUpperCase(),value=String(body.value||"").trim(),error=String(body.error||"").replace(/[|\r\n]/g," ").slice(0,240),signature=cleanHex(body.signature,64);
      if(!commandId||commandId.length>100||!uid||!signature)return Response.json({error:"Ungültiges RFID-Ergebnis"},{status:400,headers});
      const command=await env.DB.prepare("SELECT id,uid,block,payload_hex payloadHex,status,expires_at expiresAt FROM rfid_write_commands WHERE id=? AND device_id=?").bind(commandId,device.id).first<Command>();
      if(!command)return Response.json({error:"RFID-Auftrag nicht gefunden"},{status:404,headers});
      if(!await verifyHmac(device.tokenHash,`result|${hardwareId}|${sessionId}|${commandId}|${success?1:0}|${uid}|${value}|${error}`,signature))return Response.json({error:"RFID-Ergebnis wurde nicht vom Leser bestätigt"},{status:403,headers});
      const status=success?"succeeded":"failed";
      if(!["succeeded","failed"].includes(command.status)){
        if(uid!==command.uid)return Response.json({error:"Falsche Karte aufgelegt"},{status:409,headers});
        if(success&&value!==command.payloadHex)return Response.json({error:command.block===-2?"Installierte Firmwareversion stimmt nicht überein":"Rücklesedaten stimmen nicht überein"},{status:400,headers});
        const now=new Date().toISOString(),auditAction=command.block===-2?(success?"RFID_FIRMWARE_UPDATE_SUCCEEDED":"RFID_FIRMWARE_UPDATE_FAILED"):(command.block===-1?"RFID_RESTART_SUCCEEDED":success?"RFID_WRITE_SUCCEEDED":"RFID_WRITE_FAILED");
        await env.DB.batch([
          env.DB.prepare("UPDATE rfid_write_commands SET status=?,error=?,completed_at=? WHERE id=? AND device_id=?").bind(status,success?null:error||"Auftrag fehlgeschlagen",now,command.id,device.id),
          env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),auditAction,"rfid_device",device.id,device.id,JSON.stringify({profileId:device.profileId,commandId,uid,error:success?null:error}),now)
        ]);
      }
      return Response.json({ok:true,status,acknowledgement:await hmac(device.tokenHash,`command_ack|${hardwareId}|${sessionId}|${commandId}|${status}`)},{headers});
    }
    return Response.json({error:"Unbekannter Bluetooth-Auftrag"},{status:400,headers});
  }catch{
    return Response.json({error:"Bluetooth-Auftrag konnte nicht verarbeitet werden"},{status:500,headers});
  }
}

export async function GET(request:Request){
  try{
    const profile=await requireProfile(request);
    if(!profile)return new Response(null,{status:204,headers});
    // Schreib-, Neustart- und Firmwareaufträge werden nur abgeholt, solange
    // der geschützte Adminbereich tatsächlich geöffnet ist. Im normalen
    // Kassenbetrieb bleibt der Leser auf das Scannen beschränkt.
    const admin=await requireRole(request,["Vorstand","Systemadmin"]);
    if(!admin)return new Response(null,{status:204,headers});
    const url=new URL(request.url),hardwareId=cleanHardwareId(url.searchParams.get("hardwareId")),sessionId=(url.searchParams.get("sessionId")||"").trim();
    if(!hardwareId||!sessionId)return Response.json({error:"Bluetooth-Leser und Sitzung sind erforderlich"},{status:400,headers});
    const device=await deviceForSession(profile.id,hardwareId,sessionId);
    if(!device)return Response.json({error:"Bluetooth-Sitzung ist abgelaufen"},{status:409,headers});
    const now=new Date().toISOString();
    await env.DB.prepare("UPDATE rfid_write_commands SET status='expired',error='Zeitfenster abgelaufen',completed_at=? WHERE device_id=? AND status IN ('pending','processing') AND expires_at<=?").bind(now,device.id,now).run();
    const command=await env.DB.prepare("SELECT id,uid,block,payload_hex payloadHex,status,expires_at expiresAt FROM rfid_write_commands WHERE device_id=? AND status IN ('pending','processing') AND expires_at>? ORDER BY created_at LIMIT 1").bind(device.id,now).first<Command>();
    if(!command)return new Response(null,{status:204,headers});
    if(command.status==="pending"){
      const claimed=await env.DB.prepare("UPDATE rfid_write_commands SET status='processing',claimed_at=? WHERE id=? AND device_id=? AND status='pending'").bind(now,command.id,device.id).run();
      if(!claimed.meta.changes)return new Response(null,{status:204,headers});
    }
    const action=command.block===-2?"firmware":command.block===-1?"restart":"write";
    return Response.json({command:{...command,action,firmwareUrl:action==="firmware"?"/firmware/clubiq-rfid-esp32.bin":undefined}},{headers});
  }catch{
    return Response.json({error:"Bluetooth-Auftrag konnte nicht geladen werden"},{status:500,headers});
  }
}
