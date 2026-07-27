import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";

export async function GET(request:Request){
  const profile=await requireProfile(request);
  if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});
  try{
    const [database,reader,shift,restore,backups]=await Promise.all([
      env.DB.prepare("SELECT COUNT(*) count FROM sales WHERE profile_id=?").bind(profile.id).first<{count:number}>(),
      env.DB.prepare("SELECT MAX(last_seen_at) lastSeenAt FROM rfid_devices WHERE profile_id=? AND active=1").bind(profile.id).first<{lastSeenAt:string|null}>(),
      env.DB.prepare("SELECT id,opened_by_name openedByName,opened_at openedAt FROM shifts WHERE profile_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").bind(profile.id).first(),
      env.DB.prepare("SELECT status FROM restore_requests WHERE profile_id=? AND status IN ('approved','restoring') ORDER BY created_at DESC LIMIT 1").bind(profile.id).first<{status:string}>(),
      env.BACKUPS.list({prefix:"snapshots/",limit:1})
    ]);
    const latestBackup=backups.objects.sort((a,b)=>b.uploaded.getTime()-a.uploaded.getTime())[0];
    return Response.json({online:true,serverTime:new Date().toISOString(),database:{ok:true,sales:Number(database?.count||0)},latestBackupAt:latestBackup?.uploaded.toISOString()||null,rfidLastSeenAt:reader?.lastSeenAt||null,shift:shift||null,restoreStatus:restore?.status||null},{headers:{"cache-control":"no-store"}});
  }catch{return Response.json({online:false,error:"Systemstatus konnte nicht vollständig geprüft werden"},{status:503,headers:{"cache-control":"no-store"}})}
}
