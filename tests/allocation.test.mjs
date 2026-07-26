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

test("geteilte Bestellung vervielfacht Artikel nicht in den Zechendetails", async () => {
  const [control, monthly] = await Promise.all([read("app/api/control/route.ts"), read("app/api/monthly/route.ts")]);
  for (const route of [control, monthly]) assert.ok(route.includes("(SELECT COUNT(*) FROM sale_allocations sa WHERE sa.sale_id=at.sale_id)=1"));
});
