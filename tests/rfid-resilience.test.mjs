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
  for(const fragment of ["Vereins-WLAN","WLANs suchen","Leser verbinden","Gespeichertes WLAN entfernen","_csrf"]){
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
  for(const fragment of ["Kassenserver","https://vereinskasse.local/api/rfid","Geräte-Token","ClubIQ-Zertifikatsdatei","Server speichern","Verbindung testen"]){
    assert.ok(ui.includes(fragment),`Server-Oberfläche fehlt: ${fragment}`);
  }
  assert.ok(firmware.includes('url.startsWith("https://")'),"Unsichere Serveradressen dürfen nicht gespeichert werden");
  assert.ok(!firmware.includes("setInsecure()"),"Die TLS-Zertifikatsprüfung darf nicht deaktiviert werden");
  assert.ok(!firmware.includes('",\\"deviceToken\\":'),"Der Geräte-Token darf nicht über die Status-API ausgeliefert werden");
  assert.ok(example.includes("VEREINSKASSE_ROOT_CA"),"Ein sicherer Firmware-Rückfallwert für die Root-CA fehlt");
});

test("RFID-Leser koppelt sich ohne PC per kurzlebigem Einmalcode",async()=>{
  const [route,component,ble,firmware,readerUi,schema,d1Migration,postgresMigration]=await Promise.all([
    read("app/api/rfid/pair/route.ts"),
    read("app/RfidIntegration.tsx"),
    read("app/rfid-ble.ts"),
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
  for(const fragment of ["ESP32 ins Kassen-WLAN","Leser für die Einrichtung auswählen","ESP32 einmal ins Kassen-WLAN aufnehmen","Notfall-Token erzeugen"]){
    assert.ok(component.includes(fragment),`Tablet-Kopplungsassistent fehlt: ${fragment}`);
  }
  for(const fragment of ["navigator as Navigator","requestDevice","ClubIQ-RFID-","/rfid-ca.crt","/api/rfid/pair","approvePairing","writeValueWithResponse"]){
    assert.ok(ble.includes(fragment),`Bluetooth-Kopplung fehlt: ${fragment}`);
  }
  assert.ok(readerUi.includes("RFID-Leser verbinden")&&readerUi.includes("/api/pair/start"),"Kopplungsstart fehlt auf der Wartungsseite");
  for(const source of [schema,d1Migration,postgresMigration]){
    assert.ok(source.includes("rfid_pairing_requests")&&source.includes("hardware_id"),"Kopplungsdatenmodell ist nicht vollständig migriert");
  }
  assert.ok(!firmware.includes("setInsecure()"),"Auch die Kopplung muss das TLS-Zertifikat prüfen");
});

test("zeigt die RFID-Verbindung als eigenen aufgeräumten Adminbereich",async()=>{
  const [page,component,rfidStyle,adminStyle]=await Promise.all([
    read("app/page.tsx"),read("app/RfidIntegration.tsx"),read("app/rfid.css"),read("app/admin-sections.css")
  ]);
  for(const fragment of ['{id:"rfid",icon:IconNfc,label:"RFID-Leser"}','adminSection==="rfid"','setAdminSection("rfid")']){
    assert.ok(page.includes(fragment),`Eigener RFID-Menüpunkt fehlt: ${fragment}`);
  }
  for(const fragment of ["Wie möchtest du verbinden?","Alter ESP8266","ESP32 ins Kassen-WLAN","ClubIQ-Zertifikat herunterladen","Zugeordnete Mitgliedskarten","Erweiterte Einrichtung"]){
    assert.ok(component.includes(fragment),`Aufgeräumte RFID-Einrichtung fehlt: ${fragment}`);
  }
  assert.ok(component.includes('useState<"esp8266"|"esp32">("esp32")'),"Der direkte ESP32-Betrieb ist nicht der einfache Standardweg");
  assert.ok(rfidStyle.includes(".rfid-setup-picker")&&rfidStyle.includes(".rfid-collapsible"),"RFID-Layout ist nicht getrennt und einklappbar");
  assert.ok(adminStyle.includes("repeat(8,minmax(0,1fr))"),"Der zusätzliche Adminbereich passt nicht sauber in die Navigation");
});

test("Android richtet den ESP32-Leser direkt und verschlüsselt per Bluetooth ein",async()=>{
  const [firmware,config,platformio,ble,pairRoute,commands,caddy]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),
    read("hardware/NodeMCU-V3-RC522-Tablet/platformio.ini"),
    read("app/rfid-ble.ts"),read("app/api/rfid/pair/route.ts"),
    read("app/api/rfid/commands/route.ts"),read("deploy/docker/Caddyfile")
  ]);
  for(const fragment of ["[env:esp32dev]","board = esp32dev","board_build.partitions = min_spiffs.csv","-D CLUBIQ_ESP32_BLE"]){
    assert.ok(platformio.includes(fragment),`ESP32-Buildkonfiguration fehlt: ${fragment}`);
  }
  for(const fragment of ["PIN_RC522_SS = 5","PIN_RC522_RST = 27","PIN_STATUS_LED = 13","PIN_I2C_SDA = 21","PIN_I2C_SCL = 22"]){
    assert.ok(config.includes(fragment),`ESP32-Pin fehlt: ${fragment}`);
  }
  for(const fragment of ["BLE_SERVICE_UUID","ESP_GATT_PERM_WRITE_ENCRYPTED","ESP_GATT_PERM_READ_ENCRYPTED","mbedtls_base64_decode","processBleProvisioning","startBleProvisioning","ESP_LE_AUTH_REQ_SC_BOND"]){
    assert.ok(firmware.includes(fragment),`Sichere ESP32-Einrichtung fehlt: ${fragment}`);
  }
  for(const fragment of ["blePhysicalConfirmationPending","BLE_PHYSICAL_CONFIRMATION_MS","Jetzt Karte auflegen","processBlePhysicalConfirmation"]){
    assert.ok(firmware.includes(fragment),`Physisch geschützte BLE-Wiederverbindung fehlt: ${fragment}`);
  }
  assert.ok(!firmware.includes("if (pushConfigured()) return;\n  const String deviceName"),"Ein eingerichteter ESP32 muss für die App auffindbar bleiben");
  assert.ok(ble.includes('KIOSK_API_URL="https://10.42.0.1/api/rfid"'),"Die Einrichtung muss den festen lokalen ClubIQ-Ursprung verwenden");
  for(const fragment of ["getAuthorizedRfidBleReaders","getDevices","selectRfidBleReader","requestDevice","RfidBleReader"]){
    assert.ok(ble.includes(fragment),`Standardkonforme BLE-Geräteauswahl fehlt: ${fragment}`);
  }
  assert.ok(pairRoute.includes("ESP(?:8266|32)"),"Die Kopplungsroute akzeptiert die ESP32-Hardwarekennung nicht");
  assert.ok(commands.includes('device.hardwareId?.startsWith("ESP32-")')&&commands.includes("clubiq-rfid-esp32.bin"),"OTA wählt nicht die ESP32-Firmware");
  assert.ok(caddy.includes("/rfid-ca.crt")&&caddy.includes("Content-Disposition \"inline;"),"Das lokale Root-Zertifikat ist nicht gleichursprünglich abrufbar");
});

