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
  assert.ok(backup.includes("SCHEMA_VERSION=17")&&backup.includes('"profile_recovery_keys"'));
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
  assert.equal(manifest.display,"fullscreen");
  assert.deepEqual(manifest.display_override,["fullscreen","standalone","minimal-ui"]);
  assert.equal(manifest.prefer_related_applications,false);
  assert.ok(manifest.icons.some(icon=>icon.sizes==="192x192"&&icon.src==="/app-icon-192.png"));
  assert.ok(manifest.icons.some(icon=>icon.sizes==="512x512"&&icon.src==="/app-icon-512.png"));
  assert.deepEqual([icon192.readUInt32BE(16),icon192.readUInt32BE(20)],[192,192]);
  assert.deepEqual([icon512.readUInt32BE(16),icon512.readUInt32BE(20)],[512,512]);
  for(const feature of ["manifest.webmanifest","appleWebApp","apple-touch-icon.png","viewportFit"])assert.ok(layout.includes(feature),`${feature} fehlt`);
  const page=await read("app/page.tsx");
  for(const feature of ["requestFullscreen","beforeinstallprompt","wakeLock","KioskHelpDialog","Vereinskasse als App öffnen","IconMaximize"])assert.ok(page.includes(feature),`${feature} fehlt`);
});

test("startet nach jeder manuellen Buchung ohne den vorherigen Namen",async()=>{
  const page=await read("app/page.tsx");
  assert.ok(page.includes("const billingMember=listMember||activeMember"),"Angemeldete Sitzung und manuelle Auswahl sind nicht getrennt");
  assert.ok(page.includes("setMemberPricing(true);setListMember(null);showUndo"),"Manuell gewähltes Mitglied bleibt nach der Buchung ausgewählt");
  assert.ok(page.includes("setSelectedGuest(null);setListMember(null)"),"Gast oder Mitglied bleibt nach einem anderen Abschluss ausgewählt");
});

