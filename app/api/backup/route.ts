import { env } from "cloudflare:workers";
import { requireRole } from "../session";
import { requireProfile } from "../profile-session";

const SCHEMA_VERSION=18;
const BACKUP_FORMAT_VERSION=2;
const tables=["profiles","profile_recovery_keys","members","rfid_devices","rfid_cards","rfid_scans","rfid_write_commands","guest_accounts","products","discount_rules","events","sales","sale_items","sale_allocations","payments","account_transactions","rounds","round_claims","random_reward_campaigns","random_reward_slots","shifts","reversals","audit_logs"] as const;
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,"0")).join("");

export async function GET(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);if(!admin||!profile)return Response.json({error:"Keine Berechtigung oder Profilanmeldung abgelaufen"},{status:403});
  const url=new URL(request.url),download=url.searchParams.get("download");
  if(download){
    if(!/^snapshots\/[0-9TZ.\-]+-[0-9a-f-]+\.json$/.test(download))return Response.json({error:"Ungültige Sicherung"},{status:400});
    const object=await env.BACKUPS.get(download);if(!object)return Response.json({error:"Sicherung nicht gefunden"},{status:404});
    return new Response(object.body,{headers:{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="vereinskasse-${download.split("/").at(-1)}"`,"cache-control":"no-store","x-backup-sha256":object.customMetadata?.sha256||""}});
  }
  const [sales,members,transactions,profiles,listed]=await Promise.all([env.DB.prepare("SELECT COUNT(*) count FROM sales").first<{count:number}>(),env.DB.prepare("SELECT COUNT(*) count FROM members").first<{count:number}>(),env.DB.prepare("SELECT COUNT(*) count FROM account_transactions").first<{count:number}>(),env.DB.prepare("SELECT COUNT(*) count FROM profiles WHERE active=1").first<{count:number}>(),env.BACKUPS.list({prefix:"snapshots/",limit:10,include:["customMetadata"]})]);
  const snapshots=listed.objects.sort((a,b)=>b.uploaded.getTime()-a.uploaded.getTime()).map(object=>({key:object.key,size:object.size,uploaded:object.uploaded,checksum:object.customMetadata?.sha256||null,schemaVersion:Number(object.customMetadata?.schemaVersion||0),downloadUrl:`/api/backup?download=${encodeURIComponent(object.key)}`}));
  return Response.json({healthy:true,schemaVersion:SCHEMA_VERSION,backupFormatVersion:BACKUP_FORMAT_VERSION,database:{sales:sales?.count||0,members:members?.count||0,transactions:transactions?.count||0,profiles:profiles?.count||0},snapshots},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);if(!admin||!profile)return Response.json({error:"Keine Berechtigung oder Profilanmeldung abgelaufen"},{status:403});
  const now=new Date().toISOString(),rowCounts:Record<string,number>={},snapshot:Record<string,unknown>={formatVersion:BACKUP_FORMAT_VERSION,schemaVersion:SCHEMA_VERSION,createdAt:now,createdBy:{id:admin.id,name:admin.name,role:admin.role},requestedFromProfile:profile.id};
  for(const table of tables){const rows=(await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;snapshot[table]=rows;rowCounts[table]=rows.length}
  snapshot.rowCounts=rowCounts;
  const payload=JSON.stringify(snapshot),checksum=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload))),key=`snapshots/${now.replaceAll(":","-")}-${crypto.randomUUID()}.json`;
  await env.BACKUPS.put(key,payload,{httpMetadata:{contentType:"application/json"},customMetadata:{sha256:checksum,schemaVersion:String(SCHEMA_VERSION),formatVersion:String(BACKUP_FORMAT_VERSION)}});
  const verified=await env.BACKUPS.head(key);if(!verified||verified.size!==new TextEncoder().encode(payload).byteLength||verified.customMetadata?.sha256!==checksum)return Response.json({error:"Sicherung konnte nicht vollständig verifiziert werden"},{status:500});
  await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"FULL_BACKUP_CREATED","backup",key,admin.id,JSON.stringify({checksum,size:verified.size,schemaVersion:SCHEMA_VERSION,rowCounts}),now).run();
  return Response.json({ok:true,key,size:verified.size,checksum,createdAt:now,schemaVersion:SCHEMA_VERSION,rowCounts});
}