test("RFID-Leser wird einfach eingerichtet und danach sicher per OTA aktualisiert",async()=>{
  const [component,commands,devices,firmware,config,readerUi,dockerfile,schema,d1Migration,postgresMigration,sharedVersion]=await Promise.all([
    read("app/RfidIntegration.tsx"),read("app/api/rfid/commands/route.ts"),read("app/api/rfid/devices/route.ts"),
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/web_ui.h"),read("Dockerfile"),read("db/schema.ts"),
    read("drizzle/0026_simple_rfid_ota.sql"),read("postgres/migrations/0003_rfid_firmware.sql"),read("app/rfid-firmware.ts")
  ]);
  for(const fragment of ["Leser für die Einrichtung auswählen","Leser ins Kassen-WLAN aufnehmen","WLAN-Einrichtung prüfen","neuer als App","Firmware aktualisieren",'action:"firmware"'])assert.ok(component.includes(fragment),`Vereinfachte App-Führung fehlt: ${fragment}`);
  for(const fragment of ["LATEST_RFID_FIRMWARE","x-rfid-firmware-version",'command.block===-2?"firmware"',"RFID_FIRMWARE_UPDATE_QUEUED","firmwareUrl"])assert.ok(commands.includes(fragment),`OTA-Befehl fehlt: ${fragment}`);
  assert.ok(devices.includes("firmware_version firmwareVersion"),"Firmwarestand wird nicht angezeigt");
  for(const fragment of ["ESP8266httpUpdate.h","HTTPUpdate.h","ESPhttpUpdate.update","clubiqHttpUpdate.update","performFirmwareUpdate","reportDeviceCommandResult",'action == "firmware"',"StatusLedMode::Updating"])assert.ok(firmware.includes(fragment),`Firmware-OTA fehlt: ${fragment}`);
  assert.ok(config.includes('FIRMWARE_VERSION[] = "1.9.2"'),"Firmwareversion ist nicht eingebettet");
  assert.ok(sharedVersion.includes('LATEST_RFID_FIRMWARE="1.9.2"'),"Zentrale OTA-Version fehlt");
  assert.ok(component.includes('from "./rfid-firmware"')&&commands.includes('from "../../../rfid-firmware"'),"Oberfläche und OTA-Route verwenden nicht dieselbe Firmwareversion");
  assert.ok(!component.includes('const latestRfidFirmware='),"Die Oberfläche enthält weiterhin eine abweichende Firmwareversion");
  const setupSource=firmware.slice(firmware.indexOf("void setup()"));
  assert.ok(setupSource.indexOf("startBleProvisioning();")<setupSource.indexOf("startReaderWifi();"),"BLE muss vor dem WLAN initialisiert werden");
  assert.ok(!firmware.includes("WiFi.setSleep(false);"),"ESP32-WLAN darf den BLE-Start nicht durch eine zusätzliche Sleep-Umschaltung stören");
  for(const fragment of ["RFID-Leser verbinden","ClubIQ-Zertifikatsdatei","setupReader()","Leser verbinden","setInterval(()=>{if(!setupRunning)refreshStatus()},8000)"])assert.ok(readerUi.includes(fragment),`Einrichtungsassistent fehlt: ${fragment}`);
  assert.ok(readerUi.includes('accept=".crt,.pem')&&!readerUi.includes("setInsecure()"),"Zertifikat wird nicht sicher übernommen");
  for(const fragment of ["firmware-builder","platformio==6.1.18","clubiq-rfid.bin","clubiq-rfid-esp8266.bin","clubiq-rfid-esp32.bin","-e nodemcuv2 -e esp32dev"])assert.ok(dockerfile.includes(fragment),`Container-Firmwarebuild fehlt: ${fragment}`);
  for(const source of [schema,d1Migration,postgresMigration])assert.ok(source.includes("firmware_version"),"Firmwarestand fehlt in einer Datenbanklaufzeit");
});

