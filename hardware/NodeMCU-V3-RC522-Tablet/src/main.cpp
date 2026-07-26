#include <Arduino.h>
#include <time.h>
#include <SPI.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <MFRC522.h>
#include "config.h"
#include "web_ui.h"

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);
ESP8266WebServer server(80);
String apSsid, apPassword, webUser, webPassword;
String lastPushState = "Noch keine Karte übertragen.";
String lastPushedUid;
unsigned long lastWifiAttempt = 0;
unsigned long lastScanAt = 0;
unsigned long lastPushAt = 0;
bool timeSyncStarted = false;

bool stationConfigured() {
  return strlen(CLUB_WIFI_SSID) > 0;
}

bool pushConfigured() {
  return stationConfigured() &&
         strlen(RFID_DEVICE_TOKEN) >= 24 &&
         strlen(VEREINSKASSE_API_URL) > 12 &&
         strlen_P(VEREINSKASSE_ROOT_CA) > 100;
}

String jsonEscape(const String &s) {
  String out;
  for (size_t i = 0; i < s.length(); ++i) {
    const char c = s[i];
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c == '\n') out += "\\n";
    else if ((uint8_t)c >= 0x20) out += c;
  }
  return out;
}

void json(int status, const String &body) {
  server.sendHeader("Cache-Control", "no-store");
  server.send(status, "application/json; charset=utf-8", body);
}

bool authorized() {
  if (server.authenticate(webUser.c_str(), webPassword.c_str())) return true;
  server.requestAuthentication(BASIC_AUTH, "NodeMCU NFC", "Anmeldung erforderlich");
  return false;
}

void finishCard() {
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

bool selectCard(String &error) {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    error = "Keine Karte erkannt. Karte auflegen und erneut versuchen.";
    return false;
  }
  return true;
}

String uidHex() {
  String s;
  for (byte i = 0; i < rfid.uid.size; ++i) {
    if (rfid.uid.uidByte[i] < 0x10) s += '0';
    s += String(rfid.uid.uidByte[i], HEX);
    if (i + 1 < rfid.uid.size) s += ':';
  }
  s.toUpperCase();
  return s;
}

int classicBlocks(MFRC522::PICC_Type type) {
  if (type == MFRC522::PICC_TYPE_MIFARE_1K) return 64;
  if (type == MFRC522::PICC_TYPE_MIFARE_4K) return 256;
  if (type == MFRC522::PICC_TYPE_MIFARE_MINI) return 20;
  return 0;
}

bool clockReady() {
  return time(nullptr) > 1700000000;
}

void beginClockSync() {
  if (timeSyncStarted || WiFi.status() != WL_CONNECTED) return;
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com", "time.google.com");
  timeSyncStarted = true;
  lastPushState = "WLAN verbunden, sichere Uhrzeit wird geladen.";
}

bool pushUidToVereinskasse(const String &uid, const String &type, int blocks) {
  if (!pushConfigured()) {
    lastPushState = "Übertragung nicht eingerichtet.";
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) {
    lastPushState = "Vereins-WLAN nicht verbunden.";
    return false;
  }
  if (!clockReady()) {
    beginClockSync();
    lastPushState = "Warte auf sichere Uhrzeit für TLS.";
    return false;
  }

  BearSSL::WiFiClientSecure tls;
  BearSSL::X509List trustAnchor(VEREINSKASSE_ROOT_CA);
  tls.setTrustAnchors(&trustAnchor);
  tls.setTimeout(5000);

  HTTPClient https;
  https.setTimeout(5000);
  if (!https.begin(tls, VEREINSKASSE_API_URL)) {
    lastPushState = "HTTPS-Verbindung konnte nicht vorbereitet werden.";
    return false;
  }

  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-RFID-Token", RFID_DEVICE_TOKEN);
  const String body = "{\"uid\":\"" + jsonEscape(uid) +
                      "\",\"type\":\"" + jsonEscape(type) +
                      "\",\"blocks\":" + String(blocks) + "}";
  const int status = https.POST(body);
  const String response = https.getString();
  https.end();

  if (status >= 200 && status < 300) {
    lastPushState = "Karte " + uid + " an die Vereinskasse übertragen.";
    Serial.println(lastPushState);
    return true;
  }

  if (status < 0) {
    lastPushState = "Netzwerk-/TLS-Fehler: " + String(HTTPClient::errorToString(status).c_str());
  } else if (status == 401 || status == 403) {
    lastPushState = "Geräte-Token abgelehnt (HTTP " + String(status) + ").";
  } else {
    lastPushState = "Kassenserver antwortet mit HTTP " + String(status) + ".";
  }
  Serial.println(lastPushState);
  if (response.length()) {
    Serial.println(response.substring(0, 180));
  }
  return false;
}

