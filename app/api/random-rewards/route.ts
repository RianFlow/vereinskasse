import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { requireRole } from "../session";

type CampaignInput={name?:string;rewardType?:"free_item"|"percent";rewardValue?:number;totalWins?:number;startsAt?:string;endsAt?:string};
type CampaignRow={id:string;name:string;rewardType:"free_item"|"percent";rewardValue:number;totalWins:number;remainingWins:number;startsAt:string;endsAt:string;status:string;createdAt:string;claimedWins:number};

const secureRandom=()=>{const value=new Uint32Array(1);crypto.getRandomValues(value);return value[0]/4294967296};
const publicCampaign=(campaign:CampaignRow)=>({...campaign,rewardLabel:campaign.rewardType==="free_item"?"1 Artikel gratis":`${campaign.rewardValue}% Rabatt`,claimedWins:Number(campaign.claimedWins||0)});

export async function GET(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request)]);
  if(!admin||!profile)return Response.json({error:"Nur der Vorstand kann Glücksmomente verwalten"},{status:403});
  const campaigns=await env.DB.prepare("SELECT c.id,c.name,c.reward_type rewardType,c.reward_value rewardValue,c.total_wins totalWins,c.remaining_wins remainingWins,c.starts_at startsAt,c.ends_at endsAt,c.status,c.created_at createdAt,COUNT(CASE WHEN s.claimed_at IS NOT NULL THEN 1 END) claimedWins FROM random_reward_campaigns c LEFT JOIN random_reward_slots s ON s.campaign_id=c.id WHERE c.profile_id=? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50").bind(profile.id).all<CampaignRow>();
  const claims=await env.DB.prepare("SELECT s.id,s.campaign_id campaignId,s.claimed_at claimedAt,s.winner_name winnerName,s.reward_amount rewardAmount,s.reward_label rewardLabel FROM random_reward_slots s JOIN random_reward_campaigns c ON c.id=s.campaign_id WHERE s.profile_id=? AND s.claimed_at IS NOT NULL ORDER BY s.claimed_at DESC LIMIT 50").bind(profile.id).all();
  return Response.json({now:new Date().toISOString(),campaigns:campaigns.results.map(publicCampaign),claims:claims.results},{headers:{"cache-control":"no-store"}});
}

export async function POST(request:Request){
  try{
    const [admin,profile,body]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request),request.json() as Promise<CampaignInput>]);
    if(!admin||!profile)return Response.json({error:"Nur der Vorstand kann Glücksmomente anlegen"},{status:403});
    const name=String(body.name||"").trim(),rewardType=body.rewardType,totalWins=Math.trunc(Number(body.totalWins)),rewardValue=rewardType==="percent"?Number(body.rewardValue):0;
    const requestedStart=Date.parse(String(body.startsAt||"")),end=Date.parse(String(body.endsAt||"")),now=Date.now(),start=Math.max(requestedStart,now);
    if(name.length<3||name.length>80)return Response.json({error:"Bitte einen Namen mit 3 bis 80 Zeichen eingeben"},{status:400});
    if(!["free_item","percent"].includes(String(rewardType)))return Response.json({error:"Unbekannte Gewinnart"},{status:400});
    if(!Number.isInteger(totalWins)||totalWins<1||totalWins>50)return Response.json({error:"Es sind 1 bis 50 Gewinne möglich"},{status:400});
    if(!Number.isFinite(requestedStart)||!Number.isFinite(end)||end<=start||end-start>90*24*60*60*1000)return Response.json({error:"Der Zeitraum muss in der Zukunft liegen und darf höchstens 90 Tage dauern"},{status:400});
    if(rewardType==="percent"&&(!Number.isFinite(rewardValue)||rewardValue<1||rewardValue>100))return Response.json({error:"Der Rabatt muss zwischen 1 und 100 Prozent liegen"},{status:400});
    const id=crypto.randomUUID(),createdAt=new Date(now).toISOString(),startsAt=new Date(start).toISOString(),endsAt=new Date(end).toISOString(),duration=end-start;
    const slots=Array.from({length:totalWins},(_,index)=>{const windowStart=start+duration*index/totalWins,windowEnd=start+duration*(index+1)/totalWins;return {id:crypto.randomUUID(),triggerAt:new Date(windowStart+secureRandom()*(windowEnd-windowStart)).toISOString()}}).sort((a,b)=>a.triggerAt.localeCompare(b.triggerAt));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO random_reward_campaigns (id,profile_id,name,reward_type,reward_value,total_wins,remaining_wins,starts_at,ends_at,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)").bind(id,profile.id,name,rewardType,rewardValue,totalWins,totalWins,startsAt,endsAt,admin.id,createdAt),
      ...slots.map(slot=>env.DB.prepare("INSERT INTO random_reward_slots (id,profile_id,campaign_id,trigger_at) VALUES (?,?,?,?)").bind(slot.id,profile.id,id,slot.triggerAt)),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RANDOM_REWARD_CREATED","random_reward_campaign",id,admin.id,JSON.stringify({profileId:profile.id,name,rewardType,rewardValue,totalWins,startsAt,endsAt}),createdAt),
    ]);
    await env.BACKUPS.put(`random-rewards/${profile.id}/${createdAt.slice(0,10)}/${id}.json`,JSON.stringify({id,profileId:profile.id,name,rewardType,rewardValue,totalWins,startsAt,endsAt,createdBy:admin,createdAt}),{httpMetadata:{contentType:"application/json"}});
    return Response.json({ok:true,id},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Glücksmoment konnte nicht angelegt werden"},{status:500})}
}

export async function PATCH(request:Request){
  try{
    const [admin,profile,body]=await Promise.all([requireRole(request,["Vorstand"]),requireProfile(request),request.json() as Promise<{id?:string;action?:"cancel"}>]);
    if(!admin||!profile)return Response.json({error:"Nur der Vorstand kann Glücksmomente beenden"},{status:403});
    if(!body.id||body.action!=="cancel")return Response.json({error:"Ungültige Aktion"},{status:400});
    const now=new Date().toISOString(),campaign=await env.DB.prepare("SELECT id FROM random_reward_campaigns WHERE id=? AND profile_id=? AND status='active'").bind(body.id,profile.id).first();
    if(!campaign)return Response.json({error:"Aktive Aktion nicht gefunden"},{status:404});
    await env.DB.batch([
      env.DB.prepare("UPDATE random_reward_campaigns SET status='cancelled' WHERE id=? AND profile_id=?").bind(body.id,profile.id),
      env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"RANDOM_REWARD_CANCELLED","random_reward_campaign",body.id,admin.id,JSON.stringify({profileId:profile.id}),now),
    ]);
    return Response.json({ok:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Aktion konnte nicht beendet werden"},{status:500})}
}
