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
