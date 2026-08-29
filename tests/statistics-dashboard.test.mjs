import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route=readFileSync(new URL("../app/api/statistics/route.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const panel=readFileSync(new URL("../app/StatisticsPanel.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/statistics.css",import.meta.url),"utf8");

test("Statistiken sind profilbezogen und nur für Finanzrollen sichtbar",()=>{
  assert.match(route,/requireRole\(request,\["Vorstand","Kassenwart"\]\)/);
  assert.match(route,/requireProfile\(request\)/);
  assert.match(route,/s\.profile_id=\?/);
  assert.match(page,/isCashManager\?\["overview","statistics","events","billing"\]/);
});

test("Stornos und reine Paketbestandteile verfälschen die Ranglisten nicht",()=>{
  assert.match(route,/LEFT JOIN reversals/);
  assert.match(route,/r\.id IS NULL/);
  assert.match(route,/si\.counts_for_consumption=1/);
  assert.match(route,/sale_allocations/);
  assert.match(route,/item\.quantity\*Math\.max\(0,allocation\.amount\)\/allocationTotal/);
});

test("Zeitraum und ewige Mitglieder-Rangliste sind auswählbar",()=>{
  assert.match(route,/rankingMode=url\.searchParams\.get\("ranking"\)==="all"/);
  assert.match(panel,/Ewige Rangliste/);
  assert.match(panel,/Alle Artikel/);
  assert.match(panel,/kein Nachweis darüber, wer etwas tatsächlich getrunken hat/);
});

test("Dashboard bleibt auf Tablets responsiv",()=>{
  assert.match(page,/adminSection==="statistics"&&<StatisticsPanel\/>/);
  assert.match(css,/\.statistics-kpis/);
  assert.match(css,/@media\(max-width:1050px\)/);
  assert.match(css,/@media\(max-width:700px\)/);
});
