import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("RFID öffnet Profile sicher und behält die PIN als Rückfall",async()=>{
  const [route,component,page]=await Promise.all([read("app/api/rfid/login/route.ts"),read("app/RfidIntegration.tsx"),read("app/page.tsx")]);
  for(const fragment of ["s.profile_id=?","d.active=1","s.consumed_at IS NULL","s.expires_at>?","m.active=1","UPDATE rfid_scans SET consumed_at=?","RFID_PROFILE_LOGIN"])
    assert.ok(route.includes(fragment),`Sicherheitsprüfung fehlt: ${fragment}`);
  assert.ok(route.includes('state:"pin_required"'));
  assert.ok(component.includes("export function RfidProfileLogin")&&component.includes("setInterval(poll,350)"));
  assert.ok(page.includes("Profil mit Chip öffnen")&&page.includes("Mit Profil-PIN anmelden"));
});

test("unterstützt nur noch den ESP32 D1 mini",async()=>{
  const [component,platformio,dockerfile,workflow,commands,readme,docs,config]=await Promise.all([
    read("app/RfidIntegration.tsx"),read("hardware/NodeMCU-V3-RC522-Tablet/platformio.ini"),read("Dockerfile"),
    read(".github/workflows/container.yml"),read("app/api/rfid/commands/route.ts"),
    read("hardware/NodeMCU-V3-RC522-Tablet/README.md"),read("docs/rfid-esp32-d1-mini.md"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h")
  ]);
  assert.ok(platformio.includes("default_envs = esp32_d1_mini")&&platformio.includes("board = wemos_d1_mini32"));
  for(const pin of [
    "PIN_RC522_SS = 5", "PIN_RC522_RST = 17", "PIN_STATUS_LED = 16",
    "PIN_I2C_SDA = 21", "PIN_I2C_SCL = 22"
  ]) assert.ok(config.includes(pin),`ESP32-D1-mini-Pin fehlt: ${pin}`);
  for(const wiring of ["SDA / SS | D8", "SCK | D5", "MOSI | D7", "MISO | D6", "RST | D3", "SDA | D2", "SCL | D1"])
    assert.ok(readme.includes(wiring),`D1-mini-Verkabelung fehlt: ${wiring}`);
  assert.ok(dockerfile.includes("platformio run -e esp32_d1_mini"));
  assert.ok(!dockerfile.includes("nodemcuv2")&&!workflow.includes("clubiq-rfid-esp8266.bin"));
  assert.ok(commands.includes('firmwareUrl="/firmware/clubiq-rfid-esp32.bin"'));
  for(const source of [component,readme,docs])assert.ok(!source.includes("Alter ESP8266"));
  assert.ok(component.includes("ESP32 D1 mini")&&!component.includes('useState<"esp8266"'));
});

test("prüft WLAN und Raspberry während der einmaligen Bluetooth-Einrichtung",async()=>{
  const [firmware,config,ble]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),read("app/rfid-ble.ts")
  ]);
  for(const fragment of ["startBleSetupMode","startBleWifiVerification","processBleWifiVerification","BleWifiVerificationPhase::Connecting","wifiProvisioningFailureMessage","settings_verified","ESP.restart()"])
    assert.ok(firmware.includes(fragment),`Geprüfte Zustandsfolge fehlt: ${fragment}`);
  const bleLoop=firmware.slice(firmware.indexOf("void loop()"));
  assert.ok(!firmware.includes("#include <WebServer.h>")&&!firmware.includes("server.handleClient()"),"Der alte Leser-Webserver darf nicht mehr gebaut werden");
  assert.ok(bleLoop.indexOf("if (bleProvisioningStarted)")<bleLoop.indexOf("maintainStationWifi()"));
  assert.ok(bleLoop.includes("return;"),"BLE-Einrichtung muss ihren kontrollierten Prüfpfad vor dem Dauerbetrieb ausführen");
  assert.ok(config.includes("WIFI_BLE_RECOVERY_START_MS = 90000"));
  assert.ok(config.includes("BLE_RECOVERY_WINDOW_MS = 5UL * 60UL * 1000UL"));
  assert.ok(firmware.includes("processBleRecoveryTimeout()"));
  assert.ok(!firmware.includes("Kassenserver laenger nicht erreichbar; Bluetooth-Einrichtung wird aktiviert"));
  assert.ok(!config.includes("MAINTENANCE_AP_FALLBACK_MS"));
  assert.ok(ble.includes('type:"provision",version:2')&&ble.includes("waitForWifiReader")&&ble.includes('state==="settings_verified"'));
  assert.ok(ble.includes("recoverVerifiedDisconnect")&&ble.includes("disconnectRecoveryStarted"));
  assert.ok(!ble.includes("if(provisionSent&&!settled){settled=true;resolveStored()}"),"Eine Bluetooth-Trennung darf nicht als Einrichtungserfolg gelten");
});