void handleStatus() {
  if (!authorized()) return;
  String body = "{\"apIp\":\"" + WiFi.softAPIP().toString() +
                "\",\"stationConfigured\":" + String(stationConfigured() ? "true" : "false") +
                ",\"stationConnected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") +
                ",\"stationIp\":\"" +
                (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("")) +
                "\",\"pushConfigured\":" + String(pushConfigured() ? "true" : "false") +
                ",\"clockReady\":" + String(clockReady() ? "true" : "false") +
                ",\"lastUid\":\"" + jsonEscape(lastPushedUid) +
                "\",\"message\":\"" + jsonEscape(lastPushState) + "\"}";
  json(200, body);
}

void maintainStationWifi() {
  if (!stationConfigured()) return;
  if (WiFi.status() == WL_CONNECTED) {
    beginClockSync();
    return;
  }

  const unsigned long now = millis();
  if (lastWifiAttempt && now - lastWifiAttempt < WIFI_RECONNECT_INTERVAL_MS) return;
  lastWifiAttempt = now;
  timeSyncStarted = false;
  lastPushState = "Verbinde mit Vereins-WLAN.";
  Serial.printf("Verbinde mit Vereins-WLAN \"%s\" ...\n", CLUB_WIFI_SSID);
  WiFi.begin(CLUB_WIFI_SSID, CLUB_WIFI_PASSWORD);
}

void automaticUidScan() {
  const unsigned long now = millis();
  if (!pushConfigured() || now - lastScanAt < RFID_SCAN_INTERVAL_MS) return;
  lastScanAt = now;
  if (WiFi.status() != WL_CONNECTED || !clockReady()) return;
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  const String uid = uidHex();
  const auto cardType = rfid.PICC_GetType(rfid.uid.sak);
  const String type = rfid.PICC_GetTypeName(cardType);
  const int blocks = classicBlocks(cardType);
  finishCard();

  if (uid == lastPushedUid && now - lastPushAt < RFID_REPEAT_GUARD_MS) return;
  lastPushedUid = uid;
  lastPushAt = now;
  lastPushState = "Karte " + uid + " erkannt, Übertragung läuft.";
  pushUidToVereinskasse(uid, type, blocks);
}

bool isTrailer(int block) {
  return block < 128 ? (block % 4 == 3) : (block % 16 == 15);
}

bool parseHex(const String &input, byte *out, size_t bytes) {
  String s = input;
  s.trim();
  if (s.length() != bytes * 2) return false;
  for (size_t i = 0; i < bytes; ++i) {
    char pair[3] = {s[i * 2], s[i * 2 + 1], 0};
    if (!isxdigit(pair[0]) || !isxdigit(pair[1])) return false;
    out[i] = (byte)strtoul(pair, nullptr, 16);
  }
  return true;
}

String bytesHex(const byte *data, size_t len) {
  String out;
  for (size_t i = 0; i < len; ++i) {
    if (data[i] < 0x10) out += '0';
    out += String(data[i], HEX);
  }
  out.toUpperCase();
  return out;
}

String bytesText(const byte *data, size_t len) {
  String out;
  for (size_t i = 0; i < len && data[i] != 0; ++i)
    out += (data[i] >= 32 && data[i] != 127) ? (char)data[i] : '.';
  return out;
}

