import { env } from "cloudflare:workers";
import { requireRole, type SessionUser } from "../session";
import { requireProfile, type ActiveProfile } from "../profile-session";

const SCHEMA_VERSION=22;
const BACKUP_FORMAT_VERSION=3;
const tables=["profiles","profile_recovery_keys","profile_sessions","members","member_lifecycle","rfid_devices","rfid_cards","rfid_scans","rfid_write_commands","rfid_display_states","guest_accounts","products","discount_rules","events","sales","sale_items","sale_allocations","payments","account_transactions","rounds","round_claims","random_reward_campaigns","random_reward_slots","shifts","reversals","monthly_closures","audit_logs"] as const;
type Snapshot=Record<string,unknown>&{formatVersion:number;schemaVersion:number;createdAt:string;rowCounts:Record<string,number>};
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,"0")).join("");
const digest=async(payload:string)=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload)));
const validKey=(key:string)=>/^snapshots\/[0-9TZ.\-]+-[0-9a-f-]+\.json$/.test(key);

async function createSnapshot(admin:SessionUser,profile:ActiveProfile,label="manual"){
  const now=new Date().toISOString(),rowCounts:Record<string,number>={},snapshot:Record<string,unknown>={formatVersion:BACKUP_FORMAT_VERSION,schemaVersion:SCHEMA_VERSION,createdAt:now,createdBy:{id:admin.id,name:admin.name,role:admin.role},requestedFromProfile:profile.id,label};
  for(const table of tables){const rows=(await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;snapshot[table]=rows;rowCounts[table]=rows.length}
  snapshot.rowCounts=rowCounts;
  const payload=JSON.stringify(snapshot),checksum=await digest(payload),key=`snapshots/${now.replaceAll(":","-")}-${crypto.randomUUID()}.json`;
  await env.BACKUPS.put(key,payload,{httpMetadata:{contentType:"application/json"},customMetadata:{sha256:checksum,schemaVersion:String(SCHEMA_VERSION),formatVersion:String(BACKUP_FORMAT_VERSION)}});
  const verified=await env.BACKUPS.head(key);
  if(!verified||verified.size!==new TextEncoder().encode(payload).byteLength||verified.customMetadata?.sha256!==checksum)throw new Error("Sicherung konnte nicht vollständig verifiziert werden");
  await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"FULL_BACKUP_CREATED","backup",key,admin.id,JSON.stringify({checksum,size:verified.size,schemaVersion:SCHEMA_VERSION,rowCounts,label}),now).run();
  return {key,size:verified.size,checksum,createdAt:now,schemaVersion:SCHEMA_VERSION,rowCounts};
}

async function validatedSnapshot(key:string){
  if(!validKey(key))throw new Error("Ungültige Sicherung");
  const object=await env.BACKUPS.get(key);
  if(!object)throw new Error("Sicherung nicht gefunden");
  const payload=await new Response(object.body).text(),checksum=await digest(payload),expected=object.customMetadata?.sha256||"";
  if(!expected||checksum!==expected)throw new Error("Prüfsumme stimmt nicht – diese Sicherung darf nicht verwendet werden");
  const snapshot=JSON.parse(payload) as Snapshot;
  const compatible=snapshot.schemaVersion===SCHEMA_VERSION&&snapshot.formatVersion===BACKUP_FORMAT_VERSION&&tables.every(table=>Array.isArray(snapshot[table]));
  return {snapshot,checksum,size:new TextEncoder().encode(payload).byteLength,compatible};
}

