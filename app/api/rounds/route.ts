import { env } from "cloudflare:workers";
import { sessionUser } from "../session";

export async function PATCH(request:Request){
  try{const body=await request.json() as {roundId:string;memberId:string;memberName:string};const member=await sessionUser(request);if(!member||member.id!==body.memberId)return Response.json({error:"Mitglied muss sich selbst identifizieren"},{status:403});if(!body.roundId||!body.memberId)return Response.json({error:"Angaben fehlen"},{status:400});
    const reduced=await env.DB.prepare("UPDATE rounds SET remaining=remaining-1, active=CASE WHEN remaining-1<=0 THEN 0 ELSE 1 END WHERE id=? AND active=1 AND remaining>0 AND (SELECT COALESCE(SUM(quantity),0) FROM round_claims WHERE round_id=? AND member_id=?) < max_per_member").bind(body.roundId,body.roundId,body.memberId).run();
    if(!reduced.meta.changes)return Response.json({error:"Limit erreicht oder Runde beendet"},{status:409});
    const claimId=`${body.roundId}-${body.memberId}`; const claimedAt=new Date().toISOString(); await env.DB.prepare("INSERT INTO round_claims (id,round_id,member_id,member_name,quantity,claimed_at) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET quantity=quantity+1, claimed_at=excluded.claimed_at").bind(claimId,body.roundId,body.memberId,body.memberName,claimedAt).run();
    await env.BACKUPS.put(`round-claims/${claimedAt.slice(0,10)}/${body.roundId}-${body.memberId}-${Date.now()}.json`,JSON.stringify({...body,quantity:1,claimedAt}),{httpMetadata:{contentType:"application/json"}});
    const round=await env.DB.prepare("SELECT * FROM rounds WHERE id=?").bind(body.roundId).first(); return Response.json({ok:true,round});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Einlösen fehlgeschlagen"},{status:500})}
}
