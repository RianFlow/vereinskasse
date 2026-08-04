import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("RFID öffnet ein ausgewähltes Profil sicher und lässt die PIN als Rückfall",async()=>{
  const [route,component,page]=await Promise.all([read("app/api/rfid/login/route.ts"),read("app/RfidIntegration.tsx"),read("app/page.tsx")]);
  for(const fragment of ["s.profile_id=?","d.active=1","s.consumed_at IS NULL","s.expires_at>?","m.active=1","UPDATE rfid_scans SET consumed_at=?","RFID_PROFILE_LOGIN","profileCookie(profileToken)","memberSession.cookie"]){
    assert.ok(route.includes(fragment),`Sicherheitsprüfung fehlt: ${fragment}`);
  }
  assert.ok(route.includes('state:"pin_required"'),"Die Ersteinrichtung kann unzulässig per Chip umgangen werden");
  assert.ok(component.includes("export function RfidProfileLogin"),"Der RFID-Login fehlt auf der Profilseite");
  assert.ok(component.includes("setInterval(poll,350)"),"Der Login reagiert zu langsam auf einen Chip");
  assert.ok(page.includes("Profil mit Chip öffnen")&&page.includes("Mit Profil-PIN anmelden"),"Chip-Login und PIN-Rückfall sind nicht klar sichtbar");
});

test("RFID-Firmware puffert Scans und heilt Verbindungs- und Leserfehler",async()=>{
  const [firmware,config]=await Promise.all([read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h")]);
  for(const fragment of ["pendingUidReady","retryPendingUid()","pendingRetryDelayMs * 2UL","WiFi.setAutoReconnect(true)","ESP.wdtEnable(8000)","ESP.wdtFeed()","maintainRfidReader()","rfid.PCD_Reset()","selfRecoverIfStalled()","ESP.restart()"]){
    assert.ok(firmware.includes(fragment),`Rückfallsicherung fehlt: ${fragment}`);
  }
  assert.ok(firmware.indexOf("pendingUid = uid")<firmware.indexOf("retryPendingUid();",firmware.indexOf("pendingUid = uid")),"Der Scan wird vor der Übertragung nicht gepuffert");
  for(const fragment of ["UID_RETRY_INITIAL_MS","UID_RETRY_MAX_MS","SELF_RECOVERY_RESTART_MS","RFID_HEALTHCHECK_INTERVAL_MS"])assert.ok(config.includes(fragment),`Wiederherstellungsgrenze fehlt: ${fragment}`);
});

test("RFID-WLAN kann geschützt eingerichtet und dauerhaft gespeichert werden",async()=>{
  const [firmware,config,ui]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/web_ui.h")
  ]);
  for(const fragment of ["#include <EEPROM.h>","struct WifiSettings","loadWifiSettings()","saveWifiSettings","clubWifiSsid","/api/wifi","/api/wifi/scan","WiFi.scanComplete()","WiFi.scanNetworks(true, true)","validWifiCsrf","scheduleStationReconnect","processStationReconnect","lastMaintenanceRequestAt","pendingUidReady) return","SPEICHERN","LOESCHEN"]){
    assert.ok(firmware.includes(fragment),`WLAN-Einrichtung fehlt: ${fragment}`);
  }
  for(const fragment of ["WIFI_SETTINGS_EEPROM_SIZE","WIFI_SETTINGS_EEPROM_ADDRESS","MAINTENANCE_PRIORITY_MS","HTTPS_TIMEOUT_MS"])assert.ok(config.includes(fragment),`EEPROM-/Performance-Einstellung fehlt: ${fragment}`);
  for(const fragment of ["Vereins-WLAN einrichten","WLANs suchen","WLAN speichern und verbinden","Gespeichertes WLAN entfernen","_csrf"]){
    assert.ok(ui.includes(fragment),`WLAN-Oberfläche fehlt: ${fragment}`);
  }
  assert.ok(!firmware.includes('",\\"stationPassword\\":'),"Das WLAN-Kennwort darf nicht über den Status ausgeliefert werden");
});