async function restoreSnapshot(snapshot:Snapshot){
  for(const table of [...tables].reverse())await env.DB.prepare(`DELETE FROM ${table}`).run();
  for(const table of tables){
    const rows=snapshot[table] as Record<string,unknown>[];
    for(let offset=0;offset<rows.length;offset+=40){
      const statements=rows.slice(offset,offset+40).map(row=>{
        const columns=Object.keys(row);
        if(!columns.length||columns.some(column=>!/^[a-z][a-z0-9_]*$/.test(column)))throw new Error(`Ungültige Spalten in ${table}`);
        const placeholders=columns.map(()=>"?").join(",");
        return env.DB.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`).bind(...columns.map(column=>row[column] as string|number|null));
      });
      if(statements.length)await env.DB.batch(statements);
    }
  }
}

export async function GET(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);if(!admin||!profile)return Response.json({error:"Keine Berechtigung oder Profilanmeldung abgelaufen"},{status:403});
  const url=new URL(request.url),download=url.searchParams.get("download");
  if(download){
    if(!validKey(download))return Response.json({error:"Ungültige Sicherung"},{status:400});
    const object=await env.BACKUPS.get(download);if(!object)return Response.json({error:"Sicherung nicht gefunden"},{status:404});
    return new Response(object.body,{headers:{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="vereinskasse-${download.split("/").at(-1)}"`,"cache-control":"no-store","x-backup-sha256":object.customMetadata?.sha256||""}});
  }
  const [sales,members,transactions,profiles,listed,requests]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) count FROM sales").first<{count:number}>(),
    env.DB.prepare("SELECT COUNT(*) count FROM members").first<{count:number}>(),
    env.DB.prepare("SELECT COUNT(*) count FROM account_transactions").first<{count:number}>(),
    env.DB.prepare("SELECT COUNT(*) count FROM profiles WHERE active=1").first<{count:number}>(),
    env.BACKUPS.list({prefix:"snapshots/",limit:10,include:["customMetadata"]}),
    env.DB.prepare("SELECT id,backup_key backupKey,checksum,status,requested_by requestedBy,requested_by_name requestedByName,approved_by approvedBy,approved_by_name approvedByName,preview_json previewJson,created_at createdAt,expires_at expiresAt,error FROM restore_requests WHERE profile_id=? ORDER BY created_at DESC LIMIT 5").bind(profile.id).all<Record<string,unknown>>()
  ]);
  const snapshots=listed.objects.sort((a,b)=>b.uploaded.getTime()-a.uploaded.getTime()).map(object=>({key:object.key,size:object.size,uploaded:object.uploaded,checksum:object.customMetadata?.sha256||null,schemaVersion:Number(object.customMetadata?.schemaVersion||0),formatVersion:Number(object.customMetadata?.formatVersion||0),compatible:Number(object.customMetadata?.schemaVersion||0)===SCHEMA_VERSION&&Number(object.customMetadata?.formatVersion||0)===BACKUP_FORMAT_VERSION,downloadUrl:`/api/backup?download=${encodeURIComponent(object.key)}`}));
  const runtime=(env as unknown as {VEREINSKASSE_RUNTIME?:string}).VEREINSKASSE_RUNTIME==="raspberry"?"raspberry":"cloud";
  return Response.json({healthy:true,runtime,schemaVersion:SCHEMA_VERSION,backupFormatVersion:BACKUP_FORMAT_VERSION,database:{sales:sales?.count||0,members:members?.count||0,transactions:transactions?.count||0,profiles:profiles?.count||0},snapshots,restoreRequests:requests.results.map(row=>({...row,preview:JSON.parse(String(row.previewJson||"{}"))}))},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);if(!admin||!profile)return Response.json({error:"Keine Berechtigung oder Profilanmeldung abgelaufen"},{status:403});
  try{return Response.json({ok:true,...await createSnapshot(admin,profile)})}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Sicherung fehlgeschlagen"},{status:500})}
}

