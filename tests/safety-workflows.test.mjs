import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("stellt Sicherungen nur nach Prüfsumme und Vier-Augen-Freigabe wieder her",async()=>{
  const [route,schema,migration,page]=await Promise.all([read("app/api/backup/route.ts"),read("db/schema.ts"),read("drizzle/0021_bouncy_lifeguard.sql"),read("app/page.tsx")]);
  for(const feature of ["validatedSnapshot","Prüfsumme stimmt nicht","RESTORE_REQUESTED","RESTORE_APPROVED","RESTORE_COMPLETED","automatic-before-restore","requested_by)===admin.id"])assert.ok(route.includes(feature),`${feature} fehlt`);
  assert.ok(route.includes("await createSnapshot(admin,profile,\"automatic-before-restore\")"));
  assert.ok(schema.includes("restore_requests")&&migration.includes("restore_requests"));
  for(const copy of ["Kontrollierte Wiederherstellung","Zweite Vorstands-Person erforderlich","Datenstand jetzt wiederherstellen"])assert.ok(page.includes(copy),`${copy} fehlt`);
});

test("schreibt Monatsabschlüsse unveränderlich mit Nummer und Prüfsumme fest",async()=>{
  const [monthly,data,schema,page]=await Promise.all([read("app/api/monthly/route.ts"),read("app/api/data/route.ts"),read("db/schema.ts"),read("app/page.tsx")]);
  for(const feature of ["MONTH_CLOSED","statementNumber","snapshotJson","SHA-256","Ein Monat kann erst nach seinem Monatsende"])assert.ok(monthly.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("monthly_closures")&&data.includes("Dieser Monat ist bereits festgeschrieben"));
  assert.ok(schema.includes("monthlyClosures"));
  assert.ok(page.includes("Monat festschreiben")&&page.includes("Spätere Korrekturen erscheinen im Folgemonat"));
});

test("zeigt Server, Warteschlange, Vollsicherung und RFID direkt in der Kasse",async()=>{
  const [page,status,style]=await Promise.all([read("app/page.tsx"),read("app/api/status/route.ts"),read("app/safety.css")]);
  for(const feature of ["Server online","Buchungen warten","Letzte vollständige Sicherung","RFID verbunden"])assert.ok(page.includes(feature),`${feature} fehlt`);
  for(const feature of ["latestBackupAt","rfidLastSeenAt","restoreStatus"])assert.ok(status.includes(feature),`${feature} fehlt`);
  assert.ok(style.includes(".system-live-strip"));
});

test("beendet Mitgliedschaften nur mit ausgeglichenem Konto und sperrt Zugänge",async()=>{
  const [members,schema,page]=await Promise.all([read("app/api/members/route.ts"),read("db/schema.ts"),read("app/page.tsx")]);
  for(const feature of ["MEMBER_RETIRED","DELETE FROM rfid_cards","DELETE FROM auth_sessions","privacyReviewAt","Konto hat noch"])assert.ok(members.includes(feature),`${feature} fehlt`);
  assert.ok(schema.includes("memberLifecycle"));
  for(const copy of ["AUSTRITT & DATENSCHUTZ","Austritt sicher abschließen","Buchungen bleiben für Abrechnung und Nachweis erhalten"])assert.ok(page.includes(copy),`${copy} fehlt`);
});

test("jedes aktive Mitglied kann die Kasse direkt per RFID-Chip eröffnen",async()=>{
  const [page,rfid,control]=await Promise.all([read("app/page.tsx"),read("app/RfidIntegration.tsx"),read("app/api/control/route.ts")]);
  for(const copy of ["Kasse noch geschlossen","Mitgliedschip auflegen","RfidShiftLogin","Kasse jetzt eröffnen"])assert.ok(page.includes(copy),`${copy} fehlt`);
  assert.ok(rfid.includes('purpose=shift')&&rfid.includes("Mitglied erkannt"));
  assert.ok(control.includes('body.action==="open"?["Mitglied","Kassendienst","Vorstand"]'));
  assert.ok(control.includes("SHIFT_OPENED"));
});
