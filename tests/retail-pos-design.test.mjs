import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("nutzt einen ruhigen hellen Tablet-Kassenarbeitsplatz mit festem Bon",async()=>{
  const [page,layout,styles]=await Promise.all([read("app/page.tsx"),read("app/layout.tsx"),read("app/retail-pos.css")]);
  assert.ok(page.includes("useState(false)")&&page.includes("vereinskasse-theme-v2"),"Der neue helle Kassenmodus ist nicht der sichere Standard");
  assert.ok(layout.includes('import "./retail-pos.css"'),"Die neue Kassenoberfläche wird nicht geladen");
  for(const fragment of [".app.kiosk-design.light .pos",".app.kiosk-design.light .cart",".app.kiosk-design.light .checkout",".app.kiosk-design.light .pos-total","grid-template-columns:minmax(0,1fr) 238px","@media(max-width:800px)"]){
    assert.ok(styles.includes(fragment),`Wichtiger Tablet-Kassenbaustein fehlt: ${fragment}`);
  }
  assert.ok(styles.includes(".app.kiosk-design.light .pos-total"),"Der reduzierte Kassenmodus zeigt die wichtigste Summe nicht deutlich");
  assert.ok(page.includes("checkout-customer-compact")&&page.includes("Wird zur Monatsabrechnung hinzugefügt."),"Die Kundenzuordnung fehlt im rechten Kassenbereich");
  assert.ok(styles.includes(".catalog>.selected-customer{display:none}")&&styles.includes(".checkout-customer-head"),"Die große Kundenerklärung belegt weiterhin den Artikelbereich");
});

test("hält Bon und Bezahlung in Hoch- und Querformat sichtbar",async()=>{
  const style=await read("app/pos-ergonomics.css");
  for(const feature of [".app.kiosk-design>header","position:sticky","height:calc(100dvh - 64px)","grid-template-rows:minmax(0,55%) minmax(0,45%)",".app.kiosk-design .cart{",".app.kiosk-design .checkout{"])
    assert.ok(style.includes(feature),`${feature} fehlt im dauerhaft sichtbaren Kassenlayout`);
  assert.ok(style.includes("@media(max-width:800px) and (orientation:portrait)"),"Eine eigene Hochkantaufteilung fehlt");
  assert.ok(style.includes("grid-template-rows:minmax(0,42%) minmax(0,58%)"),"Der Bon bekommt im Hochformat nicht genug Platz");
});

test("pinnt Kassenhinweise an und scrollt nur die Artikel",async()=>{
  const [page,ergonomics,retail]=await Promise.all([read("app/page.tsx"),read("app/pos-ergonomics.css"),read("app/retail-pos.css")]);
  assert.ok(page.includes("header-shift-status")&&page.includes("Kasse eröffnen"),"Der geschlossene Kassenstatus fehlt in der Kopfzeile");
  for(const feature of [".catalog>.guest-debt-strip{order:-20",".catalog>.shift-start-strip{display:none}",".catalog>.grid{","overflow-y:auto"])
    assert.ok(ergonomics.includes(feature),`${feature} fehlt im angepinnten Artikelbereich`);
  assert.ok(ergonomics.includes("repeat(3,minmax(0,1fr))")&&retail.includes("repeat(3,minmax(0,1fr))"),"Im Hochformat passen nicht mindestens drei Artikel nebeneinander");
});

test("wählt die Zahlungsart in einem platzsparenden Dialog",async()=>{
  const [page,layout,style]=await Promise.all([read("app/page.tsx"),read("app/layout.tsx"),read("app/payment-choice.css")]);
  for(const fragment of ["PaymentChoiceDialog","Bestellung wirklich abschließen?","SICHERHEITSABFRAGE","Weiter zur Barzahlung","Weiter zum Gastkonto","Weiter zum Aufteilen","Nein, Bestellung weiter bearbeiten"])
    assert.ok(page.includes(fragment),`Zahlungsdialog enthält ${fragment}`);
  assert.ok(layout.includes('import "./payment-choice.css"'),"Layout bindet den Zahlungsdialog ein");
  assert.ok(style.includes(".payment-choice-grid"),"Zahlungsarten sind als große Touch-Auswahl gestaltet");
  assert.ok(style.includes(".checkout-total-button"),"Die einmalig angezeigte Endsumme ist der klare Bezahlknopf");
  assert.equal((page.match(/className="sum pos-total checkout-total-button"/g)||[]).length,1,"Die Kasse darf nur einen Endsumme-/Bezahlknopf zeigen");
});

test("öffnet die Mitgliedsauswahl ohne Bildschirmtastatur",async()=>{
  const page=await read("app/page.tsx");
  const finder=page.slice(page.indexOf("function MemberFinder"),page.indexOf("function MemberSessionDialog"));
  assert.ok(finder.includes('placeholder="Name oder Mitgliedsnummer eingeben"'),"Die Mitgliedersuche fehlt");
  assert.ok(!finder.includes("autoFocus"),"Die Mitgliedsauswahl öffnet weiterhin ungefragt die Bildschirmtastatur");
});

test("gibt der Veranstaltungskasse mehr Platz für Artikel und zeigt ihren Status kompakt",async()=>{
  const [page,layout,style]=await Promise.all([read("app/page.tsx"),read("app/layout.tsx"),read("app/event-pos.css")]);
  assert.ok(page.includes('operationMode==="event"?"event-pos":""'),"Der Veranstaltungskasse fehlt ihr eigenes Layout");
  assert.ok(page.includes("VERANSTALTUNG LÄUFT")&&page.includes("event-live-mark"),"Der kompakte Live-Status fehlt");
  assert.ok(layout.includes('import "./event-pos.css"'),"Das Veranstaltungs-Layout wird nicht geladen");
  for(const feature of [".event-pos .title-row{display:none}","minmax(500px,36vw)","grid-template-columns:minmax(0,1fr) 205px"])
    assert.ok(style.includes(feature),`${feature} fehlt im platzsparenden Veranstaltungs-Layout`);
});

test("hält Vergleichspreise in der Kachel und beschreibt die Artikelposition passend",async()=>{
  const [page,style]=await Promise.all([read("app/page.tsx"),read("app/retail-pos.css")]);
  for(const feature of ["empty-cart-hint-side","empty-cart-hint-stacked","Artikel links antippen","Artikel oben antippen"])
    assert.ok(page.includes(feature),`${feature} fehlt im leeren Bon`);
  for(const feature of [".product .old-price","overflow:hidden",".product:has(.old-price){min-height:142px}",".empty-cart-hint-side{display:none}",".empty-cart-hint-stacked{display:block}"])
    assert.ok(style.includes(feature),`${feature} fehlt in der Hochformatkorrektur`);
});

test("trennt Preisgruppe und Rechnungsbutton in der schmalen Querformatleiste",async()=>{
  const style=await read("app/balance-check.css");
  for(const feature of ["@media(min-width:1200px)",".checkout-info-row{grid-template-columns:minmax(0,1fr)",".quick-balance-button{width:100%;justify-content:center}"])
    assert.ok(style.includes(feature),`${feature} fehlt für die Querformatleiste`);
});
