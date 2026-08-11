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

test("richtet den ESP32 D1 mini über ein geschütztes Captive Portal ein",async()=>{
  const [firmware,config,platformio,component]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h"),
    read("hardware/NodeMCU-V3-RC522-Tablet/platformio.ini"),read("app/RfidIntegration.tsx")
  ]);
  for(const fragment of ["WiFiManager","startConfigPortal","ClubIQ-Setup-","secureRandomHex(6)","WiFi.SSID()","WiFi.psk()","saveWifiSettings","KIOSK_CA_URL","bootstrapKioskServer(true)","ESP.restart()"])
    assert.ok(firmware.includes(fragment),`Captive-Portal-Ablauf fehlt: ${fragment}`);
  assert.ok(platformio.includes("tzapu/WiFiManager@2.0.17"));
  assert.ok(!platformio.includes("CLUBIQ_ESP32_BLE"));
  assert.ok(config.includes("WIFI_SETUP_PORTAL_TIMEOUT_SECONDS")&&config.includes('KIOSK_API_URL[] = "https://10.42.0.1/api/rfid"'));
  for(const fragment of ["Setup-WLAN","http://192.168.4.1","Kopplungscode","ClubIQ-Setup-"])
    assert.ok(component.includes(fragment),`Einrichtungsanleitung fehlt: ${fragment}`);
  assert.ok(!component.includes("navigator.bluetooth")&&!component.includes("Android-Auswahl"));
});

test("bestätigt einen neuen Leser erst mit dem physischen sechsstelligen Code",async()=>{
  const [firmware,pairRoute,component]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("app/api/rfid/pair/route.ts"),read("app/RfidIntegration.tsx")
  ]);
  for(const fragment of ["secureRandomWord() % 1000000UL","sendPairingRequest","pollPairingApproval","X-RFID-Pairing-Secret","showStatusDisplay(\"Kopplung "])
    assert.ok(firmware.includes(fragment),`Physische Kopplung fehlt: ${fragment}`);
  for(const fragment of ["code_hash","token_hash","failed_attempts","RFID_PAIRING_CODE_REJECTED","RFID_DEVICE_PAIRED"])
    assert.ok(pairRoute.includes(fragment),`Serverseitiger Kopplungsschutz fehlt: ${fragment}`);
  assert.ok(component.includes("Code direkt vom Leserdisplay eingeben")&&component.includes("Leser freigeben"));
});

test("RFID-Firmware puffert Scans und öffnet bei anhaltendem WLAN-Ausfall das Setup-Portal",async()=>{
  const [firmware,config]=await Promise.all([read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("hardware/NodeMCU-V3-RC522-Tablet/include/config.h")]);
  for(const fragment of ["pendingUidReady","retryPendingUid()","pendingRetryDelayMs * 2UL","WiFi.setAutoReconnect(true)","maintainRfidReader()","rfid.PCD_Reset()","serverFailureSince","runSetupPortal()"])
    assert.ok(firmware.includes(fragment),`Rückfallsicherung fehlt: ${fragment}`);
  assert.ok(firmware.indexOf("pendingUid = uid")<firmware.indexOf("retryPendingUid();",firmware.indexOf("pendingUid = uid")));
  for(const fragment of ["UID_RETRY_INITIAL_MS","UID_RETRY_MAX_MS","WIFI_SETUP_PORTAL_START_MS","WIFI_SETUP_PORTAL_TIMEOUT_SECONDS","RFID_HEALTHCHECK_INTERVAL_MS"])
    assert.ok(config.includes(fragment),`Wiederherstellungsgrenze fehlt: ${fragment}`);
});

test("WLAN-Laufzeit und Kopplung verwenden geprüftes TLS",async()=>{
  const [firmware,pairRoute,caddy,health]=await Promise.all([
    read("hardware/NodeMCU-V3-RC522-Tablet/src/main.cpp"),read("app/api/rfid/pair/route.ts"),read("deploy/docker/Caddyfile"),read("app/api/rfid/health/route.ts")
  ]);
  assert.ok(!firmware.includes("setInsecure()"));
  for(const fragment of ["setCACert","KIOSK_CA_URL","validRootCertificate","X-RFID-Hardware-Id"])
    assert.ok(firmware.includes(fragment),`TLS-Prüfung fehlt: ${fragment}`);
  assert.ok(pairRoute.includes("requireRole")&&pairRoute.includes("constantTimeEqual"));
  assert.ok(health.includes("token_hash=? AND hardware_id=?")&&!health.includes("UPDATE rfid_devices"));
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
  assert.ok(config.includes('FIRMWARE_VERSION[] = "1.9.7"'));
  assert.ok(shared.includes('LATEST_RFID_FIRMWARE="1.9.7"'));
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