test("ESP32 arbeitet nach einmaliger Bluetooth-Einrichtung selbstständig im Kassen-WLAN",async()=>{
  const [component,page,ble,route,commands,timeRoute,firmware,config,caddy]=await Promise.all([
    read("app/RfidIntegration.tsx"),read("app/page.tsx"),read("app/rfid-ble.ts"),read("app/api/rfid/route.ts"),
    read("app/api/rfid/commands/route.ts"),read("app/api/rfid/time/route.ts"),
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),read("deploy/docker/Caddyfile")
  ]);
  for(const fragment of ["Festes Kassen-WLAN","→ 2,4-GHz-WLAN →","Kassen-WLAN übertragen","Danach kein Bluetooth mehr nötig","WLAN dieses Lesers aktualisieren"])
    assert.ok(component.includes(fragment),`Kassen-WLAN-Bedienführung fehlt: ${fragment}`);
  assert.ok(!component.includes("rfidBleRuntime")&&!component.includes("Jetzt neu verbinden"),"Der instabile Bluetooth-Dauerbetrieb ist weiterhin in der Kassenoberfläche aktiv");
  assert.ok(!page.includes("RfidBleBridge")&&!page.includes("setRfidBleDisplayState"),"Der laufende Kassenbetrieb hängt weiterhin vom Browser-Bluetooth ab");
  for(const fragment of ["provisionRfidReader","KIOSK_API_URL","https://10.42.0.1/api/rfid","/rfid-ca.crt","approvePairing"])
    assert.ok(ble.includes(fragment),`Einmalige sichere WLAN-Einrichtung fehlt: ${fragment}`);
  for(const fragment of ["x-rfid-token","token_hash","last_seen_at","rfid_scans"])
    assert.ok(route.includes(fragment),`Direkte Leser-Authentifizierung fehlt: ${fragment}`);
  for(const fragment of ["x-rfid-firmware-version","firmwareUrl",'action:"display"'])
    assert.ok(commands.includes(fragment),`WLAN-Steuerkanal fehlt: ${fragment}`);
  for(const fragment of ["return false;","startReaderWifi","maintainStationWifi","WiFi.setAutoReconnect(true)","MAINTENANCE_AP_FALLBACK_MS","syncClockFromKiosk","KIOSK_TIME_URL","pushUidToVereinskasse","pollWriteCommand"])
    assert.ok(firmware.includes(fragment)||config.includes(fragment),`Stabiler WLAN-Betrieb fehlt: ${fragment}`);
  assert.ok(timeRoute.includes("Date.now()")&&caddy.includes("/clubiq-time"),"Der Offline-TLS-Start erhält keine lokale Uhrzeit vom Raspberry");
  assert.ok(caddy.includes("https://{$CLUBIQ_KIOSK_IP:10.42.0.1}"),"Caddy stellt kein Zertifikat für die feste Kassenadresse bereit");
});

test("RFID-Ampel zeigt den serverseitigen Zustand ohne manuellen Bluetooth-Neuaufbau",async()=>{
  const component=await read("app/RfidIntegration.tsx");
  for(const fragment of ["RFID offline","Der Leser verbindet sich automatisch mit dem ClubIQ-Kassen-WLAN","RFID bereit","deviceCount"])
    assert.ok(component.includes(fragment),`Automatischer RFID-Status fehlt: ${fragment}`);
  assert.ok(!component.includes("reconnectBleDevice")&&!component.includes("rfid-reconnect-cue"),"Die Ampel verlangt weiterhin eine manuelle Bluetooth-Verbindung");
});
