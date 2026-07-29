#include <Arduino.h>
#include <time.h>
#include <SPI.h>
#include <Wire.h>
#include <EEPROM.h>
#include <stddef.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <MFRC522.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "web_ui.h"

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);
ESP8266WebServer server(80);
Adafruit_NeoPixel statusPixels(STATUS_LED_COUNT, PIN_STATUS_LED, NEO_GRB + NEO_KHZ800);
Adafruit_SSD1306 statusDisplay(
    STATUS_DISPLAY_WIDTH, STATUS_DISPLAY_HEIGHT, &Wire, -1);
BearSSL::WiFiClientSecure vereinskasseTls;
HTTPClient vereinskasseHttps;
BearSSL::X509List vereinskasseTrustAnchor(VEREINSKASSE_ROOT_CA);
String apSsid, apPassword, webUser, webPassword;
String clubWifiSsid, clubWifiPassword, wifiCsrfToken;
bool wifiSettingsStored = false;
bool stationReconnectPending = false;
unsigned long stationReconnectAt = 0;
String lastPushState = "Noch keine Karte übertragen.";
String lastPushedUid;
String pendingUid, pendingType;
int pendingBlocks = 0;
bool pendingUidReady = false;
unsigned long nextPendingRetryAt = 0;
unsigned long pendingRetryDelayMs = UID_RETRY_INITIAL_MS;
unsigned long wifiDisconnectedSince = 0;
unsigned long serverFailureSince = 0;
unsigned long lastRfidHealthCheckAt = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastScanAt = 0;
unsigned long lastPushAt = 0;
unsigned long lastCommandPollAt = 0;
unsigned long lastCommandErrorLogAt = 0;
unsigned long lastMaintenanceRequestAt = 0;
bool timeSyncStarted = false;
bool stationWasConnected = false;
bool clockWasReady = false;
bool writeCommandActive = false;
bool writeResultReady = false;
bool writeResultSuccess = false;
String writeCommandId, writeCommandUid, writeCommandHex, writeResultHex, writeResultError;
int writeCommandBlock = 0;
bool statusDisplayReady = false;
String statusDisplayTitle;
String statusDisplayDetail;
String lastDisplayRevision;
String displayOrderCustomer;
String displayOrderItems;
int displayOrderItemCount = 0;
int displayOrderTotalCents = 0;
bool displayOrderActive = false;
unsigned long displayOrderUpdatedAt = 0;
unsigned long displayReadySince = 0;

enum class StatusLedMode {
  Starting,
  Connecting,
  Ready,
  Scanning,
  Success,
  Error,
  WriteWaiting,
  Writing
};

StatusLedMode statusLedMode = StatusLedMode::Starting;
unsigned long statusLedUntil = 0;
unsigned long statusLedLastFrame = 0;

bool clockReady();
String jsonStringField(const String &body, const String &name);
void maintainStationWifi();

struct WifiSettings {
  char magic[8];
  uint8_t version;
  char ssid[33];
  char password[65];
  uint32_t checksum;
};

uint32_t wifiSettingsChecksum(const WifiSettings &settings) {
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&settings);
  uint32_t checksum = 2166136261UL;
  for (size_t i = 0; i < offsetof(WifiSettings, checksum); ++i) {
    checksum ^= bytes[i];
    checksum *= 16777619UL;
  }
  return checksum;
}

void applyCompileTimeWifi() {
  clubWifiSsid = CLUB_WIFI_SSID;
  clubWifiPassword = CLUB_WIFI_PASSWORD;
  wifiSettingsStored = false;
}

void loadWifiSettings() {
  EEPROM.begin(WIFI_SETTINGS_EEPROM_SIZE);
  WifiSettings settings{};
  EEPROM.get(WIFI_SETTINGS_EEPROM_ADDRESS, settings);
  const bool valid =
      memcmp(settings.magic, "VK-WIFI", 7) == 0 &&
      settings.version == 1 &&
      settings.ssid[sizeof(settings.ssid) - 1] == '\0' &&
      settings.password[sizeof(settings.password) - 1] == '\0' &&
      settings.checksum == wifiSettingsChecksum(settings);
  if (!valid) {
    applyCompileTimeWifi();
    return;
  }
  clubWifiSsid = settings.ssid;
  clubWifiPassword = settings.password;
  wifiSettingsStored = true;
}

bool saveWifiSettings(const String &ssid, const String &password) {
  WifiSettings settings{};
  memcpy(settings.magic, "VK-WIFI", 7);
  settings.version = 1;
  ssid.toCharArray(settings.ssid, sizeof(settings.ssid));
  password.toCharArray(settings.password, sizeof(settings.password));
  settings.checksum = wifiSettingsChecksum(settings);
  EEPROM.put(WIFI_SETTINGS_EEPROM_ADDRESS, settings);
  if (!EEPROM.commit()) return false;
  clubWifiSsid = ssid;
  clubWifiPassword = password;
  wifiSettingsStored = true;
  return true;
}

