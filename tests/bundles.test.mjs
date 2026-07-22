import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("berechnet enthaltene Getraenke nur im Verbrauch",async()=>{
  const [page,data,schema,migration,receipt,monthly]=await Promise.all([
    read("app/page.tsx"),read("app/api/data/route.ts"),read("db/schema.ts"),read("drizzle/0011_same_valeria_richards.sql"),read("app/api/receipt/route.ts"),read("app/api/monthly/route.ts")
  ]);
  for(const feature of ["Im Verkaufspreis enthalten","Enthaltenes Getränk / Artikel","includedDescription","quantity:item.quantity*cart[parent.id]","unitPrice:0,total:0"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("included_items_json"));
  assert.ok(data.includes("cleanIncludedItems"));
  assert.ok(schema.includes("includedItemsJson"));
  assert.ok(migration.includes("included_items_json"));
  assert.ok(receipt.includes("im Paket enthalten"));
  assert.ok(monthly.includes("im Paket enthalten"));
});
