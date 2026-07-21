import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { sales } from "../../../db/schema";

const q=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;
export async function GET(){
  const rows=await getDb().select().from(sales).orderBy(desc(sales.time));
  const csv=["Buchungs-ID;Zeitpunkt;Mitgliedsnummer;Mitglied;Zahlart;Artikel;Betrag",...rows.map(r=>[r.id,r.time,r.memberId,r.member,r.method,r.items,r.total.toFixed(2)].map(q).join(";"))].join("\r\n");
  return new Response("\ufeff"+csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="vereinskasse-export-${new Date().toISOString().slice(0,10)}.csv"`}});
}
