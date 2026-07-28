import { env } from "cloudflare:workers";
import { hasRole, requireRole } from "../session";
import { requireProfile } from "../profile-session";
import { protectAccessCode } from "../member-access";

const safe=()=>env.DB.prepare("SELECT m.id,m.name,m.role,m.initials,m.active,CASE WHEN m.code LIKE 'NOLOGIN-%' THEN 0 ELSE 1 END hasAccess,l.status lifecycleStatus,l.left_at leftAt,l.privacy_review_at privacyReviewAt FROM members m LEFT JOIN member_lifecycle l ON l.member_id=m.id WHERE m.id NOT IN ('M-1042','M-1088','M-1137','M-1201','M-1214','M-1228','M-1240') ORDER BY m.name").all();
const allowedRoles=["Mitglied","Vorstand","Kassenwart","Systemadmin"];
const canonicalRole=(requested:string[])=>{
  const roles=[...new Set(requested.map(role=>role.trim()))];
  if(!roles.length||roles.some(role=>!allowedRoles.includes(role)))return null;
  const protectedRoles=roles.filter(role=>role!=="Mitglied");
  return (protectedRoles.length?["Vorstand","Kassenwart","Systemadmin"].filter(candidate=>protectedRoles.includes(candidate)):["Mitglied"]).join("+");
};
export async function GET(request:Request){const profile=await requireProfile(request);if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});const rows=await safe();return Response.json({members:rows.results})}
export async function POST(request:Request){
  try{
    const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);
    if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:403});
    const b=await request.json() as {action:string;id?:string;name?:string;firstName?:string;lastName?:string;role?:string;roles?:string[];code?:string;note?:string};
    const now=new Date().toISOString();

    if(b.action==="bootstrap"){
      const existing=await env.DB.prepare("SELECT id FROM members WHERE active=1 AND ('+' || role || '+') LIKE '%+Vorstand+%' AND id<>'M-1088' LIMIT 1").first();
      if(existing)return Response.json({error:"Ein Hauptadministrator ist bereits eingerichtet"},{status:409});
      const name=b.name?.trim(),code=b.code?.trim();
      if(!name||!code||code.length<10)return Response.json({error:"Name und ein Admin-Code mit mindestens 10 Zeichen sind erforderlich"},{status:400});
      const id=`M-${crypto.randomUUID().slice(0,8).toUpperCase()}`,initials=name.split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase(),protectedCode=await protectAccessCode(code);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,'Vorstand',?,?,1)").bind(id,name,protectedCode,initials),
        env.DB.prepare("UPDATE members SET active=0 WHERE id IN ('M-1042','M-1088','M-1137','M-1201','M-1214','M-1228','M-1240')"),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"PRIMARY_ADMIN_CREATED","member",id,id,JSON.stringify({name,profileId:profile.id}),now)
      ]);
      return Response.json({ok:true,id});
    }

    if(!admin)return Response.json({error:"Nur der Vorstand eines entsperrten Profils darf Mitglieder verwalten"},{status:403});

    if(b.action==="create"){
      const firstName=(b.firstName||"").trim().replace(/\s+/g," ").slice(0,60);
      const lastName=(b.lastName||"").trim().replace(/\s+/g," ").slice(0,60);
      const role=canonicalRole(Array.isArray(b.roles)?b.roles:[b.role?.trim()||"Mitglied"]);
      if(!role)return Response.json({error:"Ungültige Rolle"},{status:400});
      if(firstName.length<2||lastName.length<2)return Response.json({error:"Bitte Vorname und Nachname vollständig eingeben"},{status:400});
      const name=`${firstName} ${lastName}`,id=`M-${crypto.randomUUID().slice(0,8).toUpperCase()}`,initials=`${firstName[0]}${lastName[0]}`.toUpperCase(),code=`NOLOGIN-${crypto.randomUUID()}`;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,?,?,?,1)").bind(id,name,role,code,initials),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MEMBER_CREATED","member",id,admin.id,JSON.stringify({name,role,profileId:profile.id,adminAccess:false}),now)
      ]);
      await env.BACKUPS.put(`members/${now.slice(0,10)}/${id}.json`,JSON.stringify({action:"create",id,name,role,initials,operator:admin,profileId:profile.id,createdAt:now}),{httpMetadata:{contentType:"application/json"}});
      return Response.json({ok:true,member:{id,name,role,initials,active:true,hasAccess:false}},{status:201});
    }

    if(b.action==="set_roles"){
      if(!b.id)return Response.json({error:"Mitglied fehlt"},{status:400});
      const role=canonicalRole(Array.isArray(b.roles)?b.roles:[]);
      if(!role)return Response.json({error:"Bitte mindestens eine gültige Funktion auswählen"},{status:400});
      const member=await env.DB.prepare("SELECT id,name,role,code FROM members WHERE id=? AND active=1").bind(b.id).first<{id:string;name:string;role:string;code:string}>();
      if(!member)return Response.json({error:"Mitglied nicht gefunden"},{status:404});
      if(hasRole(member,"Vorstand")&&!role.split("+").includes("Vorstand")){
        const others=await env.DB.prepare("SELECT COUNT(*) count FROM members WHERE active=1 AND ('+' || role || '+') LIKE '%+Vorstand+%' AND id<>?").bind(member.id).first<{count:number}>();
        if(!Number(others?.count||0))return Response.json({error:"Der letzte Hauptadministrator muss Vorstand bleiben. Bitte zuerst einen zweiten Vorstand festlegen."},{status:409});
      }
      const protectedAccess=role!=="Mitglied",nextCode=protectedAccess?member.code:`NOLOGIN-${crypto.randomUUID()}`;
      await env.DB.batch([
        env.DB.prepare("UPDATE members SET role=?,code=? WHERE id=?").bind(role,nextCode,member.id),
        env.DB.prepare("DELETE FROM auth_sessions WHERE member_id=? AND member_id<>?").bind(member.id,admin.id),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MEMBER_ROLES_CHANGED","member",member.id,admin.id,JSON.stringify({profileId:profile.id,before:member.role,after:role,accessRevoked:!protectedAccess}),now)
      ]);
      return Response.json({ok:true,member:{id:member.id,name:member.name,role,hasAccess:protectedAccess&&!nextCode.startsWith("NOLOGIN-")}});
    }

    if(b.action==="set_access"){
      const code=b.code?.trim();
      if(!b.id||!code||code.length<10)return Response.json({error:"Der Admin-Code muss mindestens 10 Zeichen lang sein"},{status:400});
      const member=await env.DB.prepare("SELECT id,name,role FROM members WHERE id=? AND active=1").bind(b.id).first<{id:string;name:string;role:string}>();
      if(!member)return Response.json({error:"Mitglied nicht gefunden"},{status:404});
      if(!["Vorstand","Kassenwart","Systemadmin"].some(role=>hasRole(member,role)))return Response.json({error:"Vorstand, Kassenwart und Systemadministration benötigen einen geschützten Zugang"},{status:400});
      const protectedCode=await protectAccessCode(code);
      await env.DB.batch([
        env.DB.prepare("UPDATE members SET code=? WHERE id=?").bind(protectedCode,member.id),
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
        env.DB.prepare("INSERT INTO member_lifecycle (member_id,status,left_at,privacy_review_at,retired_by,note,updated_at) VALUES (?,? ,NULL,NULL,NULL,'',?) ON CONFLICT(member_id) DO UPDATE SET status=excluded.status,left_at=CASE WHEN excluded.status='active' THEN NULL ELSE member_lifecycle.left_at END,privacy_review_at=CASE WHEN excluded.status='active' THEN NULL ELSE member_lifecycle.privacy_review_at END,updated_at=excluded.updated_at").bind(b.id,active?"active":"inactive",now),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),active?"MEMBER_ACTIVATED":"MEMBER_DEACTIVATED","member",b.id,admin.id,JSON.stringify({profileId:profile.id}),now)
      ]);
      return Response.json({ok:true,active:Boolean(active)});
    }
    if(b.action==="retire"){
      if(!b.id||b.id===admin.id)return Response.json({error:"Das eigene Administratorkonto kann nicht als ausgetreten markiert werden"},{status:400});
      const member=await env.DB.prepare("SELECT id,name,role,active FROM members WHERE id=?").bind(b.id).first<{id:string;name:string;role:string;active:number}>();
      if(!member)return Response.json({error:"Mitglied nicht gefunden"},{status:404});
      const balance=await env.DB.prepare("SELECT ROUND(COALESCE(SUM(amount),0),2) balance FROM account_transactions WHERE member_id=?").bind(member.id).first<{balance:number}>();
      if(Math.abs(Number(balance?.balance||0))>.005)return Response.json({error:`Austritt noch nicht möglich: Das Konto hat noch ${Number(balance?.balance||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})}. Bitte zuerst vollständig abrechnen.`},{status:409});
      if(hasRole(member,"Vorstand")){
        const others=await env.DB.prepare("SELECT COUNT(*) count FROM members WHERE active=1 AND ('+' || role || '+') LIKE '%+Vorstand+%' AND id<>?").bind(member.id).first<{count:number}>();
        if(!Number(others?.count||0))return Response.json({error:"Der letzte aktive Hauptadmin kann nicht austreten. Bitte zuerst einen weiteren Vorstand anlegen."},{status:409});
      }
      const review=new Date(now);review.setUTCFullYear(review.getUTCFullYear()+10);
      await env.DB.batch([
        env.DB.prepare("UPDATE members SET active=0,code=? WHERE id=?").bind(`NOLOGIN-${crypto.randomUUID()}`,member.id),
        env.DB.prepare("DELETE FROM rfid_cards WHERE member_id=?").bind(member.id),
        env.DB.prepare("DELETE FROM auth_sessions WHERE member_id=?").bind(member.id),
        env.DB.prepare("INSERT INTO member_lifecycle (member_id,status,left_at,privacy_review_at,retired_by,note,updated_at) VALUES (?,'retired',?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET status='retired',left_at=excluded.left_at,privacy_review_at=excluded.privacy_review_at,retired_by=excluded.retired_by,note=excluded.note,updated_at=excluded.updated_at").bind(member.id,now,review.toISOString(),admin.id,(b.note||"").trim().slice(0,300),now),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MEMBER_RETIRED","member",member.id,admin.id,JSON.stringify({profileId:profile.id,name:member.name,rfidRevoked:true,accessRevoked:true,privacyReviewAt:review.toISOString()}),now)
      ]);
      await env.BACKUPS.put(`member-lifecycle/${now.slice(0,10)}/${member.id}.json`,JSON.stringify({action:"retire",memberId:member.id,name:member.name,profileId:profile.id,retiredBy:admin,privacyReviewAt:review.toISOString(),createdAt:now}),{httpMetadata:{contentType:"application/json"}});
      return Response.json({ok:true,privacyReviewAt:review.toISOString()});
    }
    return Response.json({error:"Unbekannte Aktion"},{status:400});
  }catch(e){
    const message=e instanceof Error?e.message:"Mitglied konnte nicht gespeichert werden";
    return Response.json({error:message.includes("UNIQUE")?"Dieser Admin-Code wird bereits verwendet":message},{status:500});
  }
}
