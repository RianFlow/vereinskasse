import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("schützt Updates mit Migrationen und automatischen Prüfungen",async()=>{
  const [workflow,checker,packageFile,migration,readme]=await Promise.all([read(".github/workflows/ci.yml"),read("scripts/check-migrations.mjs"),read("package.json"),read("drizzle/0013_concerned_mockingbird.sql"),read("README.md")]);
  assert.ok(workflow.includes("npm run lint"));
  assert.ok(workflow.includes("npm test"));
  assert.ok(packageFile.includes("check:migrations"));
  assert.ok(checker.includes("destructive-reviewed"));
  assert.ok(migration.includes("sales_profile_time_idx"));
  assert.ok(readme.includes("Sicherer Updateablauf"));
});

test("erstellt prüfbare und herunterladbare Vollsicherungen",async()=>{
  const [backup,page,data]=await Promise.all([read("app/api/backup/route.ts"),read("app/page.tsx"),read("app/api/data/route.ts")]);
  for(const feature of ["SHA-256","customMetadata","x-backup-sha256","FULL_BACKUP_CREATED","formatVersion","downloadUrl"])assert.ok(backup.includes(feature),`${feature} fehlt`);
  for(const feature of ["SystemStatus","Jetzt vollständig sichern","Sicherung herunterladen","Automatische Prüfungen"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("configuration-before-change"));
  assert.ok(data.includes("saleAllocations.profileId"));
  assert.ok(data.includes("roundClaims.profileId"));
});

test("erstellt eine einfache Liste aus Name und offenem Betrag",async()=>{
  const [page,monthly,style]=await Promise.all([read("app/page.tsx"),read("app/api/monthly/route.ts"),read("app/openlist.css")]);
  for(const feature of ["Einfache Zechenliste","Liste kopieren","Liste drucken","copyOpenList","openPeople"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(monthly.includes('url.searchParams.get("list")==="1"'));
  assert.ok(monthly.includes("Offener Betrag"));
  assert.ok(style.includes(".open-list-rows"));
});

test("nimmt die letzte Buchung sicher und nachvollziehbar zurück",async()=>{
  const [page,data,style]=await Promise.all([read("app/page.tsx"),read("app/api/data/route.ts"),read("app/undo.css")]);
  for(const feature of ["Rückgängig","undoLastSale","vereinskasse-pending-","undoToken","Buchung zurückgenommen"])assert.ok(page.includes(feature),`${feature} fehlt`);
  for(const feature of ["export async function PATCH","Sofort rückgängig","SALE_UNDONE","Date.now()-created>30000","round_claims","reversals/"])assert.ok(data.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("-Number(allocation.amount)"),"Gegenbuchung für offene Konten fehlt");
  assert.ok(style.includes("animation:undo-window 10s"));
});

test("stellt vergessene Profil-PINs im 2-aus-3-Verfahren wieder her",async()=>{
  const [page,recovery,profiles,helper,schema,migration,backup]=await Promise.all([read("app/page.tsx"),read("app/api/profile-recovery/route.ts"),read("app/api/profiles/route.ts"),read("app/api/profile-session.ts"),read("db/schema.ts"),read("drizzle/0015_wet_raider.sql"),read("app/api/backup/route.ts")]);
  for(const feature of ["2 aus 3","PIN vergessen?","Karten erneuern","Drei Notfallkarten","müssen drei neue Karten erzeugt werden"])assert.ok(page.includes(feature),`${feature} fehlt`);
  for(const feature of ["PROFILE_PIN_RECOVERED","PROFILE_RECOVERY_CARDS_ISSUED","used_at IS NULL","newCardsRequired:true","15 Minuten"])assert.ok(recovery.includes(feature),`${feature} fehlt`);
  assert.ok(recovery.includes('new Set(slots).size!==2'),"Zwei unterschiedliche Karten werden nicht erzwungen");
  assert.ok(recovery.includes('UPDATE profile_recovery_keys SET used_at=?'),"Benutzte Karten werden nicht entwertet");
  assert.ok(profiles.includes("recoveryCards")&&profiles.includes('recoveryScheme:"2-of-3"'));
  assert.ok(helper.includes("PBKDF2")&&helper.includes("randomRecoveryCard"));
  assert.ok(schema.includes("profileRecoveryKeys")&&migration.includes("profile_recovery_keys"));
  assert.ok(backup.includes("SCHEMA_VERSION=15")&&backup.includes('"profile_recovery_keys"'));
});

test("teilt den Adminbereich in übersichtliche Tablet-Bereiche",async()=>{
  const [page,style]=await Promise.all([read("app/page.tsx"),read("app/admin-sections.css")]);
  for(const feature of ["admin-section-nav","adminSection","Übersicht","Artikel & Preise","Veranstaltungen","Abrechnung","Mitglieder","Sicherheit & Profile","SCHNELLZUGRIFF"])assert.ok(page.includes(feature),`${feature} fehlt`);
  for(const section of ['adminSection==="overview"','adminSection==="products"','adminSection==="events"','adminSection==="billing"','adminSection==="members"','adminSection==="security"'])assert.ok(page.includes(section),`${section} fehlt`);
  assert.ok(style.includes("position:sticky"));
  assert.ok(style.includes("overflow-x:auto"));
});

test("ist als Vollbild-Web-App auf Tablets installierbar",async()=>{
  const [manifestText,layout,icon192,icon512]=await Promise.all([read("public/manifest.webmanifest"),read("app/layout.tsx"),readFile(new URL("../public/app-icon-192.png",import.meta.url)),readFile(new URL("../public/app-icon-512.png",import.meta.url))]);
  const manifest=JSON.parse(manifestText);
  assert.equal(manifest.name,"Vereinskasse · SV Barver Darts");
  assert.equal(manifest.short_name,"Vereinskasse");
  assert.equal(manifest.start_url,"/");
  assert.equal(manifest.display,"standalone");
  assert.equal(manifest.prefer_related_applications,false);
  assert.ok(manifest.icons.some(icon=>icon.sizes==="192x192"&&icon.src==="/app-icon-192.png"));
  assert.ok(manifest.icons.some(icon=>icon.sizes==="512x512"&&icon.src==="/app-icon-512.png"));
  assert.deepEqual([icon192.readUInt32BE(16),icon192.readUInt32BE(20)],[192,192]);
  assert.deepEqual([icon512.readUInt32BE(16),icon512.readUInt32BE(20)],[512,512]);
  for(const feature of ["manifest.webmanifest","appleWebApp","apple-touch-icon.png","viewportFit"])assert.ok(layout.includes(feature),`${feature} fehlt`);
});

test("startet nach jeder manuellen Buchung ohne den vorherigen Namen",async()=>{
  const page=await read("app/page.tsx");
  assert.ok(page.includes("const billingMember=listMember||activeMember"),"Angemeldete Sitzung und manuelle Auswahl sind nicht getrennt");
  assert.ok(page.includes("setCart({});setListMember(null);showUndo"),"Manuell gewähltes Mitglied bleibt nach der Buchung ausgewählt");
  assert.ok(page.includes("setSelectedGuest(null);setListMember(null)"),"Gast oder Mitglied bleibt nach einem anderen Abschluss ausgewählt");
});

test("verwendet tabletfreundliche Zahlenfelder mit großen Schritten und Zifferntastatur",async()=>{
  const [page,pricing,field,style]=await Promise.all([read("app/page.tsx"),read("app/PricingPanel.tsx"),read("app/TabletNumberField.tsx"),read("app/tablet-number.css")]);
  for(const feature of ["Getränke oder Artikel","Maximum pro Mitglied","Preis ${p.name}","Gezählter Barbestand","Hälfte"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(pricing.includes("TabletNumberField")&&pricing.includes("Mitgliedspreis")&&pricing.includes("Rabatt"));
  for(const feature of ["inputMode","verringern","erhöhen","allowEmpty","event.currentTarget.select"])assert.ok(field.includes(feature),`${feature} fehlt`);
  assert.ok(style.includes("grid-template-columns:44px")&&style.includes("touch-action:manipulation"));
  assert.ok(!page.includes('type="number"'),"Kleine Browser-Zahlenfelder sind noch vorhanden");
});