String displaySafeText(String text) {
  text.replace("Ä", "Ae");
  text.replace("Ö", "Oe");
  text.replace("Ü", "Ue");
  text.replace("ä", "ae");
  text.replace("ö", "oe");
  text.replace("ü", "ue");
  text.replace("ß", "ss");
  return text;
}

void showStatusDisplay(const String &title, const String &detail) {
  if (!statusDisplayReady) return;
  const String safeTitle = displaySafeText(title);
  const String safeDetail = displaySafeText(detail);
  if (safeTitle == statusDisplayTitle && safeDetail == statusDisplayDetail) return;
  statusDisplayTitle = safeTitle;
  statusDisplayDetail = safeDetail;

  statusDisplay.clearDisplay();
  statusDisplay.setTextColor(SSD1306_WHITE);
  statusDisplay.setTextWrap(true);
  statusDisplay.setTextSize(1);
  statusDisplay.setCursor(0, 0);
  statusDisplay.println("VEREINSKASSE");
  statusDisplay.drawLine(0, STATUS_DISPLAY_HEADER_HEIGHT - 3,
                         STATUS_DISPLAY_WIDTH - 1, STATUS_DISPLAY_HEADER_HEIGHT - 3,
                         SSD1306_WHITE);
  statusDisplay.setTextSize(2);
  statusDisplay.setCursor(0, 18);
  statusDisplay.println(safeTitle.substring(0, 10));
  statusDisplay.setTextSize(1);
  statusDisplay.setCursor(0, 45);
  statusDisplay.println(safeDetail.substring(0, 42));
  statusDisplay.display();
}

String displayMoney(int cents) {
  const int euros = cents / 100;
  const int remainder = abs(cents % 100);
  return String(euros) + "," + (remainder < 10 ? "0" : "") + String(remainder) + " EUR";
}

void showOrderDisplay() {
  if (!statusDisplayReady || !displayOrderActive) return;
  const String customer = displaySafeText(
      displayOrderCustomer.length() ? displayOrderCustomer : "Bestellung");
  const String items = displaySafeText(displayOrderItems.length()
      ? displayOrderItems
      : (displayOrderItemCount ? String(displayOrderItemCount) + " Artikel" : "Noch keine Artikel"));
  const String cacheKey = customer + ":" + items + ":" + String(displayOrderItemCount) + ":" +
                          String(displayOrderTotalCents);
  if (statusDisplayTitle == "__order__" && statusDisplayDetail == cacheKey) return;
  statusDisplayTitle = "__order__";
  statusDisplayDetail = cacheKey;
  statusDisplay.clearDisplay();
  statusDisplay.setTextColor(SSD1306_WHITE);
  statusDisplay.setTextWrap(false);
  statusDisplay.setTextSize(1);
  statusDisplay.setCursor(0, 0);
  statusDisplay.println(customer.substring(0, 20));
  statusDisplay.drawLine(0, STATUS_DISPLAY_HEADER_HEIGHT - 3,
                         STATUS_DISPLAY_WIDTH - 1, STATUS_DISPLAY_HEADER_HEIGHT - 3,
                         SSD1306_WHITE);
  // Zwei Pixel Abstand zur festen Gelb/Blau-Grenze verhindern Mischfarben.
  statusDisplay.setCursor(0, STATUS_DISPLAY_HEADER_HEIGHT + 2);
  statusDisplay.println(items.substring(0, 21));
  if (items.length() > 21) {
    statusDisplay.setCursor(0, STATUS_DISPLAY_HEADER_HEIGHT + 12);
    statusDisplay.println(items.substring(21, 42));
  }
  statusDisplay.setTextSize(2);
  statusDisplay.setCursor(0, 44);
  statusDisplay.println(displayMoney(displayOrderTotalCents));
  statusDisplay.display();
}

