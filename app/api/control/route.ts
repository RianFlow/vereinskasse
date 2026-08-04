import { env } from "cloudflare:workers";
import { requireProfile } from "../profile-session";
import { hasRole, requireRole } from "../session";

type RawAccount={memberId:string;memberName:string;balance:number;accountType:"guest"|"member";guestType:"visitor"|"club"|null;parentId:string|null;parentName:string|null};
type AccountSummary=RawAccount&{isClubGroup?:boolean;directBalance?:number;children?:RawAccount[]};

export async function GET(request:Request){
  const profile=await requireProfile(request);if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});
  const shift=await env.DB.prepare("SELECT * FROM shifts WHERE profile_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").bind(profile.id).first();
  const accounts=await env.DB.prepare("SELECT at.member_id memberId,MAX(at.member_name) memberName,ROUND(SUM(at.amount),2) balance,CASE WHEN MAX(ga.id) IS NULL THEN 'member' ELSE 'guest' END accountType,ga.type guestType,ga.parent_id parentId,parent.name parentName FROM account_transactions at LEFT JOIN guest_accounts ga ON ga.id=at.member_id AND ga.profile_id=at.profile_id LEFT JOIN guest_accounts parent ON parent.id=ga.parent_id AND parent.profile_id=ga.profile_id WHERE at.profile_id=? GROUP BY at.member_id,ga.type,ga.parent_id,parent.name HAVING ROUND(SUM(at.amount),2)>0 ORDER BY accountType DESC,memberName").bind(profile.id).all<RawAccount>();
  const recent=await env.DB.prepare("SELECT s.*,r.id reversal_id,r.reason reversal_reason,r.operator_name reversal_operator_name,r.created_at reversal_created_at FROM sales s LEFT JOIN reversals r ON r.sale_id=s.id WHERE s.profile_id=? ORDER BY s.time DESC LIMIT 20").bind(profile.id).all();
  const accountEntries=await env.DB.prepare("SELECT at.id,at.member_id memberId,at.member_name memberName,at.sale_id saleId,at.type,at.amount,at.note,at.created_at createdAt,COALESCE(op.name,at.operator_id) operatorName,s.cart_json cartJson,(SELECT COUNT(*) FROM sale_allocations sa WHERE sa.sale_id=at.sale_id) allocationCount FROM account_transactions at LEFT JOIN sales s ON s.id=at.sale_id LEFT JOIN members op ON op.id=at.operator_id WHERE at.profile_id=? ORDER BY at.created_at DESC LIMIT 1000").bind(profile.id).all();
  const accountItems=await env.DB.prepare("SELECT at.member_id memberId,si.sale_id saleId,si.product_name productName,si.quantity,si.unit_price unitPrice,si.total FROM account_transactions at JOIN sale_items si ON si.sale_id=at.sale_id WHERE at.profile_id=? AND at.amount>0 AND (SELECT COUNT(*) FROM sale_allocations sa WHERE sa.sale_id=at.sale_id)=1 ORDER BY at.created_at DESC").bind(profile.id).all();
  const splitAllocations=await env.DB.prepare("SELECT sa.sale_id saleId,s.time,s.total,sa.member_id memberId,sa.member_name memberName,sa.amount,r.id reversalId,(SELECT GROUP_CONCAT(si.quantity || '× ' || si.product_name, ', ') FROM sale_items si WHERE si.sale_id=s.id AND si.total>0) itemsLabel FROM sale_allocations sa JOIN sales s ON s.id=sa.sale_id LEFT JOIN reversals r ON r.sale_id=s.id WHERE sa.profile_id=? AND sa.sale_id IN (SELECT sa2.sale_id FROM sale_allocations sa2 JOIN sales s2 ON s2.id=sa2.sale_id WHERE sa2.profile_id=? GROUP BY sa2.sale_id HAVING COUNT(*)>1 ORDER BY MAX(s2.time) DESC LIMIT 100) ORDER BY s.time DESC,sa.id").bind(profile.id,profile.id).all();
  const rawAccounts=accounts.results.map(account=>({...account,balance:Number(account.balance)}));
  const clubGroups=new Map<string,AccountSummary>();
  for(const account of rawAccounts){
    const clubId=account.parentId||(account.guestType==="club"?account.memberId:null);
    if(!clubId)continue;
    const clubName=account.parentName||(account.guestType==="club"?account.memberName:clubId);
    const group=clubGroups.get(clubId)||{memberId:clubId,memberName:clubName,balance:0,accountType:"guest",guestType:"club",parentId:null,parentName:null,isClubGroup:true,directBalance:0,children:[]};
    group.balance=Math.round((group.balance+account.balance)*100)/100;
    if(account.memberId===clubId)group.directBalance=account.balance;
    else group.children!.push(account);
    clubGroups.set(clubId,group);
  }
  const groupedIds=new Set([...clubGroups.values()].flatMap(group=>[group.memberId,...(group.children||[]).map(child=>child.memberId)]));
  const visibleAccounts=[...rawAccounts.filter(account=>!groupedIds.has(account.memberId)),...clubGroups.values()].sort((left,right)=>left.accountType.localeCompare(right.accountType)||left.memberName.localeCompare(right.memberName,"de"));
  return Response.json({shift,accounts:visibleAccounts,recent:recent.results,accountEntries:accountEntries.results,accountItems:accountItems.results,splitAllocations:splitAllocations.results});
}

