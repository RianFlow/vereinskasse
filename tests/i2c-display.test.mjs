import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("bereitet das I2C-Kundendisplay mit Bon und Vereinslogo vor",async()=>{
  const [page,display,commands,firmware,config,pio,schema,migration,backup]=await Promise.all([
    read("app/page.tsx"),
    read("app/api/rfid/display/route.ts"),
    read("app/api/rfid/commands/route.ts"),
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),
    read("hardware/NodeMCU-V3-RC522-Tablet/platformio.ini"),
    read("db/schema.ts"),
    read("drizzle/0019_adorable_dexter_bennett.sql"),
    read("app/api/backup/route.ts")
  ]);
  assert.ok(page.includes('fetch("/api/rfid/display"'));
  assert.ok(page.includes('state:displayActive?"cart":"idle"')&&page.includes("if(displayActive)heartbeat"),"Ein ausgewählter Kunde bleibt nicht auf dem Display");
  assert.ok(page.includes("Vorgang abbrechen")&&page.includes("cancelCheckout"),"Der Displayinhalt kann nicht eindeutig abgebrochen werden");
  for(const feature of ["itemCount","totalCents","customerName","itemsText"])assert.ok(display.includes(feature));
  assert.ok(commands.includes('action:"display"')&&commands.includes("x-display-revision")&&commands.includes("Date.now()-120_000"));
  for(const feature of ["Adafruit_SSD1306","showOrderDisplay","showClubLogo","STATUS_DISPLAY_SCREENSAVER_MS","CUSTOMER_DISPLAY_TIMEOUT_MS","displayOrderUpdatedAt"])
    assert.ok(firmware.includes(feature),`${feature} fehlt`);
  assert.ok(config.includes("PIN_I2C_SDA = 0")&&config.includes("PIN_I2C_SCL = 2"));
  assert.ok(pio.includes("Adafruit SSD1306"));
  for(const file of [schema,migration,backup])assert.ok(file.includes("rfid_display_states"));
});