void showClubLogo() {
  if (!statusDisplayReady || displayOrderActive || statusDisplayTitle == "__logo__") return;
  statusDisplayTitle = "__logo__";
  statusDisplayDetail = "";
  statusDisplay.clearDisplay();
  statusDisplay.setTextColor(SSD1306_WHITE);

  // Vereinfachte monochrome Fassung des SV-Barver-Wappens mit zwei Darts.
  statusDisplay.drawLine(37, 8, 64, 2, SSD1306_WHITE);
  statusDisplay.drawLine(64, 2, 91, 8, SSD1306_WHITE);
  statusDisplay.drawLine(37, 8, 40, 41, SSD1306_WHITE);
  statusDisplay.drawLine(91, 8, 88, 41, SSD1306_WHITE);
  statusDisplay.drawLine(40, 41, 64, 59, SSD1306_WHITE);
  statusDisplay.drawLine(88, 41, 64, 59, SSD1306_WHITE);
  statusDisplay.drawLine(16, 10, 49, 52, SSD1306_WHITE);
  statusDisplay.drawLine(112, 10, 79, 52, SSD1306_WHITE);
  statusDisplay.fillTriangle(12, 5, 22, 9, 16, 15, SSD1306_WHITE);
  statusDisplay.fillTriangle(116, 5, 106, 9, 112, 15, SSD1306_WHITE);
  statusDisplay.setTextSize(2);
  statusDisplay.setCursor(51, 12);
  statusDisplay.print("SV");
  statusDisplay.setTextSize(1);
  statusDisplay.setCursor(48, 31);
  statusDisplay.print("BARVER");
  statusDisplay.setCursor(52, 42);
  statusDisplay.print("DARTS");
  statusDisplay.display();
}

void setupStatusDisplay() {
  if (!ENABLE_I2C_STATUS_DISPLAY) return;
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);
  Wire.beginTransmission(STATUS_DISPLAY_ADDRESS);
  if (Wire.endTransmission() != 0) {
    Serial.printf("I2C-Display: nicht unter 0x%02X gefunden; Leser laeuft ohne Display.\n",
                  STATUS_DISPLAY_ADDRESS);
    return;
  }
  statusDisplayReady = statusDisplay.begin(
      SSD1306_SWITCHCAPVCC, STATUS_DISPLAY_ADDRESS, true, false);
  if (!statusDisplayReady) {
    Serial.println("I2C-Display: Initialisierung fehlgeschlagen.");
    return;
  }
  statusDisplay.clearDisplay();
  statusDisplay.display();
  showStatusDisplay("Start", "Leser startet");
  Serial.printf("I2C-Display: bereit auf D3/D4, Adresse 0x%02X.\n",
                STATUS_DISPLAY_ADDRESS);
}

void setStatusLed(StatusLedMode mode, unsigned long durationMs = 0) {
  const StatusLedMode previousMode = statusLedMode;
  statusLedMode = mode;
  statusLedUntil = durationMs ? millis() + durationMs : 0;
  statusLedLastFrame = 0;
  switch (mode) {
    case StatusLedMode::Starting: showStatusDisplay("Start", "Leser startet"); break;
    case StatusLedMode::Connecting: showStatusDisplay("WLAN", "Verbindung wird aufgebaut"); break;
    case StatusLedMode::Ready:
      if (previousMode != StatusLedMode::Ready) displayReadySince = millis();
      if (displayOrderActive) showOrderDisplay();
      else showStatusDisplay("RFID bereit", "Karte auflegen");
      break;
    case StatusLedMode::Scanning: showStatusDisplay("Karte da", "Wird geprueft"); break;
    case StatusLedMode::Success: showStatusDisplay("Erkannt", "Scan erfolgreich"); break;
    case StatusLedMode::Error: showStatusDisplay("Fehler", "Status in der App pruefen"); break;
    case StatusLedMode::WriteWaiting: showStatusDisplay("Schreiben", "Karte erneut auflegen"); break;
    case StatusLedMode::Writing: showStatusDisplay("Schreiben", "Karte liegen lassen"); break;
  }
}

void fillStatusPixels(uint8_t red, uint8_t green, uint8_t blue) {
  const uint32_t color = statusPixels.Color(red, green, blue);
  for (uint16_t i = 0; i < STATUS_LED_COUNT; ++i) statusPixels.setPixelColor(i, color);
  statusPixels.show();
}

void renderStatusLed() {
  const unsigned long now = millis();
  if (displayOrderActive && displayOrderUpdatedAt &&
      now - displayOrderUpdatedAt >= CUSTOMER_DISPLAY_TIMEOUT_MS) {
    displayOrderActive = false;
    displayReadySince = now;
    if (statusLedMode == StatusLedMode::Ready)
      showStatusDisplay("RFID bereit", "Karte auflegen");
  }
  if (statusLedUntil && (long)(now - statusLedUntil) >= 0) {
    statusLedUntil = 0;
    if (writeCommandActive) setStatusLed(StatusLedMode::WriteWaiting);
    else if (WiFi.status() == WL_CONNECTED && clockReady()) setStatusLed(StatusLedMode::Ready);
    else setStatusLed(StatusLedMode::Connecting);
  }
  if (statusLedLastFrame && now - statusLedLastFrame < 45) return;
  statusLedLastFrame = now;
  if (statusLedMode == StatusLedMode::Ready && !displayOrderActive &&
      displayReadySince && now - displayReadySince >= STATUS_DISPLAY_SCREENSAVER_MS) {
    showClubLogo();
  }

  const uint8_t pulse = 18 + (uint8_t)((now / 12) % 34);
  const bool flash = (now / 180) % 2 == 0;
  switch (statusLedMode) {
    case StatusLedMode::Starting: fillStatusPixels(pulse, pulse / 2, 0); break;
    case StatusLedMode::Connecting: fillStatusPixels(0, 0, pulse); break;
    case StatusLedMode::Ready: fillStatusPixels(0, 18, 24); break;
    case StatusLedMode::Scanning: fillStatusPixels(28, 0, 34); break;
    case StatusLedMode::Success: fillStatusPixels(0, 60, 8); break;
    case StatusLedMode::Error: fillStatusPixels(flash ? 70 : 4, 0, 0); break;
    case StatusLedMode::WriteWaiting: fillStatusPixels(pulse, 0, pulse); break;
    case StatusLedMode::Writing: fillStatusPixels(42, 0, 55); break;
  }
}

