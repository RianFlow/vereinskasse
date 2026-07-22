import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("berechnet enthaltene Getraenke nur im Verbrauch",async()=>{
  const [page,data,schema,migration,receipt,monthly]=await Promise.all([
    read("app/page.tsx"),read("app/api/data/route.ts"),read("db/schema.ts"),read("drizzle/0011_same_valeria_richards.sql"),read("app/api/receipt/route.ts"),read("app/api/monthly/route.ts")
  ]);
  for(const feature of ["Im Verkaufspreis enthalten","+ Bestandteil hinzufügen","includedDescription","quantity:item.quantity*cart[parent.id]","unitPrice:0,total:0"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("included_items_json"));
  assert.ok(data.includes("cleanIncludedItems"));
  assert.ok(schema.includes("includedItemsJson"));
  assert.ok(migration.includes("included_items_json"));
  assert.ok(receipt.includes("im Paket enthalten"));
  assert.ok(monthly.includes("im Paket enthalten"));
});

test("Angebotspreis berechnet nur das Angebot und zaehlt die Bestandteile",async()=>{
  const [page,data,schema,migration,events,monthly]=await Promise.all([
    read("app/page.tsx"),read("app/api/data/route.ts"),read("db/schema.ts"),read("drizzle/0012_wide_shinobi_shaw.sql"),read("app/api/events/route.ts"),read("app/api/monthly/route.ts")
  ]);
  for(const feature of ["+ Angebot erstellen","Angebotspreis","includedValue","countsForConsumption:!p.isOffer||!(p.includedItems||[]).length","consumptionItemCount","Ersparnis"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("is_offer"));
  assert.ok(data.includes("counts_for_consumption"));
  assert.ok(schema.includes("countsForConsumption"));
  assert.ok(migration.includes("counts_for_consumption"));
  assert.ok(events.includes("si.counts_for_consumption=1"));
  assert.ok(monthly.includes("si.counts_for_consumption=1"));
});