test("RFID-Kassenserver kann ohne neuen Firmware-Build sicher umgestellt werden",async()=>{
  const [firmware,config,ui,example]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/web_ui.h"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/secrets.example.h")
  ]);
  for(const fragment of ["struct ServerSettings","loadServerSettings()","saveServerSettings","validVereinskasseApiUrl","validRootCertificate","/api/server","/api/server/test","serverSettingsStored","rebuildVereinskasseTrustAnchor"]){
    assert.ok(firmware.includes(fragment),`Dauerhafte Servereinrichtung fehlt: ${fragment}`);
  }
  for(const fragment of ["SERVER_SETTINGS_EEPROM_ADDRESS","SERVER_API_URL_MAX_BYTES","SERVER_DEVICE_TOKEN_MAX_BYTES","SERVER_ROOT_CA_MAX_BYTES"]){
    assert.ok(config.includes(fragment),`Server-Speichergrenze fehlt: ${fragment}`);
  }
  for(const fragment of ["Kassenserver einrichten","https://vereinskasse.local/api/rfid","Geräte-Token","Root-CA-Zertifikat","Server sicher speichern","Verbindung testen"]){
    assert.ok(ui.includes(fragment),`Server-Oberfläche fehlt: ${fragment}`);
  }
  assert.ok(firmware.includes('url.startsWith("https://")'),"Unsichere Serveradressen dürfen nicht gespeichert werden");
  assert.ok(!firmware.includes("setInsecure()"),"Die TLS-Zertifikatsprüfung darf nicht deaktiviert werden");
  assert.ok(!firmware.includes('",\\"deviceToken\\":'),"Der Geräte-Token darf nicht über die Status-API ausgeliefert werden");
  assert.ok(example.includes("VEREINSKASSE_ROOT_CA"),"Ein sicherer Firmware-Rückfallwert für die Root-CA fehlt");
});

test("RFID-Leser koppelt sich ohne PC per kurzlebigem Einmalcode",async()=>{
  const [route,component,firmware,readerUi,schema,d1Migration,postgresMigration]=await Promise.all([
    read("app/api/rfid/pair/route.ts"),
    read("app/RfidIntegration.tsx"),
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/web_ui.h"),
    read("db/schema.ts"),
    read("drizzle/0025_mixed_captain_universe.sql"),
    read("postgres/migrations/0002_rfid_pairing.sql")
  ]);
  for(const fragment of ["x-rfid-pairing-secret","await hash(secret)","failed_attempts","expires_at<=?","RFID_DEVICE_PAIRED","RFID_DEVICE_REPAIRED","requireRole"]){
    assert.ok(route.includes(fragment),`Sichere Kopplungsprüfung fehlt: ${fragment}`);
  }
  for(const fragment of ["secureRandomHex(32)","os_random()","/api/pair/start","X-RFID-Pairing-Secret","pollPairingApproval()","saveServerSettings(vereinskasseApiUrl, pairingSecret"]){
    assert.ok(firmware.includes(fragment),`Leser-Kopplung fehlt: ${fragment}`);
  }
  for(const fragment of ["Ohne PC koppeln",'autoComplete="one-time-code"',"/api/rfid/pair","Freigeben","Notfallweg mit manuellem Geräte-Token"]){
    assert.ok(component.includes(fragment),`Tablet-Kopplungsassistent fehlt: ${fragment}`);
  }
  assert.ok(readerUi.includes("Mit Clubiq Ledger koppeln")&&readerUi.includes("/api/pair/start"),"Kopplungsstart fehlt auf der Wartungsseite");
  for(const source of [schema,d1Migration,postgresMigration]){
    assert.ok(source.includes("rfid_pairing_requests")&&source.includes("hardware_id"),"Kopplungsdatenmodell ist nicht vollständig migriert");
  }
  assert.ok(!firmware.includes("setInsecure()"),"Auch die Kopplung muss das TLS-Zertifikat prüfen");
});