test("verwendet tabletfreundliche Zahlenfelder mit großen Schritten und Zifferntastatur",async()=>{
  const [page,manager,pricing,field,style]=await Promise.all([read("app/page.tsx"),read("app/ProductManager.tsx"),read("app/PricingPanel.tsx"),read("app/TabletNumberField.tsx"),read("app/tablet-number.css")]);
  for(const feature of ["Getränke oder Artikel","Maximum pro Mitglied","Gezählter Barbestand","Hälfte"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(manager.includes("Preis ${selected.name}"),"Tabletfreundliches Preisfeld fehlt in der Artikelverwaltung");
  assert.ok(pricing.includes("TabletNumberField")&&pricing.includes("Mitgliedspreis")&&pricing.includes("Rabatt"));
  for(const feature of ["inputMode","verringern","erhöhen","allowEmpty","event.currentTarget.select"])assert.ok(field.includes(feature),`${feature} fehlt`);
  assert.ok(style.includes("grid-template-columns:44px")&&style.includes("touch-action:manipulation"));
  assert.ok(!page.includes('type="number"'),"Kleine Browser-Zahlenfelder sind noch vorhanden");
});

test("zeigt Bestellung, Summe und häufige Bezahlarten wie eine direkte Kasse",async()=>{
  const [page,style]=await Promise.all([read("app/page.tsx"),read("app/direct-checkout.css")]);
  for(const feature of ["AKTUELLER BON","ZU ZAHLEN","DIREKT ANSCHREIBEN","Bar zahlen","Aufteilen","Tageskonto"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes('setOperator(activeMember||billingMember||'),"Kassendienst kann nicht ohne zusätzliche Anmeldung fortfahren");
  assert.ok(!page.includes("authorizeCheckout"),"Die alte Kassenberechtigung wird noch abgefragt");
  assert.ok(!page.includes("Weitere Aktionen"),"Häufige Bezahlarten sind noch versteckt");
  for(const feature of ["direct-payment-grid","pos-total","position:sticky","min-height:78px"])assert.ok(style.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("Betrag aufteilen")&&page.includes("club-payments"),"Betrag aufteilen fehlt beim Vereinsabend");
});

test("legt Mitglieder schlank an und schützt nur Vorstand oder Admin",async()=>{
  const [page,route,data,style]=await Promise.all([read("app/page.tsx"),read("app/api/members/route.ts"),read("app/api/data/route.ts"),read("app/members.css")]);
  for(const feature of ["MemberCreateDialog","Vorname","Nachname","Vorstand / Admin","Kein Passwort nötig","MemberAccessDialog","Sicheren Code vorschlagen","Später einrichten","Kassendienst darf jeder machen"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(!page.includes('prompt("Vor- und Nachname")'),"Mitglieder werden noch über unübersichtliche Eingabefenster angelegt");
  for(const feature of ["firstName","lastName","NOLOGIN-","set_access","MEMBER_ACCESS_SET","hasAccess"])assert.ok(route.includes(feature),`${feature} fehlt in der Mitgliederverwaltung`);
  assert.ok(data.includes('!m.code.startsWith("NOLOGIN-")'),"Zugangsstatus fehlt beim Laden");
  assert.ok(data.includes('body.method==="Vertrauensliste"&&!trusted'),"Vertrauensbuchungen werden serverseitig nicht geprüft");
  assert.ok(!data.includes('["Kassendienst","Vorstand"].includes(session.role)'),"Der Server beschränkt die normale Kasse noch auf alte Rollen");
  for(const feature of [".member-name-fields",".member-row-actions",".cashier-for-everyone"])assert.ok(style.includes(feature),`${feature} fehlt im Mitgliederlayout`);
});

test("bietet einen dunklen Kassenstil mit großen Kacheln und orangem Fokus",async()=>{
  const [page,manager,layout,style,managerStyle,responsive,icons,packageFile]=await Promise.all([read("app/page.tsx"),read("app/ProductManager.tsx"),read("app/layout.tsx"),read("app/kiosk-design.css"),read("app/product-manager.css"),read("app/responsive-layout.css"),read("app/ProductIcon.tsx"),read("package.json")]);
  for(const feature of ["kiosk-design","screen-title","Hauptmenü"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(layout.includes('import "./kiosk-design.css"'));
  for(const feature of ["--kiosk-orange:#ff9800","admin-section-nav","min-height:138px","product","pos-total","@media(min-width:1200px)","grid-template-columns:minmax(0,1fr) 225px","grid-row:1/3"])assert.ok(style.includes(feature),`${feature} fehlt`);
  for(const feature of ["productIconOptions","IconBeer","IconTargetArrow","IconBallFootball","IconGlassCocktail"])assert.ok(icons.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("<ProductManager")&&manager.includes("product-icon-picker")&&manager.includes("<ProductIcon"));
  for(const feature of ["brand-label-input","Marke / Kategorie"])assert.ok(manager.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("product-label"),"Kategorien fehlen auf den Verkaufskacheln");
  for(const feature of ["product-workspace","product-master","product-detail"])assert.ok(managerStyle.includes(feature),`${feature} fehlt im Artikelmanager`);
  assert.ok(layout.includes('import "./responsive-layout.css"'));
  for(const feature of ["grid-template-columns:minmax(0,1fr) minmax(300px,330px)",".anonymous-checkout",".screen-title","overflow-x:hidden","@media(max-width:1700px)"])assert.ok(responsive.includes(feature),`${feature} fehlt im responsiven Kassenlayout`);
  assert.ok(packageFile.includes("@tabler/icons-react"));
});

test("nutzt standardmäßig Mitgliedspreise und bietet Nichtmitglied erst beim Bezahlen an",async()=>{
  const [page,style]=await Promise.all([read("app/page.tsx"),read("app/price-mode.css")]);
  assert.ok(page.includes("[memberPricing,setMemberPricing]=useState(true)"),"Mitgliedspreis ist nicht der Standard");
  for(const feature of ["price-mode-switch","Mitgliedspreise","Nichtmitglied","Normalpreise"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("setCart({});setMemberPricing(true)"),"Preisart wird nach einer Buchung nicht zurückgesetzt");
  assert.ok(style.includes(".price-mode-switch")&&style.includes("active.non-member"));
});

test("rechnet Mitglieder zum Monatsende ab und markiert sie erst nach dem 10. als überfällig",async()=>{
  const [page,style,layout,kioskStyle]=await Promise.all([read("app/page.tsx"),read("app/account-urgency.css"),read("app/layout.tsx"),read("app/kiosk-design.css")]);
  for(const feature of ["AccountUrgency","accountOpenSince","memberDueDate","Nichtmitglied · bitte zeitnah abrechnen","Abrechnung zum Monatsende","zahlbar bis 10. des Folgemonats","sortedAccounts"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes("booking.getMonth()+1,10,23,59,59,999"),"Fälligkeit zum 10. des Folgemonats fehlt");
  assert.ok(!page.includes("30*24*60*60*1000"),"Alte rollierende 30-Tage-Frist ist noch aktiv");
  assert.ok(page.includes("guestOpenAccounts")&&page.includes("guest-debt-strip"),"Schmaler Gastrechnungsstreifen fehlt");
  assert.ok(page.includes("data={guestOpenAccounts}"),"Der Hinweis öffnet nicht ausschließlich Gastkonten");
  assert.ok(!page.includes("overdueMemberAccounts"),"Mitgliedskonten werden noch im Startseitenhinweis geführt");
  for(const feature of [".open-account-list>button.guest",".accounts-panel>div.overdue",".account-payment-status"])assert.ok(style.includes(feature),`${feature} fehlt`);
  assert.ok(kioskStyle.includes(".guest-debt-strip")&&kioskStyle.includes("min-height:42px"),"Der Hinweis ist nicht als schmaler Streifen gestaltet");
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
  assert.ok(backup.includes("SCHEMA_VERSION=17")&&backup.includes('"random_reward_campaigns"')&&backup.includes('"random_reward_slots"'));
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

test("erklärt den Hauptadmin-Zugang verständlich und startet mit dem Admin-Code",async()=>{
  const [page,style,identify]=await Promise.all([read("app/page.tsx"),read("app/identity.css"),read("app/api/identify/route.ts")]);
  for(const feature of ["Admin-Zugang einrichten","Profil-PIN","Admin-Code","Wer meldet sich an?","Person wechseln","Adminbereich öffnen","Stattdessen NFC oder QR verwenden"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(page.includes('useState<"nfc"|"qr"|"manual">(adminLogin?"manual":"nfc")'));
  assert.ok(page.includes("selectedAdminId")&&page.includes("availableAdmins"));
  assert.ok(identify.includes("memberId")&&identify.includes("Admin-Code passt nicht zum ausgewählten Namen"));
  assert.ok(!page.includes("Geheime Karten-/QR-Kennung"));
  assert.ok(style.includes(".admin-code-login")&&style.includes(".access-explainer")&&style.includes(".admin-person-picker"));
});

test("schützt Offline-Buchungen, Rundeneinlösung und Kassenabschluss",async()=>{
  const [page,data,rounds,control]=await Promise.all([read("app/page.tsx"),read("app/api/data/route.ts"),read("app/api/rounds/route.ts"),read("app/api/control/route.ts")]);
  assert.ok(page.includes("offlineQueuedAt")&&data.includes("rewardEligible"),"Offline-Verkäufe können noch unsichtbar Gewinne auslösen");
  assert.ok(rounds.includes("env.DB.batch")&&rounds.includes("claimed_at=?"),"Rundeneinlösung ist nicht atomar geschützt");
  assert.ok(control.includes("sale_id IS NULL")&&control.includes("accountCash"),"Bar bezahlte Zechen fehlen im Kassenabschluss");
  assert.ok(page.includes("submittingRef.current"),"Doppeltipp-Schutz beim Verkauf fehlt");
});
