import { env } from "cloudflare:workers";

type Device={hardwareId:string|null};
const headers={"cache-control":"no-store"};
const cleanHardwareId=(value:string|null)=>{
  const hardwareId=String(value||"").trim().toUpperCase();
  return /^ESP32-[0-9A-F]{6}$/.test(hardwareId)?hardwareId:null;
};
const firmwareVersion=(value:string|null)=>value&&/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)?value:null;
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");

export async function GET(request:Request){
  try{
    const token=request.headers.get("x-rfid-token")?.trim();
    const hardwareId=cleanHardwareId(request.headers.get("x-rfid-hardware-id"));
    if(!token||token.length<32||token.length>200||!hardwareId){
      return Response.json({error:"RFID-Leser nicht freigegeben"},{status:401,headers});
    }
    const device=await env.DB.prepare("SELECT hardware_id hardwareId FROM rfid_devices WHERE token_hash=? AND hardware_id=? AND active=1").bind(await hash(token),hardwareId).first<Device>();
    if(!device)return Response.json({error:"RFID-Leser nicht freigegeben"},{status:401,headers});

    const now=new Date().toISOString();
    const reportedFirmware=firmwareVersion(request.headers.get("x-rfid-firmware-version"));
    // Diese Vorabprüfung ist absichtlich nur lesend. Erst der normale
    // Befehlsabruf nach dem Neustart darf last_seen_at aktualisieren. Sonst
    // könnte die App den Provisioning-Test mit dem Dauerbetrieb verwechseln.
    return Response.json({ok:true,hardwareId,firmwareVersion:reportedFirmware,serverTime:now},{headers});
  }catch{
    return Response.json({error:"RFID-Verbindung konnte nicht geprueft werden"},{status:500,headers});
  }
}