test("bestätigt die WLAN-Einrichtung erst nach TLS-Prüfung und neuer Raspberry-Meldung",async()=>{
  const [ble,firmware,health]=await Promise.all([read("app/rfid-ble.ts"),read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("app/api/rfid/health/route.ts")]);
  for(const fragment of ["baselineLastSeen","seenAt>baselineLastSeen","loadRegisteredDevices","lastSeenAt","30_000","settings_verified"])
    assert.ok(ble.includes(fragment),`Serverseitige Erfolgsprüfung fehlt: ${fragment}`);
  for(const fragment of ["/health","syncClockFromKiosk","X-RFID-Hardware-Id","BLE_SERVER_MAX_ATTEMPTS"])
    assert.ok(firmware.includes(fragment),`Firmware-Prüfung fehlt: ${fragment}`);
  for(const fragment of ["token_hash=? AND hardware_id=?","nur lesend","serverTime"])
    assert.ok(health.includes(fragment),`Authentifizierte Gesundheitsprüfung fehlt: ${fragment}`);
  assert.ok(!health.includes("UPDATE rfid_devices"),"Die Provisioning-Prüfung darf den späteren Online-Zeitstempel nicht vorwegnehmen");
  assert.ok(!ble.includes("rfidBleRuntime")&&!ble.includes("pairRfidBleReader"));
});

test("RFID-Firmware puffert Scans und bietet nur bei WLAN-Ausfall eine begrenzte Einrichtung",async()=>{
  const [firmware,config]=await Promise.all([read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h")]);
  for(const fragment of ["pendingUidReady","retryPendingUid()","pendingRetryDelayMs * 2UL","WiFi.setAutoReconnect(true)","maintainRfidReader()","rfid.PCD_Reset()","serverFailureSince","startBleSetupMode(true)"])
    assert.ok(firmware.includes(fragment),`Rückfallsicherung fehlt: ${fragment}`);
  assert.ok(firmware.indexOf("pendingUid = uid")<firmware.indexOf("retryPendingUid();",firmware.indexOf("pendingUid = uid")));
  for(const fragment of ["UID_RETRY_INITIAL_MS","UID_RETRY_MAX_MS","WIFI_BLE_RECOVERY_START_MS","BLE_RECOVERY_WINDOW_MS","RFID_HEALTHCHECK_INTERVAL_MS"])
    assert.ok(config.includes(fragment),`Wiederherstellungsgrenze fehlt: ${fragment}`);
});

test("BLE-Kopplung ist verschlüsselt und WLAN-TLS wird geprüft",async()=>{
  const [firmware,ble,route,caddy]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("app/rfid-ble.ts"),read("app/api/rfid/ble/route.ts"),read("deploy/docker/Caddyfile")
  ]);
  for(const fragment of ["ESP_GATT_PERM_WRITE_ENCRYPTED","ESP_GATT_PERM_READ_ENCRYPTED","ESP_LE_AUTH_REQ_SC_BOND","blePhysicalConfirmationPending","verifyBleHmac"])
    assert.ok(firmware.includes(fragment),`BLE-Schutz fehlt: ${fragment}`);
  assert.ok(!firmware.includes("setInsecure()"));
  assert.ok(ble.includes('KIOSK_API_URL="https://10.42.0.1/api/rfid"')&&ble.includes("/rfid-ca.crt"));
  assert.ok(route.includes("verifyHmac")&&route.includes("requireRole")&&route.includes("ESP32-"));
  assert.ok(caddy.includes("https://{$CLUBIQ_KIOSK_IP:10.42.0.1}"));
});

test("OTA bleibt im WLAN und verwendet eine gemeinsame Firmwareversion",async()=>{
  const [component,commands,firmware,config,dockerfile,shared]=await Promise.all([
    read("app/RfidIntegration.tsx"),read("app/api/rfid/commands/route.ts"),read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),
    read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),read("Dockerfile"),read("app/rfid-firmware.ts")
  ]);
  assert.ok(component.includes("Firmware aktualisieren")&&component.includes("Kassen-WLAN"));
  assert.ok(commands.includes("LATEST_RFID_FIRMWARE")&&commands.includes("clubiq-rfid-esp32.bin"));
  for(const fragment of ["HTTPUpdate.h","clubiqHttpUpdate.update","performFirmwareUpdate","X-RFID-Firmware-Version","StatusLedMode::Updating"])
    assert.ok(firmware.includes(fragment),`WLAN-OTA fehlt: ${fragment}`);
  assert.ok(config.includes('FIRMWARE_VERSION[] = "1.9.6"'));
  assert.ok(shared.includes('LATEST_RFID_FIRMWARE="1.9.6"'));
  assert.ok(dockerfile.includes("clubiq-rfid-esp32.bin"));
});

test("RFID-Ampel verwendet ausschließlich den serverseitigen WLAN-Zustand",async()=>{
  const [component,page]=await Promise.all([read("app/RfidIntegration.tsx"),read("app/page.tsx")]);
  for(const fragment of ["RFID offline","RFID bereit","deviceCount"])
    assert.ok(component.includes(fragment),`Automatischer RFID-Status fehlt: ${fragment}`);
  assert.ok(!component.includes("reconnectBleDevice")&&!component.includes("rfid-reconnect-cue"));
  assert.ok(!page.includes("RfidBleBridge"));
});

test("Raspberry prüft den vollständigen lokalen RFID-Netzweg vor der Einrichtung",async()=>{
  const [command,health]=await Promise.all([read("deploy/docker/clubiq"),read("app/api/rfid/health/route.ts")]);
  for(const fragment of ["rfid-netz-pruefen","802-11-wireless.band","clubiq-time","vereinskasse-ca.crt","/api/rfid/health","HTTP $http_status"])
    assert.ok(command.includes(fragment),`RFID-Netzprüfung fehlt: ${fragment}`);
  assert.ok(health.includes('status:401')&&health.includes("x-rfid-token")&&health.includes("x-rfid-hardware-id"));
});