bool parseCommon(int &block, MFRC522::MIFARE_Key &key,
                 MFRC522::PICC_Command &command, String &error) {
  if (!server.hasArg("block") || !server.hasArg("key") || !server.hasArg("keyType")) {
    error = "Parameter fehlen."; return false;
  }
  String bs = server.arg("block");
  for (size_t i = 0; i < bs.length(); ++i)
    if (!isDigit(bs[i])) { error = "Ungültige Blocknummer."; return false; }
  block = bs.toInt();
  if (block < 0 || block > 255) { error = "Block muss zwischen 0 und 255 liegen."; return false; }
  if (!parseHex(server.arg("key"), key.keyByte, 6)) {
    error = "Schlüssel muss genau 12 Hex-Zeichen enthalten."; return false;
  }
  String kt = server.arg("keyType");
  if (kt == "A") command = MFRC522::PICC_CMD_MF_AUTH_KEY_A;
  else if (kt == "B") command = MFRC522::PICC_CMD_MF_AUTH_KEY_B;
  else { error = "Unbekannter Schlüsseltyp."; return false; }
  return true;
}

bool authenticateBlock(int block, MFRC522::MIFARE_Key &key,
                       MFRC522::PICC_Command command, String &error) {
  MFRC522::StatusCode st = rfid.PCD_Authenticate(command, block, &key, &rfid.uid);
  if (st != MFRC522::STATUS_OK) {
    error = "Authentifizierung fehlgeschlagen: " + String(rfid.GetStatusCodeName(st));
    return false;
  }
  return true;
}

void handleUid() {
  if (!authorized()) return;
  String error;
  if (!selectCard(error)) { json(404, "{\"error\":\"" + jsonEscape(error) + "\"}"); return; }
  auto type = rfid.PICC_GetType(rfid.uid.sak);
  int blocks = classicBlocks(type);
  String body = "{\"uid\":\"" + uidHex() + "\",\"type\":\"" +
                jsonEscape(rfid.PICC_GetTypeName(type)) + "\",\"blocks\":" + String(blocks) + "}";
  finishCard();
  json(200, body);
}

void handleRead() {
  if (!authorized()) return;
  int block; MFRC522::MIFARE_Key key; MFRC522::PICC_Command cmd; String error;
  if (!parseCommon(block, key, cmd, error)) { json(400, "{\"error\":\"" + error + "\"}"); return; }
  if (!selectCard(error)) { json(404, "{\"error\":\"" + jsonEscape(error) + "\"}"); return; }
  int blocks = classicBlocks(rfid.PICC_GetType(rfid.uid.sak));
  if (!blocks) { finishCard(); json(400, "{\"error\":\"Nur MIFARE Classic Mini/1K/4K unterstützt.\"}"); return; }
  if (block >= blocks) { finishCard(); json(400, "{\"error\":\"Block liegt außerhalb dieser Karte.\"}"); return; }
  if (!authenticateBlock(block, key, cmd, error)) { finishCard(); json(403, "{\"error\":\"" + jsonEscape(error) + "\"}"); return; }
  byte data[18]; byte len = sizeof(data);
  auto st = rfid.MIFARE_Read(block, data, &len);
  if (st != MFRC522::STATUS_OK) { error = rfid.GetStatusCodeName(st); finishCard(); json(500, "{\"error\":\"Lesen fehlgeschlagen: " + jsonEscape(error) + "\"}"); return; }
  String body = "{\"uid\":\"" + uidHex() + "\",\"block\":" + String(block) +
                ",\"hex\":\"" + bytesHex(data, 16) + "\",\"text\":\"" +
                jsonEscape(bytesText(data, 16)) + "\"}";
  finishCard(); json(200, body);
}

