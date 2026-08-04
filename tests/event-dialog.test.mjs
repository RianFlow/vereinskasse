import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legt Veranstaltungen ohne nicht unterstuetzte Browserdialoge an",async()=>{
  const [page,route,data,schema,migration]=await Promise.all([
    readFile(new URL("../app/page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/api/events/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/api/data/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../db/schema.ts",import.meta.url),"utf8"),
    readFile(new URL("../drizzle/0024_greedy_skreet.sql",import.meta.url),"utf8"),
  ]);
  const start=page.indexOf("function EventAnalytics"),end=page.indexOf("type MonthlyData",start),eventsUi=page.slice(start,end);
  assert.ok(eventsUi.includes("event-admin-dialog"));
  assert.ok(eventsUi.includes("Veranstaltungsname"));
  assert.ok(eventsUi.includes("Artikel für diese Veranstaltung"));
  assert.ok(eventsUi.includes("Alle auswählen"));
  assert.ok(eventsUi.includes("Auswahl leeren"));
  assert.ok(eventsUi.includes("productIds:selectedProductIds"));
  assert.ok(eventsUi.includes("Veranstaltung starten"));
  assert.ok(route.includes("product_ids_json"));
  assert.ok(route.includes("Bitte mindestens einen Artikel"));
  assert.ok(data.includes("Ein Artikel gehört nicht zum Sortiment dieser Veranstaltung"));
  assert.ok(schema.includes('productIdsJson:text("product_ids_json")'));
  assert.ok(migration.includes("ADD `product_ids_json`"));
  assert.ok(!eventsUi.includes("prompt("));
  assert.ok(!eventsUi.includes("confirm("));
});
