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
