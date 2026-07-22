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
  assert.ok(data.includes("profile.id"),"Profildaten werden nicht serverseitig begrenzt");
  assert.ok(!data.includes("allocations:await db.select()"),"Ungenutzte historische Aufteilungen werden noch vollständig ausgeliefert");
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
  assert.ok(backup.includes("SCHEMA_VERSION=16")&&backup.includes('"profile_recovery_keys"'));
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
  assert.ok(page.includes("setMemberPricing(true);setListMember(null);showUndo"),"Manuell gewähltes Mitglied bleibt nach der Buchung ausgewählt");
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

test("zeigt Bestellung, Summe und häufige Bezahlarten wie eine direkte Kasse",async()=>{
  const [page,style]=await Promise.all([read("app/page.tsx"),read("app/direct-checkout.css")]);
  for(const feature of ["AKTUELLER BON","ZU ZAHLEN","DIREKT ANSCHREIBEN","Bar zahlen","Aufteilen","Tageskonto"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes('setOperator(activeMember)'),"Angemeldeter Kassendienst kann nicht direkt fortfahren");
  assert.ok(!page.includes("Weitere Aktionen"),"Häufige Bezahlarten sind noch versteckt");
  for(const feature of ["direct-payment-grid","pos-total","position:sticky","min-height:78px"])assert.ok(style.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("Betrag aufteilen")&&page.includes("club-payments"),"Betrag aufteilen fehlt beim Vereinsabend");
});

test("nutzt standardmäßig Mitgliedspreise und bietet Nichtmitglied erst beim Bezahlen an",async()=>{
  const [page,style]=await Promise.all([read("app/page.tsx"),read("app/price-mode.css")]);
  assert.ok(page.includes("[memberPricing,setMemberPricing]=useState(true)"),"Mitgliedspreis ist nicht der Standard");
  for(const feature of ["price-mode-switch","Mitgliedspreise","Nichtmitglied","Normalpreise"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("setCart({});setMemberPricing(true)"),"Preisart wird nach einer Buchung nicht zurückgesetzt");
  assert.ok(style.includes(".price-mode-switch")&&style.includes("active.non-member"));
});

test("priorisiert offene Nichtmitglieder und markiert Mitgliedskonten nach einem Monat",async()=>{
  const [page,style,layout]=await Promise.all([read("app/page.tsx"),read("app/account-urgency.css"),read("app/layout.tsx")]);
  for(const feature of ["AccountUrgency","accountOpenSince","Nichtmitglied · bitte zeitnah abrechnen","seit über 1 Monat offen","fällig bis","has-guest-debt","sortedAccounts"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("30*24*60*60*1000"),"Monatsfrist fehlt");
  for(const feature of [".account-overview.has-guest-debt",".open-account-list>button.guest",".accounts-panel>div.overdue",".account-payment-status"])assert.ok(style.includes(feature),`${feature} fehlt`);
  assert.ok(layout.includes('import "./account-urgency.css"'));
});

test("verteilt geheime Glücksmomente nur über den Adminbereich",async()=>{
  const [page,panel,route,data,control,schema,migration,backup,receipt]=await Promise.all([read("app/page.tsx"),read("app/RandomRewardsPanel.tsx"),read("app/api/random-rewards/route.ts"),read("app/api/data/route.ts"),read("app/api/control/route.ts"),read("db/schema.ts"),read("drizzle/0016_tricky_jetstream.sql"),read("app/api/backup/route.ts"),read("app/api/receipt/route.ts")]);
  for(const feature of ['adminSection==="rewards"',"RandomRewardsPanel","RewardWinDialog","Heute geht etwas aufs Haus"])assert.ok(page.includes(feature),`${feature} fehlt`);
  for(const feature of ["Ein Artikel gratis","Besonderer Rabatt","Zukünftige Gewinnzeitpunkte","Manipulationsgeschützt","Anzahl der Gewinne"])assert.ok(panel.includes(feature),`${feature} fehlt`);
  assert.ok(route.includes('requireRole(request,["Vorstand"])'),"Aktionen sind nicht auf den Vorstand beschränkt");
  assert.ok(route.includes("crypto.getRandomValues")&&route.includes("windowStart"),"Gewinnmomente werden nicht sicher verteilt");
  assert.ok(!route.includes("triggerAt:campaign"),"Zukünftige Gewinnzeitpunkte dürfen nicht ausgegeben werden");
  for(const feature of ["random_reward_slots","reward_amount","remaining_wins","rewardRestored"])assert.ok(data.includes(feature)||control.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("finalTotal")&&data.includes("adjustedAllocations"),"Gewinn wird nicht sauber auf Endbetrag und Zechen verteilt");
  assert.ok(schema.includes("randomRewardCampaigns")&&schema.includes("randomRewardSlots"));
  assert.ok(migration.includes("random_reward_campaigns")&&migration.includes("random_reward_slots"));
  assert.ok(backup.includes("SCHEMA_VERSION=16")&&backup.includes('"random_reward_campaigns"')&&backup.includes('"random_reward_slots"'));
  assert.ok(receipt.includes("rr.reward_amount")&&receipt.includes("rewardRow"),"Gewinn fehlt auf dem Beleg");
});

test("berechnet Preise, Pakete und Glücksrabatte serverseitig",async()=>{
  const [data,page]=await Promise.all([read("app/api/data/route.ts"),read("app/page.tsx")]);
  for(const feature of ["canonicalCart","member_price","discount_rules","included_items_json","Die Aufteilung stimmt nicht","expectedTotal"])assert.ok(data.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("body.total*Number(candidate.rewardValue)/100"),"Prozentgewinn wird nicht korrekt durch 100 geteilt");
  assert.ok(page.includes('priceMode:memberPricing?"member":"non_member"'),"Preisart wird nicht an den Server übergeben");
});

test("entfernt öffentliche Demo-Zugänge und richtet einmalig einen echten Admin ein",async()=>{
  const [page,data,identify,membersRoute]=await Promise.all([read("app/page.tsx"),read("app/api/data/route.ts"),read("app/api/identify/route.ts"),read("app/api/members/route.ts")]);
  assert.ok(!page.includes("Passende Demo-Kennung verwenden"));
  assert.ok(!data.includes("const seedMembers"));
  assert.ok(identify.includes("id NOT IN ('M-1042'"));
  assert.ok(membersRoute.includes('b.action==="bootstrap"')&&membersRoute.includes("PRIMARY_ADMIN_CREATED"));
});

test("schützt Offline-Buchungen, Rundeneinlösung und Kassenabschluss",async()=>{
  const [page,data,rounds,control]=await Promise.all([read("app/page.tsx"),read("app/api/data/route.ts"),read("app/api/rounds/route.ts"),read("app/api/control/route.ts")]);
  assert.ok(page.includes("offlineQueuedAt")&&data.includes("rewardEligible"),"Offline-Verkäufe können noch unsichtbar Gewinne auslösen");
  assert.ok(rounds.includes("env.DB.batch")&&rounds.includes("claimed_at=?"),"Rundeneinlösung ist nicht atomar geschützt");
  assert.ok(control.includes("sale_id IS NULL")&&control.includes("accountCash"),"Bar bezahlte Zechen fehlen im Kassenabschluss");
  assert.ok(page.includes("submittingRef.current"),"Doppeltipp-Schutz beim Verkauf fehlt");
});