export async function PUT(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);if(!admin||!profile)return Response.json({error:"Nur Vorstand / Admin darf Wiederherstellungen vorbereiten"},{status:403});
  try{
    const body=await request.json() as {action?:string;key?:string;requestId?:string};
    if(body.action==="preview"||body.action==="request"){
      const checked=await validatedSnapshot(body.key||"");
      const preview={compatible:checked.compatible,size:checked.size,checksum:checked.checksum,schemaVersion:checked.snapshot.schemaVersion,formatVersion:checked.snapshot.formatVersion,createdAt:checked.snapshot.createdAt,rowCounts:checked.snapshot.rowCounts};
      if(body.action==="preview")return Response.json(preview);
      if(!checked.compatible)return Response.json({error:"Diese Sicherung stammt aus einer älteren Programmversion. Bitte zuerst eine neue vollständige Sicherung erstellen."},{status:409});
      const id=crypto.randomUUID(),now=new Date(),expires=new Date(now.getTime()+30*60*1000);
      await env.DB.batch([
        env.DB.prepare("UPDATE restore_requests SET status='expired',error='Bestätigungszeit abgelaufen' WHERE profile_id=? AND status IN ('pending','approved') AND expires_at<=?").bind(profile.id,now.toISOString()),
        env.DB.prepare("INSERT INTO restore_requests (id,profile_id,backup_key,checksum,status,requested_by,requested_by_name,preview_json,created_at,expires_at) VALUES (?,?,?,?,'pending',?,?,?,?,?)").bind(id,profile.id,body.key,checked.checksum,admin.id,admin.name,JSON.stringify(preview),now.toISOString(),expires.toISOString()),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RESTORE_REQUESTED","restore_request",id,admin.id,JSON.stringify({profileId:profile.id,backupKey:body.key,checksum:checked.checksum}),now.toISOString())
      ]);
      return Response.json({ok:true,id,expiresAt:expires.toISOString(),preview});
    }
    if(body.action==="approve"){
      const requestRow=await env.DB.prepare("SELECT * FROM restore_requests WHERE id=? AND profile_id=?").bind(body.requestId,profile.id).first<Record<string,unknown>>();
      if(!requestRow||requestRow.status!=="pending")return Response.json({error:"Wiederherstellungsanfrage ist nicht mehr offen"},{status:409});
      if(String(requestRow.requested_by)===admin.id)return Response.json({error:"Für das Vier-Augen-Verfahren muss eine zweite Vorstands-Person bestätigen"},{status:409});
      if(String(requestRow.expires_at)<=new Date().toISOString())return Response.json({error:"Die Anfrage ist abgelaufen. Bitte neu beginnen."},{status:410});
      const now=new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE restore_requests SET status='approved',approved_by=?,approved_by_name=?,approved_at=? WHERE id=? AND status='pending'").bind(admin.id,admin.name,now,body.requestId),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RESTORE_APPROVED","restore_request",body.requestId,admin.id,JSON.stringify({profileId:profile.id}),now)
      ]);
      return Response.json({ok:true,approvedBy:admin.name});
    }
    if(body.action==="execute"){
      const requestRow=await env.DB.prepare("SELECT * FROM restore_requests WHERE id=? AND profile_id=?").bind(body.requestId,profile.id).first<Record<string,unknown>>();
      if(!requestRow||requestRow.status!=="approved")return Response.json({error:"Die Wiederherstellung wurde noch nicht von einer zweiten Person bestätigt"},{status:409});
      if(String(requestRow.approved_by)!==admin.id)return Response.json({error:"Die bestätigende Vorstands-Person muss die Wiederherstellung ausführen"},{status:403});
      if(String(requestRow.expires_at)<=new Date().toISOString())return Response.json({error:"Die Freigabe ist abgelaufen. Bitte neu beginnen."},{status:410});
      const checked=await validatedSnapshot(String(requestRow.backup_key));
      if(!checked.compatible||checked.checksum!==requestRow.checksum)return Response.json({error:"Sicherung oder Prüfsumme hat sich verändert"},{status:409});
      await env.DB.prepare("UPDATE restore_requests SET status='restoring' WHERE id=? AND status='approved'").bind(body.requestId).run();
      await createSnapshot(admin,profile,"automatic-before-restore");
      try{
        await restoreSnapshot(checked.snapshot);
        const now=new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare("UPDATE restore_requests SET status='succeeded',completed_at=?,error=NULL WHERE id=?").bind(now,body.requestId),
          env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RESTORE_COMPLETED","restore_request",body.requestId,admin.id,JSON.stringify({profileId:profile.id,backupKey:requestRow.backup_key,checksum:checked.checksum,approvedBy:admin.name}),now)
        ]);
        return Response.json({ok:true,reload:true});
      }catch(error){
        await env.DB.prepare("UPDATE restore_requests SET status='failed',error=? WHERE id=?").bind(error instanceof Error?error.message:"Wiederherstellung fehlgeschlagen",body.requestId).run();
        throw error;
      }
    }
    return Response.json({error:"Unbekannte Aktion"},{status:400});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Wiederherstellung fehlgeschlagen"},{status:500})}
}
