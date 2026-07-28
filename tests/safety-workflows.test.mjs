import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("trennt Systemadministration und Kassenwart serverseitig und erlaubt kombinierte Funktionen",async()=>{
  const [page,session,members,control,monthly,backup,data]=await Promise.all([read("app/page.tsx"),read("app/api/session.ts"),read("app/api/members/route.ts"),read("app/api/control/route.ts"),read("app/api/monthly/route.ts"),read("app/api/backup/route.ts"),read("app/api/data/route.ts")]);
  for(const feature of ["Systemadministration","Kassenwart-Zugang","systemOnly","allowedSections","memberRoles","member-role-choices","Hauptadministrator · alle Rechte","MemberRolesDialog"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(session.includes('role.split("+")')&&session.includes("roles.some"),"Kombinierte Funktionen werden nicht serverseitig ausgewertet");
  assert.ok(members.includes('"Vorstand","Kassenwart","Systemadmin"')&&members.includes("canonicalRole")&&members.includes('b.action==="set_roles"')&&members.includes("MEMBER_ROLES_CHANGED"),"Mehrere Funktionen können nicht gespeichert oder geändert werden");
  assert.ok(control.includes('["Mitglied","Kassendienst","Kassenwart","Vorstand"]')&&control.includes("SALE_REVERSED"),"Kassenwart oder Änderungsprotokoll fehlt");
  assert.ok(page.includes("ReversalDialog")&&page.includes("storniert von")&&!page.includes('prompt("Stornogrund")'),"Stornos sind nicht als nachvollziehbares Popup umgesetzt");
  assert.ok(monthly.includes('requireRole(request,["Vorstand","Kassenwart"])'),"Kassenwart darf den Monatsabschluss nicht verwalten");
  assert.ok(!backup.match(/export async function PUT[\s\S]{0,250}Systemadmin/),"Systemadministration darf eine Rücksicherung auslösen");
  assert.ok(data.includes('requireRole(request,["Vorstand","Systemadmin"])'),"Technische Artikelverwaltung fehlt");
});

test("speichert geschützte Zugangscodes nicht im Klartext",async()=>{
  const [access,members,identify]=await Promise.all([read("app/api/member-access.ts"),read("app/api/members/route.ts"),read("app/api/identify/route.ts")]);
  for(const feature of ["PBKDF2","120_000","SHA-256","crypto.getRandomValues","verifyAccessCode"])assert.ok(access.includes(feature),`${feature} fehlt beim Passwortschutz`);
  assert.ok(members.includes("protectAccessCode(code)")&&!members.includes("bind(id,name,code,initials)"),"Ein Zugangscode wird noch direkt gespeichert");
  assert.ok(identify.includes("verifyAccessCode")&&identify.includes("if(legacy)")&&identify.includes("safeMember"),"Alte Codes werden nicht sicher geprüft und aktualisiert");
  for(const feature of ["MEMBER_ACCESS_FAILED","MEMBER_ACCESS_LOGIN","15*60*1000",">=5","shortHash(clientAddress)"])assert.ok(identify.includes(feature),`${feature} fehlt beim Schutz vor Login-Versuchen`);
});

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

test("zeigt in der Kasse nur Störungen und verwaltet Systemdetails im Adminbereich",async()=>{
  const [page,status,style]=await Promise.all([read("app/page.tsx"),read("app/api/status/route.ts"),read("app/openaccounts.css")]),checkout=page.split("function Admin(")[0],admin=page.split("function Admin(")[1];
  assert.ok(checkout.includes("cash-connection-warning")&&checkout.includes("automatisch nachgereicht"),"Die Kasse warnt nicht bei einer echten Verbindungsstörung");
  for(const feature of ["latestBackupAt","Letzte vollständige Sicherung","RFID verbunden"])assert.ok(!checkout.includes(feature),`${feature} gehört nicht auf den Kassenbildschirm`);
  assert.ok(admin.includes("SystemStatus")&&admin.includes("Sicherung"),"Sicherung und Systemzustand fehlen im Adminbereich");
  for(const feature of ["latestBackupAt","rfidLastSeenAt","restoreStatus"])assert.ok(status.includes(feature),`${feature} fehlt`);
  assert.ok(style.includes(".cash-connection-warning"));
});

test("beendet Mitgliedschaften nur mit ausgeglichenem Konto und sperrt Zugänge",async()=>{
  const [members,schema,page]=await Promise.all([read("app/api/members/route.ts"),read("db/schema.ts"),read("app/page.tsx")]);
  for(const feature of ["MEMBER_RETIRED","DELETE FROM rfid_cards","DELETE FROM auth_sessions","privacyReviewAt","Konto hat noch"])assert.ok(members.includes(feature),`${feature} fehlt`);
  assert.ok(schema.includes("memberLifecycle"));
  for(const copy of ["AUSTRITT & DATENSCHUTZ","Austritt sicher abschließen","Buchungen bleiben für Abrechnung und Nachweis erhalten"])assert.ok(page.includes(copy),`${copy} fehlt`);
});

test("jedes aktive Mitglied kann die Kasse direkt per RFID-Chip eröffnen",async()=>{
  const [page,rfid,control]=await Promise.all([read("app/page.tsx"),read("app/RfidIntegration.tsx"),read("app/api/control/route.ts")]);
  for(const copy of ["Kasse noch geschlossen","Mitgliedschip auflegen","RfidShiftLogin","Ohne Anfangsbestand öffnen","Anfangsbestand / Wechselgeld (optional)"])assert.ok(page.includes(copy),`${copy} fehlt`);
  assert.ok(rfid.includes('purpose=shift')&&rfid.includes("Mitglied erkannt"));
  assert.ok(control.includes('body.action==="open"||body.action==="payment"'));
  assert.ok(control.includes("SHIFT_OPENED"));
});

test("rechnet Gastrechnungen direkt in der normalen Kasse ab",async()=>{
  const [page,control]=await Promise.all([read("app/page.tsx"),read("app/api/control/route.ts")]);
  for(const copy of ["GuestAccountsCheckoutDialog","DIREKT IN DER KASSE","Offene Gastrechnungen","Sofort fällig · bar kassieren","Buchungsdetails ansehen"])assert.ok(page.includes(copy),`${copy} fehlt`);
  assert.ok(page.includes('action:"payment"')&&page.includes("Gastrechnung bezahlt"));
  assert.ok(control.includes('body.action==="payment"')&&control.includes("ACCOUNT_PAYMENT"));
});