void handleWrite() {
  if (!authorized()) return;
  if (server.arg("confirm") != "SCHREIBEN") { json(400, "{\"error\":\"Bestätigung SCHREIBEN fehlt.\"}"); return; }
  int block; MFRC522::MIFARE_Key key; MFRC522::PICC_Command cmd; String error;
  if (!parseCommon(block, key, cmd, error)) { json(400, "{\"error\":\"" + error + "\"}"); return; }
  if (block == 0 || isTrailer(block)) { json(403, "{\"error\":\"Dieser Block ist fest schreibgeschützt.\"}"); return; }
  byte payload[16] = {};
  if (server.arg("format") == "hex") {
    if (!parseHex(server.arg("hex"), payload, 16)) { json(400, "{\"error\":\"Hex benötigt genau 32 gültige Zeichen.\"}"); return; }
  } else if (server.arg("format") == "text") {
    String text = server.arg("text");
    if (text.length() > 16) { json(400, "{\"error\":\"Text ist länger als 16 UTF-8-Byte.\"}"); return; }
    memcpy(payload, text.c_str(), text.length());
  } else { json(400, "{\"error\":\"Ungültiges Schreibformat.\"}"); return; }
  if (!selectCard(error)) { json(404, "{\"error\":\"" + jsonEscape(error) + "\"}"); return; }
  int blocks = classicBlocks(rfid.PICC_GetType(rfid.uid.sak));
  if (!blocks) { finishCard(); json(400, "{\"error\":\"Nur MIFARE Classic Mini/1K/4K unterstützt.\"}"); return; }
  if (block >= blocks) { finishCard(); json(400, "{\"error\":\"Block liegt außerhalb dieser Karte.\"}"); return; }
  if (!authenticateBlock(block, key, cmd, error)) { finishCard(); json(403, "{\"error\":\"" + jsonEscape(error) + "\"}"); return; }
  auto st = rfid.MIFARE_Write(block, payload, 16);
  if (st != MFRC522::STATUS_OK) { error = rfid.GetStatusCodeName(st); finishCard(); json(500, "{\"error\":\"Schreiben fehlgeschlagen: " + jsonEscape(error) + "\"}"); return; }
  byte check[18]; byte len = sizeof(check);
  st = rfid.MIFARE_Read(block, check, &len);
  if (st != MFRC522::STATUS_OK || memcmp(payload, check, 16) != 0) {
    finishCard(); json(500, "{\"error\":\"Schreiben konnte nicht verifiziert werden.\"}"); return;
  }
  String body = "{\"block\":" + String(block) + ",\"hex\":\"" + bytesHex(check, 16) + "\"}";
  finishCard(); json(200, body);
}

String macSuffix() {
  char buf[7];
  snprintf(buf, sizeof(buf), "%06X", ESP.getChipId() & 0xFFFFFF);
  return String(buf);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  SPI.begin();
  rfid.PCD_Init();
  delay(4);

  const String id = macSuffix();
  apSsid = strlen(CUSTOM_AP_SSID) ? CUSTOM_AP_SSID : "NFC-Reader-" + id;
  apPassword = strlen(CUSTOM_AP_PASSWORD) ? CUSTOM_AP_PASSWORD : "NFC-" + id + "-Setup!";
  webUser = CUSTOM_WEB_USER;
  webPassword = strlen(CUSTOM_WEB_PASSWORD) ? CUSTOM_WEB_PASSWORD : "Web-" + id + "-Login!";

  // Der Wartungs-AP bleibt immer erreichbar. Parallel verbindet sich der
  // ESP8266 als Station mit dem Vereins-WLAN und sendet Scans per HTTPS.
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  if (!WiFi.softAP(apSsid.c_str(), apPassword.c_str(), 6, false, 2)) {
    Serial.println("FEHLER: WLAN-AP konnte nicht gestartet werden.");
  }
  maintainStationWifi();

  server.on("/", HTTP_GET, [] {
    if (!authorized()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(200, "text/html; charset=utf-8", INDEX_HTML);
  });
  server.on("/api/uid", HTTP_GET, handleUid);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/read", HTTP_POST, handleRead);
  server.on("/api/write", HTTP_POST, handleWrite);
  server.onNotFound([] { if (authorized()) json(404, "{\"error\":\"Nicht gefunden.\"}"); });
  server.begin();

  Serial.println("\n=== NodeMCU V3 NFC/RFID ===");
  Serial.printf("RC522 Version: 0x%02X\n", rfid.PCD_ReadRegister(MFRC522::VersionReg));
  Serial.printf("WLAN: %s\nWLAN-Kennwort: %s\n", apSsid.c_str(), apPassword.c_str());
  Serial.printf("Adresse: http://%s\nWeb-Benutzer: %s\nWeb-Kennwort: %s\n",
                WiFi.softAPIP().toString().c_str(), webUser.c_str(), webPassword.c_str());
  if (!stationConfigured()) {
    Serial.println("Vereinskasse: noch nicht eingerichtet (include/secrets.h fehlt oder WLAN leer).");
  } else if (!pushConfigured()) {
    Serial.println("Vereinskasse: WLAN eingetragen, aber Token oder Root-CA fehlt.");
  } else {
    Serial.println("Vereinskasse: sichere UID-Übertragung ist eingerichtet.");
  }
}

void loop() {
  server.handleClient();
  maintainStationWifi();
  automaticUidScan();
  delay(2);
}