bool stationConfigured() {
  return clubWifiSsid.length() > 0;
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
  if (server.authenticate(webUser.c_str(), webPassword.c_str())) {
    lastMaintenanceRequestAt = millis();
    return true;
  }
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

bool beginVereinskasseRequest(const String &url) {
  vereinskasseTls.setTrustAnchors(&vereinskasseTrustAnchor);
  vereinskasseTls.setTimeout(HTTPS_TIMEOUT_MS);
  vereinskasseHttps.setTimeout(HTTPS_TIMEOUT_MS);
  vereinskasseHttps.setReuse(true);
  return vereinskasseHttps.begin(vereinskasseTls, url);
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

  if (!beginVereinskasseRequest(VEREINSKASSE_API_URL)) {
    lastPushState = "HTTPS-Verbindung konnte nicht vorbereitet werden.";
    return false;
  }

  vereinskasseHttps.addHeader("Content-Type", "application/json");
  vereinskasseHttps.addHeader("X-RFID-Token", RFID_DEVICE_TOKEN);
  const String body = "{\"uid\":\"" + jsonEscape(uid) +
                      "\",\"type\":\"" + jsonEscape(type) +
                      "\",\"blocks\":" + String(blocks) + "}";
  const int status = vereinskasseHttps.POST(body);
  const String response = vereinskasseHttps.getString();
  vereinskasseHttps.end();

  if (status >= 200 && status < 300) {
    serverFailureSince = 0;
    lastPushState = "Karte " + uid + " an die Vereinskasse übertragen.";
    setStatusLed(StatusLedMode::Success, 900);
    const String memberName = jsonStringField(response, "memberName");
    const String scanState = jsonStringField(response, "state");
    if (memberName.length()) {
      showStatusDisplay("Erkannt", memberName);
    } else if (scanState == "unknown") {
      showStatusDisplay("Unbekannt", "In der App zuordnen");
    }
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
  setStatusLed(StatusLedMode::Error, 1800);
  if (!serverFailureSince) serverFailureSince = millis();
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
                ",\"stationSsid\":\"" + jsonEscape(clubWifiSsid) +
                "\",\"wifiSettingsStored\":" + String(wifiSettingsStored ? "true" : "false") +
                ",\"stationIp\":\"" +
                (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("")) +
                "\",\"pushConfigured\":" + String(pushConfigured() ? "true" : "false") +
                ",\"clockReady\":" + String(clockReady() ? "true" : "false") +
                ",\"pendingScan\":" + String(pendingUidReady ? "true" : "false") +
                ",\"lastUid\":\"" + jsonEscape(lastPushedUid) +
                "\",\"csrf\":\"" + jsonEscape(wifiCsrfToken) +
                "\",\"message\":\"" + jsonEscape(lastPushState) + "\"}";
  json(200, body);
}

bool validWifiCsrf() {
  return server.hasArg("_csrf") && server.arg("_csrf") == wifiCsrfToken;
}

void reconnectStationWifi() {
  WiFi.disconnect(false);
  stationWasConnected = false;
  clockWasReady = false;
  timeSyncStarted = false;
  wifiDisconnectedSince = 0;
  lastWifiAttempt = 0;
  if (stationConfigured()) {
    lastPushState = "Neue WLAN-Einstellung gespeichert. Verbindung wird aufgebaut.";
    maintainStationWifi();
  } else {
    lastPushState = "Vereins-WLAN entfernt. Wartungszugang bleibt erreichbar.";
    setStatusLed(StatusLedMode::Connecting);
  }
}

void scheduleStationReconnect() {
  stationReconnectPending = true;
  stationReconnectAt = millis() + 1200;
}

void processStationReconnect() {
  if (!stationReconnectPending || (long)(millis() - stationReconnectAt) < 0) return;
  stationReconnectPending = false;
  reconnectStationWifi();
}

void handleWifiSave() {
  if (!authorized()) return;
  if (!validWifiCsrf()) {
    json(403, "{\"error\":\"Sicherheitsprüfung fehlgeschlagen. Seite neu laden.\"}");
    return;
  }
  if (server.arg("confirm") != "SPEICHERN") {
    json(400, "{\"error\":\"Bestätigung SPEICHERN fehlt.\"}");
    return;
  }
  String ssid = server.arg("ssid");
  const String password = server.arg("password");
  ssid.trim();
  if (!ssid.length() || ssid.length() > 32) {
    json(400, "{\"error\":\"Der WLAN-Name muss 1 bis 32 Byte lang sein.\"}");
    return;
  }
  if (password.length() > 63 || (password.length() > 0 && password.length() < 8)) {
    json(400, "{\"error\":\"Das WLAN-Kennwort muss leer oder 8 bis 63 Byte lang sein.\"}");
    return;
  }
  if (!saveWifiSettings(ssid, password)) {
    json(500, "{\"error\":\"WLAN-Einstellung konnte nicht dauerhaft gespeichert werden.\"}");
    return;
  }
  lastPushState = "WLAN-Einstellung gespeichert. Verbindung startet gleich.";
  scheduleStationReconnect();
  json(200, "{\"saved\":true,\"ssid\":\"" + jsonEscape(clubWifiSsid) + "\"}");
}

void handleWifiDelete() {
  if (!authorized()) return;
  if (!validWifiCsrf()) {
    json(403, "{\"error\":\"Sicherheitsprüfung fehlgeschlagen. Seite neu laden.\"}");
    return;
  }
  if (server.arg("confirm") != "LOESCHEN") {
    json(400, "{\"error\":\"Bestätigung LOESCHEN fehlt.\"}");
    return;
  }
  if (!saveWifiSettings("", "")) {
    json(500, "{\"error\":\"WLAN-Einstellung konnte nicht entfernt werden.\"}");
    return;
  }
  lastPushState = "Vereins-WLAN entfernt. Wartungszugang bleibt erreichbar.";
  scheduleStationReconnect();
  json(200, "{\"deleted\":true}");
}

void handleWifiScan() {
  if (!authorized()) return;
  const int count = WiFi.scanComplete();
  if (count == WIFI_SCAN_RUNNING) {
    json(202, "{\"scanning\":true}");
    return;
  }
  if (count == WIFI_SCAN_FAILED) {
    WiFi.scanDelete();
    WiFi.scanNetworks(true, true);
    json(202, "{\"scanning\":true}");
    return;
  }
  String body = "{\"networks\":[";
  for (int i = 0; i < count; ++i) {
    if (i) body += ',';
    body += "{\"ssid\":\"" + jsonEscape(WiFi.SSID(i)) +
            "\",\"rssi\":" + String(WiFi.RSSI(i)) +
            ",\"secure\":" + String(WiFi.encryptionType(i) == ENC_TYPE_NONE ? "false" : "true") + "}";
  }
  body += "],\"scanning\":false}";
  WiFi.scanDelete();
  json(200, body);
}

void maintainStationWifi() {
  if (!stationConfigured()) return;
  if (WiFi.status() == WL_CONNECTED) {
    wifiDisconnectedSince = 0;
    if (!stationWasConnected) {
      stationWasConnected = true;
      Serial.printf("Vereins-WLAN verbunden, IP: %s\n", WiFi.localIP().toString().c_str());
    }
    beginClockSync();
    if (clockReady() && !clockWasReady) {
      clockWasReady = true;
      lastPushState = "Vereins-WLAN und sichere Uhrzeit bereit.";
      setStatusLed(StatusLedMode::Ready);
      Serial.println(lastPushState);
    }
    return;
  }

  const unsigned long now = millis();
  if (!wifiDisconnectedSince) wifiDisconnectedSince = now;
  if (stationWasConnected) {
    stationWasConnected = false;
    clockWasReady = false;
    setStatusLed(StatusLedMode::Connecting);
    Serial.println("Vereins-WLAN getrennt.");
  }
  if (lastWifiAttempt && now - lastWifiAttempt < WIFI_RECONNECT_INTERVAL_MS) return;
  lastWifiAttempt = now;
  timeSyncStarted = false;
  lastPushState = "Verbinde mit Vereins-WLAN.";
  setStatusLed(StatusLedMode::Connecting);
  Serial.printf("Verbinde mit Vereins-WLAN \"%s\" ...\n", clubWifiSsid.c_str());
  WiFi.begin(clubWifiSsid.c_str(), clubWifiPassword.c_str());
}

void retryPendingUid() {
  if (!pendingUidReady || millis() < nextPendingRetryAt) return;
  if (pushUidToVereinskasse(pendingUid, pendingType, pendingBlocks)) {
    pendingUidReady = false;
    pendingUid = "";
    pendingType = "";
    pendingBlocks = 0;
    pendingRetryDelayMs = UID_RETRY_INITIAL_MS;
    return;
  }
  nextPendingRetryAt = millis() + pendingRetryDelayMs;
  pendingRetryDelayMs = min(pendingRetryDelayMs * 2UL, UID_RETRY_MAX_MS);
  showStatusDisplay("Gespeichert", "Verbindung wird repariert");
}

void automaticUidScan() {
  const unsigned long now = millis();
  if (writeCommandActive || pendingUidReady || !pushConfigured() || now - lastScanAt < RFID_SCAN_INTERVAL_MS) return;
  lastScanAt = now;
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  const String uid = uidHex();
  const auto cardType = rfid.PICC_GetType(rfid.uid.sak);
  const String type = rfid.PICC_GetTypeName(cardType);
  const int blocks = classicBlocks(cardType);
  finishCard();

  if (uid == lastPushedUid && now - lastPushAt < RFID_REPEAT_GUARD_MS) return;
  lastPushedUid = uid;
  lastPushAt = now;
  pendingUid = uid;
  pendingType = type;
  pendingBlocks = blocks;
  pendingUidReady = true;
  nextPendingRetryAt = now;
  pendingRetryDelayMs = UID_RETRY_INITIAL_MS;
  lastPushState = "Karte " + uid + " erkannt und bis zur Bestätigung gespeichert.";
  setStatusLed(StatusLedMode::Scanning);
  retryPendingUid();
}

void maintainRfidReader() {
  const unsigned long now = millis();
  if (writeCommandActive || now - lastRfidHealthCheckAt < RFID_HEALTHCHECK_INTERVAL_MS) return;
  lastRfidHealthCheckAt = now;
  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (version != 0x00 && version != 0xFF) return;
  Serial.println("RC522 antwortet nicht. Leser wird neu initialisiert.");
  setStatusLed(StatusLedMode::Connecting);
  rfid.PCD_Reset();
  rfid.PCD_Init();
}

void selfRecoverIfStalled() {
  const unsigned long now = millis();
  const bool wifiStalled = stationConfigured() && wifiDisconnectedSince &&
      now - wifiDisconnectedSince >= SELF_RECOVERY_RESTART_MS;
  const bool serverStalled = pendingUidReady && serverFailureSince &&
      now - serverFailureSince >= SELF_RECOVERY_RESTART_MS;
  if (!wifiStalled && !serverStalled) return;
  lastPushState = wifiStalled ? "WLAN dauerhaft getrennt. Sicherer Neustart." :
                               "Server dauerhaft nicht erreichbar. Sicherer Neustart.";
  showStatusDisplay("Neustart", "Scan danach neu auflegen");
  setStatusLed(StatusLedMode::Error);
  Serial.println(lastPushState);
  delay(250);
  ESP.restart();
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

String jsonStringField(const String &body, const String &name) {
  const String marker = "\"" + name + "\":\"";
  int start = body.indexOf(marker);
  if (start < 0) return "";
  start += marker.length();
  const int end = body.indexOf('"', start);
  return end < 0 ? "" : body.substring(start, end);
}

int jsonIntField(const String &body, const String &name) {
  const String marker = "\"" + name + "\":";
  int start = body.indexOf(marker);
  if (start < 0) return -1;
  start += marker.length();
  return body.substring(start).toInt();
}

String commandApiUrl() {
  return String(VEREINSKASSE_API_URL) + "/commands";
}

bool reportWriteResult() {
  if (!writeResultReady) return false;
  if (!beginVereinskasseRequest(commandApiUrl())) return false;
  vereinskasseHttps.addHeader("Content-Type", "application/json");
  vereinskasseHttps.addHeader("X-RFID-Token", RFID_DEVICE_TOKEN);
  const String body = "{\"id\":\"" + jsonEscape(writeCommandId) +
                      "\",\"success\":" + String(writeResultSuccess ? "true" : "false") +
                      ",\"uid\":\"" + jsonEscape(writeCommandUid) +
                      "\",\"hex\":\"" + jsonEscape(writeResultHex) +
                      "\",\"error\":\"" + jsonEscape(writeResultError) + "\"}";
  const int status = vereinskasseHttps.POST(body);
  vereinskasseHttps.end();
  if (status < 200 || status >= 300) {
    lastPushState = "Schreibergebnis konnte nicht gemeldet werden (HTTP " + String(status) + ").";
    setStatusLed(StatusLedMode::Error, 1800);
    return false;
  }
  lastPushState = writeResultSuccess
      ? "RFID-Chip " + writeCommandUid + " beschrieben und geprüft."
      : "RFID-Schreibfehler: " + writeResultError;
  setStatusLed(writeResultSuccess ? StatusLedMode::Success : StatusLedMode::Error,
               writeResultSuccess ? 1200 : 2200);
  Serial.println(lastPushState);
  writeCommandActive = false;
  writeResultReady = false;
  writeCommandId = "";
  return true;
}

void performRemoteRestart(const String &commandId) {
  if (!beginVereinskasseRequest(commandApiUrl())) return;
  vereinskasseHttps.addHeader("Content-Type", "application/json");
  vereinskasseHttps.addHeader("X-RFID-Token", RFID_DEVICE_TOKEN);
  const String body = "{\"id\":\"" + jsonEscape(commandId) +
                      "\",\"success\":true,\"uid\":\"DEVICE-RESTART\",\"hex\":\"\",\"error\":\"\"}";
  const int status = vereinskasseHttps.POST(body);
  vereinskasseHttps.end();
  if (status < 200 || status >= 300) {
    lastPushState = "Neustart konnte nicht bestätigt werden (HTTP " + String(status) + ").";
    setStatusLed(StatusLedMode::Error, 1800);
    return;
  }
  lastPushState = "Sicherer Fernneustart wird ausgeführt.";
  setStatusLed(StatusLedMode::Starting);
  showStatusDisplay("Neustart", "Bitte kurz warten");
  renderStatusLed();
  Serial.println(lastPushState);
  delay(350);
  ESP.restart();
}

void pollWriteCommand() {
  if (!pushConfigured() || WiFi.status() != WL_CONNECTED || !clockReady()) return;
  if (pendingUidReady) return;
  if (writeCommandActive) {
    if (writeResultReady) reportWriteResult();
    return;
  }
  const unsigned long now = millis();
  if (lastMaintenanceRequestAt && now - lastMaintenanceRequestAt < MAINTENANCE_PRIORITY_MS) return;
  if (now - lastCommandPollAt < RFID_COMMAND_POLL_INTERVAL_MS) return;
  lastCommandPollAt = now;

  if (!beginVereinskasseRequest(commandApiUrl())) return;
  vereinskasseHttps.addHeader("X-RFID-Token", RFID_DEVICE_TOKEN);
  if (lastDisplayRevision.length())
    vereinskasseHttps.addHeader("X-Display-Revision", lastDisplayRevision);
  const int status = vereinskasseHttps.GET();
  const String response = status == 200 ? vereinskasseHttps.getString() : "";
  vereinskasseHttps.end();
  if (status == 204) return;
  if (status != 200) {
    if (status > 0) {
      lastPushState = "Schreibauftrag-Abfrage: HTTP " + String(status) + ".";
    } else {
      char tlsError[120] = {};
      const int tlsCode = vereinskasseTls.getLastSSLError(tlsError, sizeof(tlsError));
      lastPushState = "Schreibauftrag-Abfrage: " + String(HTTPClient::errorToString(status).c_str());
      if (tlsCode) lastPushState += " · TLS " + String(tlsCode) + ": " + String(tlsError);
    }
    setStatusLed(StatusLedMode::Error, 1400);
    if (millis() - lastCommandErrorLogAt >= 15000) {
      lastCommandErrorLogAt = millis();
      Serial.println(lastPushState);
    }
    return;
  }

  const String id = jsonStringField(response, "id");
  const String action = jsonStringField(response, "action");
  if (action == "display") {
    lastDisplayRevision = jsonStringField(response, "revision");
    displayOrderActive = jsonStringField(response, "state") == "cart";
    displayOrderCustomer = jsonStringField(response, "customerName");
    displayOrderItems = jsonStringField(response, "itemsText");
    displayOrderItemCount = max(0, jsonIntField(response, "itemCount"));
    displayOrderTotalCents = max(0, jsonIntField(response, "totalCents"));
    displayOrderUpdatedAt = millis();
    if (!displayOrderActive) {
      displayOrderActive = false;
      displayReadySince = millis();
      if (statusLedMode == StatusLedMode::Ready)
        showStatusDisplay("RFID bereit", "Karte auflegen");
    } else if (statusLedMode == StatusLedMode::Ready) {
      showOrderDisplay();
    }
    return;
  }
  if (id.length() && action == "restart") {
    performRemoteRestart(id);
    return;
  }
  const String uid = jsonStringField(response, "uid");
  const String payload = jsonStringField(response, "hex");
  const int block = jsonIntField(response, "block");
  byte parsed[16];
  if (!id.length() || !uid.length() || block < 1 || isTrailer(block) ||
      !parseHex(payload, parsed, 16)) {
    lastPushState = "Ungültiger RFID-Schreibauftrag empfangen.";
    return;
  }
  writeCommandId = id;
  writeCommandUid = uid;
  writeCommandHex = payload;
  writeCommandBlock = block;
  writeCommandActive = true;
  writeResultReady = false;
  writeResultSuccess = false;
  writeResultHex = "";
  writeResultError = "";
  lastPushState = "Schreibauftrag bereit: Karte " + uid + " auflegen.";
  setStatusLed(StatusLedMode::WriteWaiting);
  Serial.println(lastPushState);
}

void processWriteCommand() {
  if (!writeCommandActive || writeResultReady) return;
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  const String scannedUid = uidHex();
  if (scannedUid != writeCommandUid) {
    finishCard();
    lastPushState = "Falsche Karte " + scannedUid + " – erwartet wird " + writeCommandUid + ".";
    setStatusLed(StatusLedMode::Error, 1400);
    return;
  }

  setStatusLed(StatusLedMode::Writing);
  const int blocks = classicBlocks(rfid.PICC_GetType(rfid.uid.sak));
  byte payload[16],check[18];byte checkLen=sizeof(check);
  String error;
  MFRC522::MIFARE_Key key;
  for (byte i=0;i<6;++i) key.keyByte[i]=0xFF;
  if (!blocks || writeCommandBlock >= blocks || writeCommandBlock == 0 || isTrailer(writeCommandBlock)) {
    error = "Block ist auf dieser Karte nicht beschreibbar.";
  } else if (!parseHex(writeCommandHex, payload, 16)) {
    error = "Schreibdaten sind ungültig.";
  } else if (!authenticateBlock(writeCommandBlock,key,MFRC522::PICC_CMD_MF_AUTH_KEY_A,error)) {
    // authenticateBlock setzt die genaue Fehlermeldung.
  } else {
    auto status=rfid.MIFARE_Write(writeCommandBlock,payload,16);
    if(status!=MFRC522::STATUS_OK) error="Schreiben fehlgeschlagen: "+String(rfid.GetStatusCodeName(status));
    else {
      status=rfid.MIFARE_Read(writeCommandBlock,check,&checkLen);
      if(status!=MFRC522::STATUS_OK||memcmp(payload,check,16)!=0)error="Rücklesen konnte die Daten nicht bestätigen.";
      else {
        writeResultSuccess=true;
        writeResultHex=bytesHex(check,16);
      }
    }
  }
  finishCard();
  if (!writeResultSuccess) {
    writeResultError=error.length()?error:"Unbekannter Schreibfehler.";
    writeResultHex="";
  } else writeResultError="";
  writeResultReady=true;
  reportWriteResult();
}

String macSuffix() {
  char buf[7];
  snprintf(buf, sizeof(buf), "%06X", ESP.getChipId() & 0xFFFFFF);
  return String(buf);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  ESP.wdtEnable(8000);
  statusPixels.begin();
  statusPixels.setBrightness(STATUS_LED_BRIGHTNESS);
  statusPixels.clear();
  statusPixels.show();
  setupStatusDisplay();
  setStatusLed(StatusLedMode::Starting);
  renderStatusLed();
  SPI.begin();
  rfid.PCD_Init();
  delay(4);

  const String id = macSuffix();
  apSsid = strlen(CUSTOM_AP_SSID) ? CUSTOM_AP_SSID : "NFC-Reader-" + id;
  apPassword = strlen(CUSTOM_AP_PASSWORD) ? CUSTOM_AP_PASSWORD : "NFC-" + id + "-Setup!";
  webUser = CUSTOM_WEB_USER;
  webPassword = strlen(CUSTOM_WEB_PASSWORD) ? CUSTOM_WEB_PASSWORD : "Web-" + id + "-Login!";
  wifiCsrfToken = id + "-" + String(ESP.getCycleCount(), HEX) + "-" + String(micros(), HEX);
  loadWifiSettings();

  // Der Wartungs-AP bleibt immer erreichbar. Parallel verbindet sich der
  // ESP8266 als Station mit dem Vereins-WLAN und sendet Scans per HTTPS.
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
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
  server.on("/api/wifi", HTTP_POST, handleWifiSave);
  server.on("/api/wifi", HTTP_DELETE, handleWifiDelete);
  server.on("/api/wifi/scan", HTTP_GET, handleWifiScan);
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
  ESP.wdtFeed();
  server.handleClient();
  processStationReconnect();
  maintainStationWifi();
  // Kartenscans haben Vorrang vor der langsameren HTTPS-Abfrage nach
  // Schreibaufträgen, damit ein Mitgliederwechsel sofort erkannt wird.
  automaticUidScan();
  retryPendingUid();
  maintainRfidReader();
  pollWriteCommand();
  processWriteCommand();
  selfRecoverIfStalled();
  renderStatusLed();
  delay(2);
}
