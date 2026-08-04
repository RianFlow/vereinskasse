import { env } from "cloudflare:workers";
import { profileCookie } from "../../profile-session";
import { issueSession } from "../../session";

type LoginProfile={id:string;name:string;shortName:string;color:string;mustChangePin:number};
type LoginScan={id:string;uid:string;deviceId:string;memberId:string|null;memberName:string|null;memberRole:string|null;memberInitials:string|null};

const headers={"cache-control":"no-store"};

export async function GET(request:Request){
  try{
    const profileId=new URL(request.url).searchParams.get("profileId")?.trim();
    if(!profileId||profileId.length>100)return Response.json({error:"Bitte zuerst ein Profil auswählen"},{status:400,headers});
    const nowDate=new Date(),now=nowDate.toISOString(),onlineCutoff=new Date(nowDate.getTime()-45_000).toISOString();
    const [profile,scan,online]=await Promise.all([
      env.DB.prepare("SELECT id,name,short_name shortName,color,must_change_pin mustChangePin FROM profiles WHERE id=? AND active=1").bind(profileId).first<LoginProfile>(),
      env.DB.prepare("SELECT s.id,s.uid,s.device_id deviceId,m.id memberId,m.name memberName,m.role memberRole,m.initials memberInitials FROM rfid_scans s JOIN rfid_devices d ON d.id=s.device_id AND d.active=1 LEFT JOIN rfid_cards c ON c.profile_id=s.profile_id AND c.uid=s.uid LEFT JOIN members m ON m.id=c.member_id AND m.active=1 WHERE s.profile_id=? AND s.consumed_at IS NULL AND s.expires_at>? ORDER BY s.created_at LIMIT 1").bind(profileId,now).first<LoginScan>(),
      env.DB.prepare("SELECT COUNT(*) count FROM rfid_devices WHERE profile_id=? AND active=1 AND last_seen_at>=?").bind(profileId,onlineCutoff).first<{count:number}>()
    ]);
    if(!profile)return Response.json({error:"Profil nicht gefunden"},{status:404,headers});
    if(!scan)return Response.json({state:"waiting",deviceCount:Number(online?.count||0)},{headers});
    const consumed=await env.DB.prepare("UPDATE rfid_scans SET consumed_at=? WHERE id=? AND profile_id=? AND consumed_at IS NULL").bind(now,scan.id,profile.id).run();
    if(!consumed.meta.changes)return Response.json({state:"waiting",deviceCount:Number(online?.count||0)},{headers});
    if(profile.mustChangePin)return Response.json({state:"pin_required",deviceCount:Number(online?.count||0)},{headers});
    if(!scan.memberId||!scan.memberName||!scan.memberRole)return Response.json({state:"unknown",deviceCount:Number(online?.count||0)},{headers});

    const member={id:scan.memberId,name:scan.memberName,role:scan.memberRole,initials:scan.memberInitials||scan.memberName.split(" ").map(part=>part[0]).slice(0,2).join("")};
    const profileToken=crypto.randomUUID()+crypto.randomUUID(),profileExpires=new Date(nowDate.getTime()+12*60*60*1000),memberSession=await issueSession(member);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM profile_sessions WHERE expires_at<=?").bind(now),
      env.DB.prepare("INSERT INTO profile_sessions (token,profile_id,expires_at,created_at) VALUES (?,?,?,?)").bind(profileToken,profile.id,profileExpires.toISOString(),now),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RFID_PROFILE_LOGIN","rfid_card",scan.uid,member.id,JSON.stringify({profileId:profile.id,deviceId:scan.deviceId}),now)
    ]);
    const responseHeaders=new Headers({"content-type":"application/json","cache-control":"no-store"});
    responseHeaders.append("set-cookie",profileCookie(profileToken));
    responseHeaders.append("set-cookie",memberSession.cookie);
    return new Response(JSON.stringify({state:"recognized",deviceCount:Number(online?.count||0),profile:{id:profile.id,name:profile.name,shortName:profile.shortName,color:profile.color,mustChangePin:false},member}),{headers:responseHeaders});
  }catch{
    return Response.json({error:"RFID-Profilanmeldung ist vorübergehend nicht möglich"},{status:500,headers});
  }
}
