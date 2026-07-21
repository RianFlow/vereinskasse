import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { saleAllocations, sales } from "../../../db/schema";

const q=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;
export async function GET(){
  const rows=await getDb().select().from(sales).orderBy(desc(sales.time));
  const allocations=await getDb().select().from(saleAllocations); const bySale=new Map<string,string[]>(); allocations.forEach(a=>bySale.set(a.saleId,[...(bySale.get(a.saleId)||[]),`${a.memberName} (${a.amount.toFixed(2)} €${a.kind==="runde"?", Runde":""})`]));
  const csv=["Buchungs-ID;Zeitpunkt;Kassenkraft;Zahlart;Artikel;Betrag;Aufteilung",...rows.map(r=>[r.id,r.time,`${r.member} (${r.memberId})`,r.method,r.items,r.total.toFixed(2),(bySale.get(r.id)||[]).join(" | ")].map(q).join(";"))].join("\r\n");
  return new Response("\ufeff"+csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="vereinskasse-export-${new Date().toISOString().slice(0,10)}.csv"`}});
}
