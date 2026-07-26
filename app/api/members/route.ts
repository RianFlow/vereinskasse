import { env } from "cloudflare:workers";
import { requireRole } from "../session";
import { requireProfile } from "../profile-session";

const safe=()=>env.DB.prepare("SELECT id,name,role,initials,active,CASE WHEN code LIKE 'NOLOGIN-%' THEN 0 ELSE 1 END hasAccess FROM members WHERE id NOT IN ('M-1042','M-1088','M-1137','M-1201','M-1214','M-1228','M-1240') ORDER BY name").all();
export async function GET(request:Request){const profile=await requireProfile(request);if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});const rows=await safe();return Response.json({members:rows.results})}
export async function POST(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);
    if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:403});
    const b=await request.json() as {action:string;id?:string;name?:string;firstName?:string;lastName?:string;role?:string;code?:string};
    const now=new Date().toISOString();

    if(b.action==="bootstrap"){
      const existing=await env.DB.prepare("SELECT id FROM members WHERE active=1 AND role='Vorstand' AND id<>'M-1088' LIMIT 1").first();
      if(existing)return Response.json({error:"Ein Hauptadministrator ist bereits eingerichtet"},{status:409});
      const name=b.name?.trim(),code=b.code?.trim();
      if(!name||!code||code.length<10)return Response.json({error:"Name und ein Admin-Code mit mindestens 10 Zeichen sind erforderlich"},{status:400});
      const id=`M-${crypto.randomUUID().slice(0,8).toUpperCase()}`,initials=name.split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,'Vorstand',?,?,1)").bind(id,name,code,initials),
        env.DB.prepare("UPDATE members SET active=0 WHERE id IN ('M-1042','M-1088','M-1137','M-1201','M-1214','M-1228','M-1240')"),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"PRIMARY_ADMIN_CREATED","member",id,id,JSON.stringify({name,profileId:profile.id}),now)
      ]);
      return Response.json({ok:true,id});
    }

    if(!admin)return Response.json({error:"Nur der Vorstand eines entsperrten Profils darf Mitglieder verwalten"},{status:403});

    if(b.action==="create"){
      const firstName=(b.firstName||"").trim().replace(/\s+/g," ").slice(0,60);
      const lastName=(b.lastName||"").trim().replace(/\s+/g," ").slice(0,60);
      const role=b.role?.trim()||"Mitglied";
      if(firstName.length<2||lastName.length<2)return Response.json({error:"Bitte Vorname und Nachname vollständig eingeben"},{status:400});
      if(!["Mitglied","Vorstand"].includes(role))return Response.json({error:"Ungültige Rolle"},{status:400});
      const name=`${firstName} ${lastName}`,id=`M-${crypto.randomUUID().slice(0,8).toUpperCase()}`,initials=`${firstName[0]}${lastName[0]}`.toUpperCase(),code=`NOLOGIN-${crypto.randomUUID()}`;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,?,?,?,1)").bind(id,name,role,code,initials),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MEMBER_CREATED","member",id,admin.id,JSON.stringify({name,role,profileId:profile.id,adminAccess:false}),now)
      ]);
      await env.BACKUPS.put(`members/${now.slice(0,10)}/${id}.json`,JSON.stringify({action:"create",id,name,role,initials,operator:admin,profileId:profile.id,createdAt:now}),{httpMetadata:{contentType:"application/json"}});
      return Response.json({ok:true,member:{id,name,role,initials,active:true,hasAccess:false}},{status:201});
    }

    if(b.action==="set_access"){
      const code=b.code?.trim();
      if(!b.id||!code||code.length<10)return Response.json({error:"Der Admin-Code muss mindestens 10 Zeichen lang sein"},{status:400});
      const member=await env.DB.prepare("SELECT id,name,role FROM members WHERE id=? AND active=1").bind(b.id).first<{id:string;name:string;role:string}>();
      if(!member)return Response.json({error:"Mitglied nicht gefunden"},{status:404});
      if(member.role!=="Vorstand")return Response.json({error:"Nur Vorstand / Admin benötigt einen geschützten Zugang"},{status:400});
      await env.DB.batch([
        env.DB.prepare("UPDATE members SET code=? WHERE id=?").bind(code,member.id),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MEMBER_ACCESS_SET","member",member.id,admin.id,JSON.stringify({profileId:profile.id}),now)
      ]);
      return Response.json({ok:true});
    }

    if(b.action==="toggle"){
      if(!b.id||b.id===admin.id)return Response.json({error:"Das eigene Administratorkonto kann nicht deaktiviert werden"},{status:400});
      const member=await env.DB.prepare("SELECT active FROM members WHERE id=?").bind(b.id).first<{active:number}>();
      if(!member)return Response.json({error:"Mitglied nicht gefunden"},{status:404});
      const active=member.active?0:1;
      await env.DB.batch([
        env.DB.prepare("UPDATE members SET active=? WHERE id=?").bind(active,b.id),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),active?"MEMBER_ACTIVATED":"MEMBER_DEACTIVATED","member",b.id,admin.id,JSON.stringify({profileId:profile.id}),now)
      ]);
      return Response.json({ok:true,active:Boolean(active)});
    }
    return Response.json({error:"Unbekannte Aktion"},{status:400});
  }catch(e){
    const message=e instanceof Error?e.message:"Mitglied konnte nicht gespeichert werden";
    return Response.json({error:message.includes("UNIQUE")?"Dieser Admin-Code wird bereits verwendet":message},{status:500});
  }
}
