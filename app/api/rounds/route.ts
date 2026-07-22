import { env } from "cloudflare:workers";
import { sessionUser } from "../session";
import { requireProfile } from "../profile-session";

export async function PATCH(request:Request){
  try{const body=await request.json() as {roundId:string;memberId:string;memberName:string};const [member,profile]=await Promise.all([sessionUser(request),requireProfile(request)]);if(!member||member.id!==body.memberId||!profile)return Response.json({error:"Mitglied und Profil müssen identifiziert sein"},{status:403});if(!body.roundId||!body.memberId)return Response.json({error:"Angaben fehlen"},{status:400});
    const claimId=`${body.roundId}-${body.memberId}`,claimedAt=new Date().toISOString(),results=await env.DB.batch([env.DB.prepare("INSERT INTO round_claims (id,profile_id,round_id,member_id,member_name,quantity,claimed_at) SELECT ?,?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM rounds WHERE id=? AND profile_id=? AND active=1 AND remaining>0) ON CONFLICT(id) DO UPDATE SET quantity=quantity+1,member_name=excluded.member_name,claimed_at=excluded.claimed_at WHERE quantity < (SELECT max_per_member FROM rounds WHERE id=? AND profile_id=?) AND EXISTS (SELECT 1 FROM rounds WHERE id=? AND profile_id=? AND active=1 AND remaining>0)").bind(claimId,profile.id,body.roundId,body.memberId,member.name,claimedAt,body.roundId,profile.id,body.roundId,profile.id,body.roundId,profile.id),env.DB.prepare("UPDATE rounds SET remaining=remaining-1,active=CASE WHEN remaining-1<=0 THEN 0 ELSE 1 END WHERE id=? AND profile_id=? AND active=1 AND remaining>0 AND EXISTS (SELECT 1 FROM round_claims WHERE id=? AND claimed_at=?)").bind(body.roundId,profile.id,claimId,claimedAt)]);
    if(!results[0].meta.changes)return Response.json({error:"Limit erreicht oder Runde beendet"},{status:409});
    await env.BACKUPS.put(`round-claims/${profile.id}/${claimedAt.slice(0,10)}/${body.roundId}-${body.memberId}-${Date.now()}.json`,JSON.stringify({roundId:body.roundId,memberId:body.memberId,memberName:member.name,profileId:profile.id,quantity:1,claimedAt}),{httpMetadata:{contentType:"application/json"}});
    const round=await env.DB.prepare("SELECT * FROM rounds WHERE id=? AND profile_id=?").bind(body.roundId,profile.id).first(); return Response.json({ok:true,round});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Einlösen fehlgeschlagen"},{status:500})}
}
