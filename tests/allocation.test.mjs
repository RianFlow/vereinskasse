import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Aufteilung wählt niemals unbemerkt das erste Mitglied", async () => {
  const page = await read("app/page.tsx");
  assert.ok(page.includes("initialMember&&members.some(member=>member.id===initialMember.id)?initialMember:null"));
  assert.ok(!page.includes("members[0]||null"));
});

test("gleichmäßige Aufteilung rechnet centgenau", async () => {
  const page = await read("app/page.tsx");
  assert.ok(page.includes("const base=Math.floor(totalCents/ids.length),remainder=totalCents-base*ids.length"));
  assert.ok(page.includes("differenceCents===0"));
});

test("Server verhindert doppelte und unvollständige Kontobuchungen", async () => {
  const route = await read("app/api/data/route.ts");
  assert.ok(route.includes("new Set(allocationIds).size!==allocationIds.length"));
  assert.ok(route.includes("allocatedCents!==Math.round(body.total*100)"));
});

test("geteilte Bestellung bleibt in Abrechnung und Zechendetails korrekt", async () => {
  const [control, monthly] = await Promise.all([read("app/api/control/route.ts"), read("app/api/monthly/route.ts")]);
  assert.ok(control.includes("(SELECT COUNT(*) FROM sale_allocations sa WHERE sa.sale_id=at.sale_id)=1"),"Die kompakte Kontenansicht darf Artikel nicht je Anteil vervielfachen");
  assert.ok(!monthly.includes("(SELECT COUNT(*) FROM sale_allocations sa WHERE sa.sale_id=at.sale_id)=1"),"Geteilte Artikel werden noch aus der Monatsabrechnung ausgeschlossen");
  for(const feature of ["Geteilte Bestellung","Persönlicher Anteil","Geteilt mit:","allocationsBySale","itemsBySale"])assert.ok(monthly.includes(feature),`${feature} fehlt in der Monatsabrechnung`);
});

test("Aufteilen ist auch ohne vorher ausgewähltes Mitglied erreichbar", async () => {
  const page = await read("app/page.tsx");
  assert.ok(page.includes('className="pay split-pay anonymous-split"'));
  assert.ok(page.includes('onClick={()=>checkout("Mitgliedskonto")}'));
});

test("gemeinsame Buchung bleibt mit Beteiligten, Artikeln und Beleg nachvollziehbar", async () => {
  const [page, control, receipt] = await Promise.all([read("app/page.tsx"), read("app/api/control/route.ts"), read("app/api/receipt/route.ts")]);
  assert.ok(control.includes("splitAllocations"));
  assert.ok(page.includes("Geteilte Einkäufe"));
  assert.ok(page.includes("Geteilt mit"));
  assert.ok(receipt.includes("Aufteilung"));
});

test("Monatsrechnung führt Bestellungen, Zahlungen und Stornos vollständig auf",async()=>{
  const [monthly,receipt]=await Promise.all([read("app/api/monthly/route.ts"),read("app/api/receipt/route.ts")]);
  for(const feature of ["Bestellungen und Artikel","Stornos und Korrekturen","Zahlungen","Rechnung rechnerisch vollständig","ältere Buchung ohne einzelne Positionsdaten"])assert.ok(monthly.includes(feature),`${feature} fehlt`);
  for(const feature of ["Beleg rechnerisch vollständig","Inklusivartikel","Persönliche Anteile","reversalReason"])assert.ok(receipt.includes(feature),`${feature} fehlt im Einzelbeleg`);
});