export async function POST(request:Request){
  try{
    const body=await request.json() as {action:string;openingCash?:number;countedCash?:number;saleId?:string;reason?:string;memberId?:string;memberName?:string;amount?:number;paymentMethod?:string;tendered?:number};
    const roles=body.action==="open"||body.action==="payment"?["Mitglied","Kassendienst","Kassenwart","Vorstand"]:["Kassendienst","Kassenwart","Vorstand"];
    const [operator,profile]=await Promise.all([requireRole(request,roles),requireProfile(request)]);if(!operator||!profile)return Response.json({error:body.action==="open"?"Bitte Mitgliedschip auflegen":"Keine Berechtigung oder Profilanmeldung abgelaufen"},{status:403});const now=new Date().toISOString();
    if(body.action==="open"){
      if(await env.DB.prepare("SELECT id FROM shifts WHERE profile_id=? AND status='open'").bind(profile.id).first())return Response.json({error:"Für dieses Profil ist bereits eine Kasse geöffnet"},{status:409});
      const openingCash=Number(body.openingCash||0);if(!Number.isFinite(openingCash)||openingCash<0||openingCash>10000)return Response.json({error:"Ungültiger Anfangsbestand"},{status:400});
      const id=crypto.randomUUID();await env.DB.batch([env.DB.prepare("INSERT INTO shifts (id,profile_id,opened_by,opened_by_name,opened_at,opening_cash,status) VALUES (?,?,?,?,?,?,'open')").bind(id,profile.id,operator.id,operator.name,now,openingCash),env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"SHIFT_OPENED","shift",id,operator.id,JSON.stringify({profileId:profile.id,openingCash,via:"member-rfid-or-session"}),now)]);return Response.json({ok:true,shift:{id,openedBy:operator.name,openedAt:now,openingCash}});
    }
    if(body.action==="close"){
      const shift=await env.DB.prepare("SELECT * FROM shifts WHERE profile_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1").bind(profile.id).first<{id:string;opening_cash:number;opened_at:string}>();if(!shift)return Response.json({error:"Keine offene Kasse"},{status:409});
      const [cash,reversals,accountCash]=await Promise.all([env.DB.prepare("SELECT COALESCE(SUM(total),0) total FROM sales WHERE profile_id=? AND method='Bar' AND time>=?").bind(profile.id,shift.opened_at).first<{total:number}>(),env.DB.prepare("SELECT COALESCE(SUM(r.amount),0) total FROM reversals r JOIN sales s ON s.id=r.sale_id WHERE s.profile_id=? AND s.method='Bar' AND s.time>=? AND r.created_at>=?").bind(profile.id,shift.opened_at,shift.opened_at).first<{total:number}>(),env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE profile_id=? AND method='Bar' AND sale_id IS NULL AND created_at>=?").bind(profile.id,shift.opened_at).first<{total:number}>()]);const expected=shift.opening_cash+Number(cash?.total||0)+Number(accountCash?.total||0)-Number(reversals?.total||0),counted=Number(body.countedCash||0);
      await env.DB.batch([
        env.DB.prepare("UPDATE shifts SET closed_by=?,closed_at=?,expected_cash=?,counted_cash=?,difference=?,status='closed' WHERE id=? AND profile_id=?").bind(operator.id,now,expected,counted,counted-expected,shift.id,profile.id),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"SHIFT_CLOSED","shift",shift.id,operator.id,JSON.stringify({profileId:profile.id,expected,counted,difference:counted-expected}),now)
      ]);await env.BACKUPS.put(`closings/${profile.id}/${now.slice(0,10)}/${shift.id}.json`,JSON.stringify({profile,shiftId:shift.id,expected,counted,difference:counted-expected,closedBy:operator,closedAt:now}));return Response.json({ok:true,expected,difference:counted-expected});
    }
    if(body.action==="reverse"){
      if(!hasRole(operator,"Vorstand")&&!hasRole(operator,"Kassenwart"))return Response.json({error:"Storno nur durch Vorstand oder Kassenwart"},{status:403});
      const sale=await env.DB.prepare("SELECT id,total FROM sales WHERE id=? AND profile_id=?").bind(body.saleId,profile.id).first<{id:string;total:number}>();if(!sale)return Response.json({error:"Buchung nicht gefunden"},{status:404});if(await env.DB.prepare("SELECT id FROM reversals WHERE sale_id=?").bind(sale.id).first())return Response.json({error:"Bereits storniert"},{status:409});
      const id=crypto.randomUUID(),allocations=await env.DB.prepare("SELECT * FROM sale_allocations WHERE sale_id=?").bind(sale.id).all<{member_id:string;member_name:string;amount:number}>(),rewardSlot=await env.DB.prepare("SELECT id,campaign_id campaignId FROM random_reward_slots WHERE sale_id=? AND profile_id=?").bind(sale.id,profile.id).first<{id:string;campaignId:string}>(),sponsoredRound=await env.DB.prepare("SELECT id FROM rounds WHERE sale_id=? AND profile_id=?").bind(sale.id,profile.id).first<{id:string}>();
      if(sponsoredRound&&await env.DB.prepare("SELECT id FROM round_claims WHERE round_id=? AND profile_id=? LIMIT 1").bind(sponsoredRound.id,profile.id).first())return Response.json({error:"Aus dieser Runde wurde bereits ausgeschenkt. Bitte zuerst eine nachvollziehbare Korrekturbuchung vornehmen."},{status:409});
      const statements=[env.DB.prepare("INSERT INTO reversals (id,sale_id,reason,amount,operator_id,operator_name,created_at) VALUES (?,?,?,?,?,?,?)").bind(id,sale.id,body.reason||"Korrektur",sale.total,operator.id,operator.name,now),env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),"SALE_REVERSED","sale",sale.id,operator.id,JSON.stringify({profileId:profile.id,reversalId:id,amount:sale.total,reason:body.reason||"Korrektur"}),now),...allocations.results.map((allocation,index)=>env.DB.prepare("INSERT INTO account_transactions (id,profile_id,member_id,member_name,sale_id,type,amount,note,operator_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(`${id}-${index}`,profile.id,allocation.member_id,allocation.member_name,sale.id,"Storno",-allocation.amount,body.reason||"Korrektur",operator.id,now)),...(rewardSlot?[env.DB.prepare("UPDATE random_reward_slots SET claimed_at=NULL,sale_id=NULL,winner_name=NULL,reward_amount=NULL,reward_label=NULL WHERE id=? AND sale_id=?").bind(rewardSlot.id,sale.id),env.DB.prepare("UPDATE random_reward_campaigns SET remaining_wins=MIN(total_wins,remaining_wins+1) WHERE id=? AND profile_id=?").bind(rewardSlot.campaignId,profile.id)]:[]),...(sponsoredRound?[env.DB.prepare("UPDATE rounds SET active=0,remaining=0 WHERE id=? AND profile_id=?").bind(sponsoredRound.id,profile.id)]:[])];
      await env.DB.batch(statements);await env.BACKUPS.put(`reversals/${profile.id}/${now.slice(0,10)}/${id}.json`,JSON.stringify({profileId:profile.id,id,saleId:sale.id,reason:body.reason,operator,rewardRestored:Boolean(rewardSlot),createdAt:now}));return Response.json({ok:true});
    }
    if(body.action==="payment"){
      const requestedAmount=Number(body.amount);
      if(!body.memberId||!Number.isFinite(requestedAmount)||requestedAmount<=0)return Response.json({error:"Ungültige Zahlung"},{status:400});
      const guestTarget=await env.DB.prepare("SELECT id,name,type FROM guest_accounts WHERE id=? AND profile_id=? AND active=1").bind(body.memberId,profile.id).first<{id:string;name:string;type:"visitor"|"club"}>();
      const clubPayment=guestTarget?.type==="club";
      const balances=clubPayment
        ?await env.DB.prepare("SELECT at.member_id memberId,MAX(at.member_name) memberName,ROUND(SUM(at.amount),2) balance,MIN(at.created_at) openedAt FROM account_transactions at LEFT JOIN guest_accounts ga ON ga.id=at.member_id AND ga.profile_id=at.profile_id WHERE at.profile_id=? AND (at.member_id=? OR ga.parent_id=?) GROUP BY at.member_id HAVING ROUND(SUM(at.amount),2)>0 ORDER BY openedAt,memberName").bind(profile.id,body.memberId,body.memberId).all<{memberId:string;memberName:string;balance:number;openedAt:string}>()
        :await env.DB.prepare("SELECT member_id memberId,MAX(member_name) memberName,ROUND(SUM(amount),2) balance,MIN(created_at) openedAt FROM account_transactions WHERE profile_id=? AND member_id=? GROUP BY member_id HAVING ROUND(SUM(amount),2)>0").bind(profile.id,body.memberId).all<{memberId:string;memberName:string;balance:number;openedAt:string}>();
      const outstanding=Math.round(balances.results.reduce((sum,account)=>sum+Number(account.balance),0)*100)/100;
      const amount=Math.min(requestedAmount,outstanding);
      if(amount<=0)return Response.json({error:"Konto ist bereits ausgeglichen"},{status:409});
      const method=body.paymentMethod==="Bar"?"Bar":"Sonstige",tendered=method==="Bar"?Number(body.tendered??amount):amount;
      if(!Number.isFinite(tendered)||tendered<amount)return Response.json({error:"Erhaltener Betrag ist zu niedrig"},{status:400});
      const id=crypto.randomUUID(),changeDue=Math.round((tendered-amount)*100)/100;
      let remainingPayment=amount;
      const distribution=balances.results.flatMap(account=>{if(remainingPayment<=.001)return[];const paid=Math.min(remainingPayment,Number(account.balance));remainingPayment=Math.round((remainingPayment-paid)*100)/100;return[{memberId:account.memberId,memberName:account.memberName,amount:paid}]});
      await env.DB.batch([
        ...distribution.map((share,index)=>env.DB.prepare("INSERT INTO account_transactions (id,profile_id,member_id,member_name,type,amount,note,operator_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${id}-${index}`,profile.id,share.memberId,share.memberName,"Zahlung",-share.amount,clubPayment?`Zahlung auf Vereinsrechnung ${guestTarget.name}`:`Kontenausgleich ${method}`,operator.id,now)),
        env.DB.prepare("INSERT INTO payments (id,profile_id,member_id,method,amount,tendered,change_due,note,operator_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(`${id}-payment`,profile.id,body.memberId,method,amount,tendered,changeDue,clubPayment?`Vereinsrechnung ${guestTarget.name} bezahlt`:"Offene Rechnung bezahlt",operator.id,now),
        env.DB.prepare("INSERT INTO audit_logs (id,action,entity_type,entity_id,operator_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(`${id}-audit`,"ACCOUNT_PAYMENT",clubPayment?"guest_club_account":"member_account",body.memberId,operator.id,JSON.stringify({profileId:profile.id,amount,method,tendered,changeDue,distribution}),now)
      ]);
      await env.BACKUPS.put(`payments/${profile.id}/${now.slice(0,10)}/${id}.json`,JSON.stringify({profileId:profile.id,id,memberId:body.memberId,memberName:guestTarget?.name||body.memberName,amount,method,tendered,changeDue,distribution,operator,createdAt:now}));
      return Response.json({ok:true,amount,changeDue,remaining:Math.max(0,Math.round((outstanding-amount)*100)/100),distribution});
    }
    return Response.json({error:"Unbekannte Aktion"},{status:400});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Vorgang fehlgeschlagen"},{status:500})}
}
