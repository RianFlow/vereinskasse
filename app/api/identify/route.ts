import { env } from "cloudflare:workers";
import { protectAccessCode, verifyAccessCode } from "../member-access";
import { requireProfile } from "../profile-session";
import { issueSession } from "../session";

type AccessMember={id:string;name:string;role:string;initials:string;code:string};
const retiredDemoIds=["M-1042","M-1088","M-1137","M-1201","M-1214","M-1228","M-1240"];
const shortHash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("").slice(0,20);

export async function POST(request:Request){
  try{
    const profile=await requireProfile(request);
    if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});
    const {code,memberId}=await request.json() as {code?:string;memberId?:string};
    if(!code||code.length>100||memberId&&memberId.length>40)return Response.json({error:"Ungültige Kennung"},{status:400});
    const nowDate=new Date(),now=nowDate.toISOString(),clientAddress=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"local",attemptKey=memberId?`${memberId}:${await shortHash(clientAddress)}`:null;
    if(attemptKey){
      const cutoff=new Date(nowDate.getTime()-15*60*1000).toISOString(),failed=await env.DB.prepare("SELECT COUNT(*) count FROM audit_logs WHERE action='MEMBER_ACCESS_FAILED' AND entity_id=? AND created_at>=?").bind(attemptKey,cutoff).first<{count:number}>();
      if(Number(failed?.count||0)>=5)return Response.json({error:"Zu viele Fehlversuche. Dieser Zugang ist für dieses Gerät 15 Minuten gesperrt."},{status:429});
    }
    const base=`SELECT id,name,role,initials,code FROM members WHERE active=1 AND id NOT IN (${retiredDemoIds.map(()=>"?").join(",")})`;
    const candidates=memberId
      ?await env.DB.prepare(`${base} AND id=?`).bind(...retiredDemoIds,memberId).all<AccessMember>()
      :await env.DB.prepare(`${base} AND code NOT LIKE 'NOLOGIN-%'`).bind(...retiredDemoIds).all<AccessMember>();
    let member:AccessMember|undefined,legacy=false;
    for(const candidate of candidates.results){
      const checked=await verifyAccessCode(candidate.code,code.trim());
      if(checked.valid){member=candidate;legacy=checked.legacy;break}
    }
    if(!member){
      if(attemptKey)await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MEMBER_ACCESS_FAILED","member_access",attemptKey,"ANONYMOUS",JSON.stringify({profileId:profile.id,memberId}),now).run();
      return Response.json({error:memberId?"Admin-Code passt nicht zum ausgewählten Namen":"Kennung nicht bekannt"},{status:404});
    }
    if(legacy)await env.DB.prepare("UPDATE members SET code=? WHERE id=? AND code=?").bind(await protectAccessCode(code.trim()),member.id,member.code).run();
    const safeMember={id:member.id,name:member.name,role:member.role,initials:member.initials};
    const session=await issueSession(safeMember);
    await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"MEMBER_ACCESS_LOGIN","member_access",member.id,member.id,JSON.stringify({profileId:profile.id,legacyUpgraded:legacy}),now).run();
    return new Response(JSON.stringify({member:safeMember}),{headers:{"content-type":"application/json","set-cookie":session.cookie}});
  }catch{
    return Response.json({error:"Anmeldung fehlgeschlagen"},{status:500});
  }
}

export async function DELETE(){
  return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","set-cookie":"vereinskasse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"}});
}
