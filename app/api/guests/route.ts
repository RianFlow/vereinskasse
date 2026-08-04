import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { sessionUser } from "../session";

type GuestAction="create_club"|"create_person"|"use_today"|"remove_today";
type GuestRow={id:string;profileId:string;name:string;type:"visitor"|"club";parentId:string|null;visitDate:string|null;active:number;createdAt:string;updatedAt:string};

const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const cleanName=(value:unknown)=>String(value||"").trim().replace(/\s+/g," ").replace(/[^a-zA-Z0-9äöüÄÖÜß .&'\-]/g,"").slice(0,70);
const guestsFor=async(profileId:string)=>(await env.DB.prepare("SELECT id,profile_id profileId,name,type,parent_id parentId,visit_date visitDate,active,created_at createdAt,updated_at updatedAt FROM guest_accounts WHERE profile_id=? AND active=1 ORDER BY CASE WHEN type='club' THEN 0 ELSE 1 END,updated_at DESC,name").bind(profileId).all<GuestRow>()).results;

export async function POST(request:Request){
  try{
    const [profile,operator]=await Promise.all([requireProfile(request),sessionUser(request)]);
    if(!profile)return Response.json({error:"Bitte zuerst ein Profil entsperren"},{status:401});
    const body=await request.json() as {action?:GuestAction;name?:unknown;clubId?:unknown;memberId?:unknown};
    const action=body.action,now=new Date().toISOString(),visitDate=today(),operatorId=operator?.id||`PROFILE-${profile.id}`;
    if(!action||!["create_club","create_person","use_today","remove_today"].includes(action))return Response.json({error:"Unbekannte Besucheraktion"},{status:400});

    if(action==="create_club"){
      const name=cleanName(body.name);
      if(name.length<2)return Response.json({error:"Bitte einen Vereinsnamen eingeben"},{status:400});
      const existing=await env.DB.prepare("SELECT id FROM guest_accounts WHERE profile_id=? AND type='club' AND parent_id IS NULL AND LOWER(TRIM(name))=LOWER(?) LIMIT 1").bind(profile.id,name).first<{id:string}>();
      const id=existing?.id||`GAST-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
      if(existing)await env.DB.prepare("UPDATE guest_accounts SET name=?,active=1,updated_at=? WHERE id=? AND profile_id=?").bind(name,now,id,profile.id).run();
      else await env.DB.prepare("INSERT INTO guest_accounts (id,profile_id,name,type,parent_id,visit_date,active,created_at,updated_at) VALUES (?,?,?,'club',NULL,NULL,1,?,?)").bind(id,profile.id,name,now,now).run();
      await env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),existing?"GUEST_CLUB_REUSED":"GUEST_CLUB_CREATED","guest_account",id,operatorId,JSON.stringify({profileId:profile.id,name}),now).run();
      return Response.json({ok:true,focusId:id,guests:await guestsFor(profile.id)});
    }

    if(action==="create_person"){
      const name=cleanName(body.name),clubId=String(body.clubId||"").slice(0,100);
      if(name.length<2)return Response.json({error:"Bitte den Namen des Gastes eingeben"},{status:400});
      const club=await env.DB.prepare("SELECT id,name FROM guest_accounts WHERE id=? AND profile_id=? AND type='club' AND parent_id IS NULL AND active=1").bind(clubId,profile.id).first<{id:string;name:string}>();
      if(!club)return Response.json({error:"Der Besucherverein ist nicht mehr verfügbar"},{status:404});
      const existing=await env.DB.prepare("SELECT id FROM guest_accounts WHERE profile_id=? AND parent_id=? AND LOWER(TRIM(name))=LOWER(?) LIMIT 1").bind(profile.id,club.id,name).first<{id:string}>();
      const id=existing?.id||`GAST-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
      if(existing)await env.DB.prepare("UPDATE guest_accounts SET name=?,visit_date=?,active=1,updated_at=? WHERE id=? AND profile_id=?").bind(name,visitDate,now,id,profile.id).run();
      else await env.DB.prepare("INSERT INTO guest_accounts (id,profile_id,name,type,parent_id,visit_date,active,created_at,updated_at) VALUES (?,?,?,'visitor',?,?,1,?,?)").bind(id,profile.id,name,club.id,visitDate,now,now).run();
      await env.DB.batch([
        env.DB.prepare("UPDATE guest_accounts SET updated_at=? WHERE id=? AND profile_id=?").bind(now,club.id,profile.id),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),existing?"GUEST_PERSON_REUSED":"GUEST_PERSON_CREATED","guest_account",id,operatorId,JSON.stringify({profileId:profile.id,clubId:club.id,clubName:club.name,name,visitDate}),now)
      ]);
      return Response.json({ok:true,focusId:club.id,guests:await guestsFor(profile.id)});
    }

    const memberId=String(body.memberId||"").slice(0,100);
    const member=await env.DB.prepare("SELECT g.id,g.name,g.parent_id parentId,c.name clubName FROM guest_accounts g JOIN guest_accounts c ON c.id=g.parent_id AND c.profile_id=g.profile_id WHERE g.id=? AND g.profile_id=? AND g.type='visitor' AND g.active=1").bind(memberId,profile.id).first<{id:string;name:string;parentId:string;clubName:string}>();
    if(!member)return Response.json({error:"Der Gast wurde nicht gefunden"},{status:404});
    const nextDate=action==="use_today"?visitDate:null;
    await env.DB.batch([
      env.DB.prepare("UPDATE guest_accounts SET visit_date=?,updated_at=? WHERE id=? AND profile_id=?").bind(nextDate,now,member.id,profile.id),
      env.DB.prepare("UPDATE guest_accounts SET updated_at=? WHERE id=? AND profile_id=?").bind(now,member.parentId,profile.id),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),action==="use_today"?"GUEST_PERSON_ADDED_TODAY":"GUEST_PERSON_REMOVED_TODAY","guest_account",member.id,operatorId,JSON.stringify({profileId:profile.id,clubId:member.parentId,clubName:member.clubName,name:member.name,visitDate}),now)
    ]);
    return Response.json({ok:true,focusId:member.parentId,guests:await guestsFor(profile.id)});
  }catch(reason){
    return Response.json({error:reason instanceof Error?reason.message:"Besucherliste konnte nicht gespeichert werden"},{status:500});
  }
}
