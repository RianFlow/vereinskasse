import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legt Veranstaltungen ohne nicht unterstuetzte Browserdialoge an",async()=>{
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  const start=page.indexOf("function EventAnalytics"),end=page.indexOf("type MonthlyData",start),eventsUi=page.slice(start,end);
  assert.ok(eventsUi.includes("event-admin-dialog"));
  assert.ok(eventsUi.includes("Veranstaltungsname"));
  assert.ok(eventsUi.includes("Veranstaltung starten"));
  assert.ok(!eventsUi.includes("prompt("));
  assert.ok(!eventsUi.includes("confirm("));
});
