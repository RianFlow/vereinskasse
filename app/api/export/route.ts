import { env } from "cloudflare:workers";
import { requireRole } from "../session";
import { requireProfile } from "../profile-session";

const q=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;

export async function GET(request:Request){
  const [admin,profile]=await Promise.all([requireRole(request,["Vorstand","Kassenwart"]),requireProfile(request)]);if(!admin||!profile)return Response.json({error:"Keine Berechtigung"},{status:403});
  const rows=await env.DB.prepare("SELECT s.id,s.time,s.member,s.member_id memberId,s.method,s.items,s.total,e.name eventName,p.tendered,p.change_due changeDue,COALESCE(GROUP_CONCAT(si.quantity || 'x ' || si.product_name, ' | '),'') details FROM sales s LEFT JOIN events e ON e.id=s.event_id LEFT JOIN payments p ON p.sale_id=s.id LEFT JOIN sale_items si ON si.sale_id=s.id WHERE s.profile_id=? GROUP BY s.id ORDER BY s.time DESC").bind(profile.id).all<Record<string,unknown>>();
  const csv=["Buchungs-ID;Zeitpunkt;Veranstaltung;Kassenkraft/Mitglied;Mitglieds-ID;Zahlart;Artikelanzahl;Betrag;Erhalten;Rückgeld;Positionen",...rows.results.map(row=>[row.id,row.time,row.eventName??"",row.member,row.memberId,row.method==="Vertrauensliste"?"Monatsabrechnung":row.method,row.items,Number(row.total).toFixed(2),row.tendered??"",row.changeDue??"",row.details].map(q).join(";"))].join("\r\n");
  return new Response("\ufeff"+csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="vereinskasse-pruefexport-${new Date().toISOString().slice(0,10)}.csv"`,"cache-control":"no-store"}});
}
