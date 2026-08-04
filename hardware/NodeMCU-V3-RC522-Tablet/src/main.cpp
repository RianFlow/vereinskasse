#include <Arduino.h>
#include <time.h>
#include <SPI.h>
#include <Wire.h>
#include <EEPROM.h>
#include <stddef.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>
#include <WiFiClientSecureBearSSL.h>
#include <osapi.h>
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
BearSSL::X509List *vereinskasseTrustAnchor = nullptr;
String apSsid, apPassword, webUser, webPassword;
String clubWifiSsid, clubWifiPassword, wifiCsrfToken;
String vereinskasseApiUrl, rfidDeviceToken, vereinskasseRootCa;
String pairingRequestId, pairingSecret, pairingCode;
String pairingState = "idle";
String pairingMessage = "Noch keine Kopplung gestartet.";
bool pairingActive = false;
unsigned long lastPairingPollAt = 0;
bool wifiSettingsStored = false;
bool serverSettingsStored = false;
bool stationReconnectPending = false;
unsigned long stationReconnectAt = 0;
String lastPushState = "Noch keine Karte Ã¼bertragen.";
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
  Writing,
  Pairing,
  Updating
};

StatusLedMode statusLedMode = StatusLedMode::Starting;
unsigned long statusLedUntil = 0;
unsigned long statusLedLastFrame = 0;
bool statusLedTestActive = false;
unsigned long statusLedTestStartedAt = 0;

bool clockReady();
String jsonStringField(const String &body, const String &name);
String commandApiUrl();
String pairingApiUrl();
String macSuffix();
void maintainStationWifi();

struct WifiSettings {
  char magic[8];
  uint8_t version;
  char ssid[33];
  char password[65];
  uint32_t checksum;
};

struct ServerSettings {
  char magic[8];
  uint8_t version;
  char apiUrl[SERVER_API_URL_MAX_BYTES + 1];
  char deviceToken[SERVER_DEVICE_TOKEN_MAX_BYTES + 1];
  char rootCa[SERVER_ROOT_CA_MAX_BYTES + 1];
  uint32_t checksum;
};

ServerSettings serverSettingsBuffer{};

uint32_t wifiSettingsChecksum(const WifiSettings &settings) {
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&settings);
  uint32_t checksum = 2166136261UL;
  for (size_t i = 0; i < offsetof(WifiSettings, checksum); ++i) {
    checksum ^= bytes[i];
    checksum *= 16777619UL;
  }
  return checksum;
}

uint32_t serverSettingsChecksum(const ServerSettings &settings) {
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&settings);
  uint32_t checksum = 2166136261UL;
  for (size_t i = 0; i < offsetof(ServerSettings, checksum); ++i) {
    checksum ^= bytes[i];
    checksum *= 16777619UL;
  }
  return checksum;
}

String stringFromProgmem(const char *value) {
  String result;
  const size_t length = strlen_P(value);
  result.reserve(length);
  for (size_t i = 0; i < length; ++i) {
    result += static_cast<char>(pgm_read_byte(value + i));
  }
  return result;
}

void rebuildVereinskasseTrustAnchor() {
  if (vereinskasseTrustAnchor) {
    delete vereinskasseTrustAnchor;
    vereinskasseTrustAnchor = nullptr;
  }
  if (vereinskasseRootCa.length() > 100) {
    vereinskasseTrustAnchor = new BearSSL::X509List(vereinskasseRootCa.c_str());
  }
}

void applyCompileTimeServerSettings() {
  vereinskasseApiUrl = VEREINSKASSE_API_URL;
  rfidDeviceToken = RFID_DEVICE_TOKEN;
  vereinskasseRootCa = stringFromProgmem(VEREINSKASSE_ROOT_CA);
  serverSettingsStored = false;
  rebuildVereinskasseTrustAnchor();
}

bool validStoredServerSettings(const ServerSettings &settings) {
  return memcmp(settings.magic, "VK-SRV1", 7) == 0 &&
         settings.version == 1 &&
         settings.apiUrl[sizeof(settings.apiUrl) - 1] == '\0' &&
         settings.deviceToken[sizeof(settings.deviceToken) - 1] == '\0' &&
         settings.rootCa[sizeof(settings.rootCa) - 1] == '\0' &&
         settings.checksum == serverSettingsChecksum(settings);
}

void loadServerSettings() {
  memset(&serverSettingsBuffer, 0, sizeof(serverSettingsBuffer));
  EEPROM.get(SERVER_SETTINGS_EEPROM_ADDRESS, serverSettingsBuffer);
  if (!validStoredServerSettings(serverSettingsBuffer)) {
    applyCompileTimeServerSettings();
    return;
  }
  vereinskasseApiUrl = serverSettingsBuffer.apiUrl;
  rfidDeviceToken = serverSettingsBuffer.deviceToken;
  vereinskasseRootCa = serverSettingsBuffer.rootCa;
  serverSettingsStored = true;
  rebuildVereinskasseTrustAnchor();
}

bool saveServerSettings(const String &apiUrl, const String &deviceToken,
                        const String &rootCa) {
  memset(&serverSettingsBuffer, 0, sizeof(serverSettingsBuffer));
  memcpy(serverSettingsBuffer.magic, "VK-SRV1", 7);
  serverSettingsBuffer.version = 1;
  apiUrl.toCharArray(serverSettingsBuffer.apiUrl, sizeof(serverSettingsBuffer.apiUrl));
  deviceToken.toCharArray(serverSettingsBuffer.deviceToken,
                          sizeof(serverSettingsBuffer.deviceToken));
  rootCa.toCharArray(serverSettingsBuffer.rootCa, sizeof(serverSettingsBuffer.rootCa));
  serverSettingsBuffer.checksum = serverSettingsChecksum(serverSettingsBuffer);
  EEPROM.put(SERVER_SETTINGS_EEPROM_ADDRESS, serverSettingsBuffer);
  if (!EEPROM.commit()) return false;
  vereinskasseHttps.end();
  vereinskasseTls.stop();
  vereinskasseApiUrl = apiUrl;
  rfidDeviceToken = deviceToken;
  vereinskasseRootCa = rootCa;
  serverSettingsStored = true;
  rebuildVereinskasseTrustAnchor();
  return vereinskasseTrustAnchor != nullptr;
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
  text.replace("Ã„", "Ae");
  text.replace("Ã–", "Oe");
  text.replace("Ãœ", "Ue");
  text.replace("Ã¤", "ae");
  text.replace("Ã¶", "oe");
  text.replace("Ã¼", "ue");
  text.replace("ÃŸ", "ss");
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
    case StatusLedMode::Pairing: showStatusDisplay("Kopplung", "Code in App bestaetigen"); break;
    case StatusLedMode::Updating: showStatusDisplay("Firmwareupdate", "Strom nicht trennen"); break;
  }
}

void fillStatusPixels(uint8_t red, uint8_t green, uint8_t blue) {
  const uint32_t color = statusPixels.Color(red, green, blue);
  for (uint16_t i = 0; i < STATUS_LED_COUNT; ++i) statusPixels.setPixelColor(i, color);
  statusPixels.show();
}

void startStatusLedTest() {
  statusLedTestActive = true;
  statusLedTestStartedAt = millis();
  statusLedLastF×N¼æÚ$z{-®éÜj×°¢f–æ—6„6&B‚“²§6öâƒSÂ'µÂ&W'&÷%Â#¥Â%66‡&V–&Vâ¶öæçFRæ–6‡BfW&–f—¦–W'BvW&FVâåÂ'Ò"“²&WGW&ã°¢Ð¢7G&–ær&öG’Ò'µÂ&&Æö6µÂ#¢"²7G&–ær†&Æö6²’²"ÅÂ&†W…Â#¥Â""²'—FW4†W‚†6†V6²Âb’²%Â'Ò#°¢f–æ—6„6&B‚“²§6öâƒ#Â&öG’“°§Ð ¥7G&–ær§6öå7G&–ætf–VÆB†6öç7B7G&–ærf&öG’Â6öç7B7G&–ærfæÖR’°¢6öç7B7G&–ærÖ&¶W"Ò%Â""²æÖR²%Â#¥Â"#°¢–çB7F'BÒ&öG’æ–æFW„öb†Ö&¶W"“°¢–b‡7F'BÂ’&WGW&â"#°¢7F'B³ÒÖ&¶W"æÆVæwF‚‚“°¢6öç7B–çBVæBÒ&öG’æ–æFW„öb‚r"rÂ7F'B“°¢&WGW&âVæBÂò""¢&öG’ç7V'7G&–ær‡7F'BÂVæB“°§Ð ¦–çB§6öä–çDf–VÆB†6öç7B7G&–ærf&öG’Â6öç7B7G&–ærfæÖR’°¢6öç7B7G&–ærÖ&¶W"Ò%Â""²æÖR²%Â#¢#°¢–çB7F'BÒ&öG’æ–æFW„öb†Ö&¶W"“°¢–b‡7F'BÂ’&WGW&âÓ°¢7F'B³ÒÖ&¶W"æÆVæwF‚‚“°¢&WGW&â&öG’ç7V'7G&–ær‡7F'B’çFô–çB‚“°§Ð ¥7G&–ær6öÖÖæD•W&Â‚’°¢&WGW&âfW&V–ç6¶76T•W&Â²"ö6öÖÖæG2#°§Ð ¥7G&–ærf—&×v&TF÷væÆöEW&Â†6öç7B7G&–ærgF‚’°¢6öç7B–çB”Ö&¶W"ÒfW&V–ç6¶76T•W&Âæ–æFW„öb‚"ö’÷&f–B"“°¢–b†”Ö&¶W"ÂÇÂF‚ç7F'G5v—F‚‚"ò"’’&WGW&â"#°¢&WGW&âfW&V–ç6¶76T•W&Âç7V'7G&–ærƒÂ”Ö&¶W"’²Fƒ°§Ð ¦&ööÂ&W÷'DFWf–6T6öÖÖæE&W7VÇB†6öç7B7G&–ærf6öÖÖæD–BÂ6öç7B7G&–ærgV–BÀ¢6öç7B7G&–ærgfÇVRÂ&ööÂ7V66W72À¢6öç7B7G&–ærfW'&÷"’°¢–b‚&Vv–åfW&V–ç6¶76U&WVW7B†6öÖÖæD•W&Â‚’’’&WGW&âfÇ6S°¢fW&V–ç6¶76T‡GG2æFD†VFW"‚$6öçFVçBÕG—R"Â&Æ–6F–öâö§6öâ"“°¢fW&V–ç6¶76T‡GG2æFD†VFW"‚%‚Õ$d”BÕFö¶Vâ"Â&f–DFWf–6UFö¶Vâ“°¢fW&V–ç6¶76T‡GG2æFD†VFW"‚%‚Õ$d”BÔf—&×v&RÕfW'6–öâ"Âd•$Õt$UõdU%4”ôâ“°¢6öç7B7G&–ær&öG’Ò'µÂ&–EÂ#¥Â""²§6öäW66R†6öÖÖæD–B’°¢%Â"ÅÂ'7V66W75Â#¢"²7G&–ær‡7V66W72ò'G'VR"¢&fÇ6R"’°¢"ÅÂ'V–EÂ#¥Â""²§6öäW66R‡V–B’°¢%Â"ÅÂ&†W…Â#¥Â""²§6öäW66R‡fÇVR’°¢%Â"ÅÂ&W'&÷%Â#¥Â""²§6öäW66R†W'&÷"’²%Â'Ò#°¢6öç7B–çB7FGW2ÒfW&V–ç6¶76T‡GG2åõ5B†&öG’“°¢fW&V–ç6¶76T‡GG2æVæB‚“°¢&WGW&â7FGW2ãÒ#bb7FGW2Â3°§Ð ¦&ööÂ&W÷'Ew&—FU&W7VÇB‚’°¢–b‚w&—FU&W7VÇE&VG’’&WGW&âfÇ6S°¢–b‚&Vv–åfW&V–ç6¶76U&WVW7B†6öÖÖæD•W&Â‚’’’&WGW&âfÇ6S°¢fW&V–ç6¶76T‡GG2æFD†VFW"‚$6öçFVçBÕG—R"Â&Æ–6F–öâö§6öâ"“°¢fW&V–ç6¶76T‡GG2æFD†VFW"‚%‚Õ$d”BÕFö¶Vâ"Â&f–DFWf–6UFö¶Vâ“°¢6öç7B7G&–ær&öG’Ò'µÂ&–EÂ#¥Â""²§6öäW66R‡w&—FT6öÖÖæD–B’°¢%Â"ÅÂ'7V66W75Â#¢"²7G&–ær‡w&—FU&W7VÇE7V66W72ò'G'VR"¢&fÇ6R"’°¢"ÅÂ'V–EÂ#¥Â""²§6öäW66R‡w&—FT6öÖÖæEV–B’°¢%Â"ÅÂ&†W…Â#¥Â""²§6öäW66R‡w&—FU&W7VÇD†W‚’°¢%Â"ÅÂ&W'&÷%Â#¥Â""²§6öäW66R‡w&—FU&W7VÇDW'&÷"’²%Â'Ò#°¢6öç7B–çB7FGW2ÒfW&V–ç6¶76T‡GG2åõ5B†&öG’“°¢fW&V–ç6¶76T‡GG2æVæB‚“°¢–b‡7FGW2Â#ÇÂ7FGW2ãÒ3’°¢Æ7EW6…7FFRÒ%66‡&V–&W&vV&æ—2¶öæçFRæ–6‡BvVÖVÆFWBvW&FVâ„…EE"²7G&–ær‡7FGW2’²"’â#°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¤W'&÷"Âƒ“°¢&WGW&âfÇ6S°¢Ð¢Æ7EW6…7FFRÒw&—FU&W7VÇE7V66W70¢ò%$d”BÔ6†—"²w&—FT6öÖÖæEV–B²"&W66‡&–V&VâVæBvW,;ÆgBâ ¢¢%$d”BÕ66‡&V–&fV†ÆW#¢"²w&—FU&W7VÇDW'&÷#°¢6WE7FGW4ÆVB‡w&—FU&W7VÇE7V66W72ò7FGW4ÆVDÖöFS£¥7V66W72¢7FGW4ÆVDÖöFS£¤W'&÷"À¢w&—FU&W7VÇE7V66W72ò#¢##“°¢6W&–Âç&–çFÆâ†Æ7EW6…7FFR“°¢w&—FT6öÖÖæD7F—fRÒfÇ6S°¢w&—FU&W7VÇE&VG’ÒfÇ6S°¢w&—FT6öÖÖæD–BÒ"#°¢&WGW&âG'VS°§Ð §fö–BW&f÷&Õ&VÖ÷FU&W7F'B†6öç7B7G&–ærf6öÖÖæD–B’°¢–b‚&W÷'DFWf–6T6öÖÖæE&W7VÇB†6öÖÖæD–BÂ$DUd”4RÕ$U5D%B"Â""ÂG'VRÂ""’’°¢Æ7EW6…7FFRÒ$æWW7F'B¶öæçFRæ–6‡B&W7L:GF–wBvW&FVââ#°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¤W'&÷"Âƒ“°¢&WGW&ã°¢Ð¢Æ7EW6…7FFRÒ%6–6†W&W"fW&ææWW7F'Bv—&BW6vVl;Æ‡'Bâ#°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¥7F'F–ær“°¢6†÷u7FGW4F—7Æ’‚$æWW7F'B"Â$&—GFR·W'¢v'FVâ"“°¢&VæFW%7FGW4ÆVB‚“°¢6W&–Âç&–çFÆâ†Æ7EW6…7FFR“°¢FVÆ’ƒ3S“°¢U5ç&W7F'B‚“°§Ð §fö–BW&f÷&Ôf—&×v&UWFFR†6öç7B7G&–ærf6öÖÖæD–BÂ6öç7B7G&–ærgF&vWEfW'6–öâÀ¢6öç7B7G&–ærgF‚’°¢6öç7B7G&–ærW&ÂÒf—&×v&TF÷væÆöEW&Â‡F‚“°¢–b‚W&ÂæÆVæwF‚‚’ÇÂF&vWEfW'6–öâæÆVæwF‚‚’ÇÂw&—FT6öÖÖæD7F—fRÇÂVæF–æuV–E&VG’’°¢&W÷'DFWf–6T6öÖÖæE&W7VÇB†6öÖÖæD–BÂ$DUd”4RÔd•$Õt$R"ÂF&vWEfW'6–öâÂfÇ6RÀ¢%WFFR—7BÖöÖVçFâæ–6‡B6–6†W"W6l;Æ‡&&"â"“°¢&WGW&ã°¢Ð¢fW&V–ç6¶76T‡GG2æVæB‚“°¢fW&V–ç6¶76UFÇ2ç7F÷‚“°¢fW&V–ç6¶76UFÇ2ç6WEG'W7Dæ6†÷'2‡fW&V–ç6¶76UG'W7Dæ6†÷"“°¢fW&V–ç6¶76UFÇ2ç6WEF–ÖV÷WBƒS“°¢U5‡GGWFFRç&V&ö÷DöåWFFR†fÇ6R“°¢U5‡GGWFFRæöå7F'B…µÒ°¢Æ7EW6…7FFRÒ$f—&×v&Rv—&B6–6†W"vVÆFVâVæB–ç7FÆÆ–W'Bâ#°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¥WFF–ær“°¢6†÷u7FGW4F—7Æ’‚$f—&×v&WWFFR"Â%7G&öÒæ–6‡BG&VææVâ"“°¢&VæFW%7FGW4ÆVB‚“°¢Ò“°¢U5‡GGWFFRæöå&öw&W72…µÒ†–çB7W'&VçBÂ–çBF÷FÂ’°¢U5çvGDfVVB‚“°¢–b‡F÷FÂâ’Æ7EW6…7FFRÒ$f—&×v&WWFFS¢"²7G&–ær‚†7W'&VçB¢’òF÷FÂ’²"R#°¢&VæFW%7FGW4ÆVB‚“°¢Ò“°¢U5‡GGWFFRæöäW'&÷"…µÒ†–çBW'&÷"’°¢Æ7EW6…7FFRÒ$f—&×v&WWFFRfV†ÆvW66†ÆvVã¢"²7G&–ær†W'&÷"’²"â#°¢Ò“°¢6öç7BEö‡GGWFFU÷&WGW&â&W7VÇBÒU5‡GGWFFRçWFFR‡fW&V–ç6¶76UFÇ2ÂW&ÂÂd•$Õt$UõdU%4”ôâ“°¢fW&V–ç6¶76UFÇ2ç7F÷‚“°¢–b‡&W7VÇBÒ…EEõUDDUôô²’°¢6öç7B7G&–ærW'&÷"Ò&W7VÇBÓÒ…EEõUDDUôäõõUDDU0¢ò$f—&×v&R—7B&W&V—G2·GVVÆÂâ ¢¢7G&–ær„U5‡GGWFFRævWDÆ7DW'&÷%7G&–ær‚’æ5÷7G"‚’“°¢&W÷'DFWf–6T6öÖÖæE&W7VÇB†6öÖÖæD–BÂ$DUd”4RÔd•$Õt$R"ÂF&vWEfW'6–öâÂfÇ6RÂW'&÷"“°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¤W'&÷"Â#C“°¢&WGW&ã°¢Ð¢–b‚&W÷'DFWf–6T6öÖÖæE&W7VÇB†6öÖÖæD–BÂ$DUd”4RÔd•$Õt$R"ÂF&vWEfW'6–öâÂG'VRÂ""’¢Æ7EW6…7FFRÒ$f—&×v&R–ç7FÆÆ–W'C²&W7L:GF–wVærföÆwBæ6‚FVÒæWW7F'Bâ#°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¥7V66W72Âs“°¢6†÷u7FGW4F—7Æ’‚%WFFRfW'F–r"Â$ÆW6W"7F'FWBæWR"“°¢&VæFW%7FGW4ÆVB‚“°¢FVÆ’ƒS“°¢U5ç&W7F'B‚“°§Ð §fö–BöÆÅw&—FT6öÖÖæB‚’°¢–b‚W6„6öæf–wW&VB‚’ÇÂv”f’ç7FGW2‚’ÒtÅô4ôääT5DTBÇÂ6Æö6µ&VG’‚’’&WGW&ã°¢–b‡VæF–æuV–E&VG’’&WGW&ã°¢–b‡w&—FT6öÖÖæD7F—fR’°¢–b‡w&—FU&W7VÇE&VG’’&W÷'Ew&—FU&W7VÇB‚“°¢&WGW&ã°¢Ð¢6öç7BVç6–væVBÆöæræ÷rÒÖ–ÆÆ—2‚“°¢–b†Æ7DÖ–çFVææ6U&WVW7DBbbæ÷rÒÆ7DÖ–çFVææ6U&WVW7DBÂÔ”åDTää4Uõ$”õ$•E•ôÕ2’&WGW&ã°¢–b†æ÷rÒÆ7D6öÖÖæEöÆÄBÂ$d”Eô4ôÔÔäEõôÄÅô”åDU%dÅôÕ2’&WGW&ã°¢Æ7D6öÖÖæEöÆÄBÒæ÷s° ¢–b‚&Vv–åfW&V–ç6¶76U&WVW7B†6öÖÖæD•W&Â‚’’’&WGW&ã°¢fW&V–ç6¶76T‡GG2æFD†VFW"‚%‚Õ$d”BÕFö¶Vâ"Â&f–DFWf–6UFö¶Vâ“°¢fW&V–ç6¶76T‡GG2æFD†VFW"‚%‚Õ$d”BÔf—&×v&RÕfW'6–öâ"Âd•$Õt$UõdU%4”ôâ“°¢–b†Æ7DF—7Æ•&Wf—6–öâæÆVæwF‚‚’¢fW&V–ç6¶76T‡GG2æFD†VFW"‚%‚ÔF—7Æ’Õ&Wf—6–öâ"ÂÆ7DF—7Æ•&Wf—6–öâ“°¢6öç7B–çB7FGW2ÒfW&V–ç6¶76T‡GG2ätUB‚“°¢6öç7B7G&–ær&W7öç6RÒ7FGW2ÓÒ#òfW&V–ç6¶76T‡GG2ævWE7G&–ær‚’¢"#°¢fW&V–ç6¶76T‡GG2æVæB‚“°¢–b‡7FGW2ÓÒ#B’&WGW&ã°¢–b‡7FGW2Ò#’°¢–b‡7FGW2â’°¢Æ7EW6…7FFRÒ%66‡&V–&VgG&rÔ&g&vS¢…EE"²7G&–ær‡7FGW2’²"â#°¢ÒVÇ6R°¢6†"FÇ4W'&÷%³#ÒÒ·Ó°¢6öç7B–çBFÇ46öFRÒfW&V–ç6¶76UFÇ2ævWDÆ7E54ÄW'&÷"‡FÇ4W'&÷"Â6—¦Vöb‡FÇ4W'&÷"’“°¢Æ7EW6…7FFRÒ%66‡&V–&VgG&rÔ&g&vS¢"²7G&–ær„…EE6Æ–VçC£¦W'&÷%Fõ7G&–ær‡7FGW2’æ5÷7G"‚’“°¢–b‡FÇ46öFR’Æ7EW6…7FFR³Ò"+rDÅ2"²7G&–ær‡FÇ46öFR’²#¢"²7G&–ær‡FÇ4W'&÷"“°¢Ð¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¤W'&÷"ÂC“°¢–b†Ö–ÆÆ—2‚’ÒÆ7D6öÖÖæDW'&÷$ÆötBãÒS’°¢Æ7D6öÖÖæDW'&÷$ÆötBÒÖ–ÆÆ—2‚“°¢6W&–Âç&–çFÆâ†Æ7EW6…7FFR“°¢Ð¢&WGW&ã°¢Ð ¢6öç7B7G&–ær–BÒ§6öå7G&–ætf–VÆB‡&W7öç6RÂ&–B"“°¢6öç7B7G&–ær7F–öâÒ§6öå7G&–ætf–VÆB‡&W7öç6RÂ&7F–öâ"“°¢–b†7F–öâÓÒ&F—7Æ’"’°¢Æ7DF—7Æ•&Wf—6–öâÒ§6öå7G&–ætf–VÆB‡&W7öç6RÂ'&Wf—6–öâ"“°¢F—7Æ”÷&FW$7F—fRÒ§6öå7G&–ætf–VÆB‡&W7öç6RÂ'7FFR"’ÓÒ&6'B#°¢F—7Æ”÷&FW$7W7FöÖW"Ò§6öå7G&–ætf–VÆB‡&W7öç6RÂ&7W7FöÖW$æÖR"“°¢F—7Æ”÷&FW$—FV×2Ò§6öå7G&–ætf–VÆB‡&W7öç6RÂ&—FV×5FW‡B"“°¢F—7Æ”÷&FW$—FVÔ6÷VçBÒÖ‚ƒÂ§6öä–çDf–VÆB‡&W7öç6RÂ&—FVÔ6÷VçB"’“°¢F—7Æ”÷&FW%F÷FÄ6VçG2ÒÖ‚ƒÂ§6öä–çDf–VÆB‡&W7öç6RÂ'F÷FÄ6VçG2"’“°¢F—7Æ”÷&FW%WFFVDBÒÖ–ÆÆ—2‚“°¢–b‚F—7Æ”÷&FW$7F—fR’°¢F—7Æ”÷&FW$7F—fRÒfÇ6S°¢F—7Æ•&VG•6–æ6RÒÖ–ÆÆ—2‚“°¢–b‡7FGW4ÆVDÖöFRÓÒ7FGW4ÆVDÖöFS£¥&VG’¢6†÷u7FGW4F—7Æ’‚%$d”B&W&V—B"Â$¶'FRVfÆVvVâ"“°¢ÒVÇ6R–b‡7FGW4ÆVDÖöFRÓÒ7FGW4ÆVDÖöFS£¥&VG’’°¢6†÷t÷&FW$F—7Æ’‚“°¢Ð¢&WGW&ã°¢Ð¢–b†–BæÆVæwF‚‚’bb7F–öâÓÒ'&W7F'B"’°¢W&f÷&Õ&VÖ÷FU&W7F'B†–B“°¢&WGW&ã°¢Ð¢–b†–BæÆVæwF‚‚’bb7F–öâÓÒ&f—&×v&R"’°¢W&f÷&Ôf—&×v&UWFFR†–BÂ§6öå7G&–ætf–VÆB‡&W7öç6RÂ'fW'6–öâ"’À¢§6öå7G&–ætf–VÆB‡&W7öç6RÂ&f—&×v&UW&Â"’“°¢&WGW&ã°¢Ð¢6öç7B7G&–ærV–BÒ§6öå7G&–ætf–VÆB‡&W7öç6RÂ'V–B"“°¢6öç7B7G&–ær–ÆöBÒ§6öå7G&–ætf–VÆB‡&W7öç6RÂ&†W‚"“°¢6öç7B–çB&Æö6²Ò§6öä–çDf–VÆB‡&W7öç6RÂ&&Æö6²"“°¢'—FR'6VE³eÓ°¢–b‚–BæÆVæwF‚‚’ÇÂV–BæÆVæwF‚‚’ÇÂ&Æö6²ÂÇÂ—5G&–ÆW"†&Æö6²’ÇÀ¢'6T†W‚‡–ÆöBÂ'6VBÂb’’°¢Æ7EW6…7FFRÒ%Væ|;ÆÇF–vW"$d”BÕ66‡&V–&VgG&rV×fævVââ#°¢&WGW&ã°¢Ð¢w&—FT6öÖÖæD–BÒ–C°¢w&—FT6öÖÖæEV–BÒV–C°¢w&—FT6öÖÖæD†W‚Ò–ÆöC°¢w&—FT6öÖÖæD&Æö6²Ò&Æö6³°¢w&—FT6öÖÖæD7F—fRÒG'VS°¢w&—FU&W7VÇE&VG’ÒfÇ6S°¢w&—FU&W7VÇE7V66W72ÒfÇ6S°¢w&—FU&W7VÇD†W‚Ò"#°¢w&—FU&W7VÇDW'&÷"Ò"#°¢Æ7EW6…7FFRÒ%66‡&V–&VgG&r&W&V—C¢¶'FR"²V–B²"VfÆVvVââ#°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¥w&—FUv—F–ær“°¢6W&–Âç&–çFÆâ†Æ7EW6…7FFR“°§Ð §fö–B&ö6W75w&—FT6öÖÖæB‚’°¢–b‚w&—FT6öÖÖæD7F—fRÇÂw&—FU&W7VÇE&VG’’&WGW&ã°¢–b‚&f–Bå”45ô—4æWt6&E&W6VçB‚’ÇÂ&f–Bå”45õ&VD6&E6W&–Â‚’’&WGW&ã°¢6öç7B7G&–ær66ææVEV–BÒV–D†W‚‚“°¢–b‡66ææVEV–BÒw&—FT6öÖÖæEV–B’°¢f–æ—6„6&B‚“°¢Æ7EW6…7FFRÒ$fÇ66†R¶'FR"²66ææVEV–B²"(	2W'v'FWBv—&B"²w&—FT6öÖÖæEV–B²"â#°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¤W'&÷"ÂC“°¢&WGW&ã°¢Ð ¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¥w&—F–ær“°¢6öç7B–çB&Æö6·2Ò6Æ76–4&Æö6·2‡&f–Bå”45ôvWEG—R‡&f–BçV–Bç6²’“°¢'—FR–ÆöE³eÒÆ6†V6µ³…Ó¶'—FR6†V6´ÆVã×6—¦Vöb†6†V6²“°¢7G&–ærW'&÷#°¢Ôe$3S##£¤Ô”d$Uô¶W’¶W“°¢f÷"†'—FR“Ó¶“Ãc²²¶’’¶W’æ¶W”'—FU¶•ÓÓ„dc°¢–b‚&Æö6·2ÇÂw&—FT6öÖÖæD&Æö6²ãÒ&Æö6·2ÇÂw&—FT6öÖÖæD&Æö6²ÓÒÇÂ—5G&–ÆW"‡w&—FT6öÖÖæD&Æö6²’’°¢W'&÷"Ò$&Æö6²—7BVbF–W6W"¶'FRæ–6‡B&W66‡&V–&&"â#°¢ÒVÇ6R–b‚'6T†W‚‡w&—FT6öÖÖæD†W‚Â–ÆöBÂb’’°¢W'&÷"Ò%66‡&V–&FFVâ6–æBVæ|;ÆÇF–râ#°¢ÒVÇ6R–b‚WF†VçF–6FT&Æö6²‡w&—FT6öÖÖæD&Æö6²Æ¶W’ÄÔe$3S##£¥”45ô4ÔEôÔeôUD…ô´U•ôÆW'&÷"’’°¢òòWF†VçF–6FT&Æö6²6WG§BF–RvVæVRfV†ÆW&ÖVÆGVærà¢ÒVÇ6R°¢WFò7FGW3×&f–BäÔ”d$Uõw&—FR‡w&—FT6öÖÖæD&Æö6²Ç–ÆöBÃb“°¢–b‡7FGW2ÔÔe$3S##£¥5DEU5ôô²’W'&÷#Ò%66‡&V–&VâfV†ÆvW66†ÆvVã¢"µ7G&–ær‡&f–BävWE7FGW46öFTæÖR‡7FGW2’“°¢VÇ6R°¢7FGW3×&f–BäÔ”d$Uõ&VB‡w&—FT6öÖÖæD&Æö6²Æ6†V6²Âf6†V6´ÆVâ“°¢–b‡7FGW2ÔÔe$3S##£¥5DEU5ôô·ÇÆÖVÖ6×‡–ÆöBÆ6†V6²Ãb’Ó–W'&÷#Ò%,;Æ6¶ÆW6Vâ¶öæçFRF–RFFVâæ–6‡B&W7L:GF–vVââ#°¢VÇ6R°¢w&—FU&W7VÇE7V66W73×G'VS°¢w&—FU&W7VÇD†WƒÖ'—FW4†W‚†6†V6²Ãb“°¢Ð¢Ð¢Ð¢f–æ—6„6&B‚“°¢–b‚w&—FU&W7VÇE7V66W72’°¢w&—FU&W7VÇDW'&÷#ÖW'&÷"æÆVæwF‚‚“öW'&÷#¢%Væ&V¶æçFW"66‡&V–&fV†ÆW"â#°¢w&—FU&W7VÇD†WƒÒ"#°¢ÒVÇ6Rw&—FU&W7VÇDW'&÷#Ò"#°¢w&—FU&W7VÇE&VG“×G'VS°¢&W÷'Ew&—FU&W7VÇB‚“°§Ð ¥7G&–ærÖ57Vff—‚‚’°¢6†"'Ve³uÓ°¢6ç&–çFb†'VbÂ6—¦Vöb†'Vb’Â"Se‚"ÂU5ævWD6†—–B‚’b„dddddb“°¢&WGW&â7G&–ær†'Vb“°§Ð §fö–B6WGW‚’°¢6W&–Âæ&Vv–âƒS#“°¢FVÆ’ƒ3“°¢U5çvGDVæ&ÆRƒƒ“°¢7FGW5—†VÇ2æ&Vv–â‚“°¢7FGW5—†VÇ2ç6WD'&–v‡FæW72…5DEU5ôÄTEô%$”t…DäU52“°¢7FGW5—†VÇ2æ6ÆV"‚“°¢7FGW5—†VÇ2ç6†÷r‚“°¢7F'E7FGW4ÆVEFW7B‚“°¢v†–ÆR‡7FGW4ÆVEFW7D7F—fR’°¢&VæFW%7FGW4ÆVB‚“°¢U5çvGDfVVB‚“°¢FVÆ’ƒ"“°¢Ð¢6WGW7FGW4F—7Æ’‚“°¢6WE7FGW4ÆVB…7FGW4ÆVDÖöFS£¥7F'F–ær“°¢&VæFW%7FGW4ÆVB‚“°¢5’æ&Vv–â‚“°¢&f–Bå4Eô–æ—B‚“°¢FVÆ’ƒB“° ¢6öç7B7G&–ær–BÒÖ57Vff—‚‚“°¢76–BÒ7G&ÆVâ„5U5DôÕôõ54”B’ò5U5DôÕôõ54”B¢$äd2Õ&VFW"Ò"²–C°¢77v÷&BÒ7G&ÆVâ„5U5DôÕôõ55tõ$B’ò5U5DôÕôõ55tõ$B¢$äd2Ò"²–B²"Õ6WGW#°¢vV%W6W"Ò5U5DôÕõtT%õU4U#°¢vV%77v÷&BÒ7G&ÆVâ„5U5DôÕõtT%õ55tõ$B’ò5U5DôÕõtT%õ55tõ$B¢%vV"Ò"²–B²"ÔÆöv–â#°¢v–f”77&eFö¶VâÒ–B²"Ò"²7G&–ær„U5ævWD7–6ÆT6÷VçB‚’Â„U‚’²"Ò"²7G&–ær†Ö–7&÷2‚’Â„U‚“°¢ÆöEv–f•6WGF–æw2‚“°¢ÆöE6W'fW%6WGF–æw2‚“° ¢òòFW"v'GVæw2Ô&ÆV–'B–ÖÖW"W'&V–6†&"â&ÆÆVÂfW&&–æFWB6–6‚FW ¢òòU5ƒ#cbÇ27FF–öâÖ—BFVÒfW&V–ç2ÕtÄâVæB6VæFWB66ç2W"…EE2à¢v”f’æÖöFR…t”d•ôõ5D“°¢v”f’ç6WE6ÆVWÖöFR…t”d•ôäôäUõ4ÄTU“°¢v”f’çW'6—7FVçB†fÇ6R“°¢v”f’ç6WDWFõ&V6öææV7B‡G'VR“°¢–b‚v”f’ç6ögD†76–Bæ5÷7G"‚’Â77v÷&Bæ5÷7G"‚’ÂbÂfÇ6RÂ"’’°¢6W&–Âç&–çFÆâ‚$dT„ÄU#¢tÄâÔ¶öæçFRæ–6‡BvW7F'FWBvW&FVââ"“°¢Ð¢Ö–çF–å7FF–öåv–f’‚“° ¢6W'fW"æöâ‚"ò"Â…EEôtUBÂµÒ°¢–b‚WF†÷&—¦VB‚’’&WGW&ã°¢6W'fW"ç6VæD†VFW"‚$66†RÔ6öçG&öÂ"Â&æò×7F÷&R"“°¢6W'fW"ç6VæEõƒ#Â'FW‡Bö‡FÖÃ²6†'6WC×WFbÓ‚"Â”äDU…ô…DÔÂ“°¢Ò“°¢6W'fW"æöâ‚"ö’÷V–B"Â…EEôtUBÂ†æFÆUV–B“°¢6W'fW"æöâ‚"ö’÷7FGW2"Â…EEôtUBÂ†æFÆU7FGW2“°¢6W'fW"æöâ‚"ö’öÆVB×FW7B"Â…EEõõ5BÂ†æFÆTÆVEFW7B“°¢6W'fW"æöâ‚"ö’÷v–f’"Â…EEõõ5BÂ†æFÆUv–f•6fR“°¢6W'fW"æöâ‚"ö’÷v–f’"Â…EEôDTÄUDRÂ†æFÆUv–f”FVÆWFR“°¢6W'fW"æöâ‚"ö’÷v–f’÷66â"Â…EEôtUBÂ†æFÆUv–f•66â“°¢6W'fW"æöâ‚"ö’÷6W'fW""Â…EEôtUBÂ†æFÆU6W'fW%6WGF–æw4vWB“°¢6W'fW"æöâ‚"ö’÷6W'fW""Â…EEõõ5BÂ†æFÆU6W'fW%6WGF–æw56fR“°¢6W'fW"æöâ‚"ö’÷6W'fW"÷FW7B"Â…EEõõ5BÂ†æFÆU6W'fW$6öææV7F–öåFW7B“°¢6W'fW"æöâ‚"ö’÷—"÷7F'B"Â…EEõõ5BÂ†æFÆU—&–æu7F'B“°¢6W'fW"æöâ‚"ö’÷&VB"Â…EEõõ5BÂ†æFÆU&VB“°¢6W'fW"æöâ‚"ö’÷w&—FR"Â…EEõõ5BÂ†æFÆUw&—FR“°¢6W'fW"æöäæ÷Df÷VæB…µÒ²–b†WF†÷&—¦VB‚’’§6öâƒCBÂ'µÂ&W'&÷%Â#¥Â$æ–6‡BvVgVæFVâåÂ'Ò"“²Ò“°¢6W'fW"æ&Vv–â‚“° ¢6W&–Âç&–çFÆâ‚%ÆãÓÓÒæöFTÔ5Rc2äd2õ$d”BÓÓÒ"“°¢6W&–Âç&–çFb‚$f—&×v&S¢W5Æâ"Âd•$Õt$UõdU%4”ôâ“°¢6W&–Âç&–çFb‚%$3S#"fW'6–öã¢‚S%…Æâ"Â&f–Bå4Eõ&VE&Vv—7FW"„Ôe$3S##£¥fW'6–öå&Vr’“°¢6W&–Âç&–çFb‚%tÄã¢W5ÆåtÄâÔ¶Væçv÷'C¢W5Æâ"Â76–Bæ5÷7G"‚’Â77v÷&Bæ5÷7G"‚’“°¢6W&–Âç&–çFb‚$G&W76S¢‡GG¢òòW5ÆåvV"Ô&VçWG¦W#¢W5ÆåvV"Ô¶Væçv÷'C¢W5Æâ"À¢v”f’ç6ögD•‚’çFõ7G&–ær‚’æ5÷7G"‚’ÂvV%W6W"æ5÷7G"‚’ÂvV%77v÷&Bæ5÷7G"‚’“°¢–b‚7FF–öä6öæf–wW&VB‚’’°¢6W&–Âç&–çFÆâ‚%fW&V–ç6¶76S¢æö6‚æ–6‡BV–ævW&–6‡FWB†–æ6ÇVFR÷6V7&WG2æ‚fV†ÇBöFW"tÄâÆVW"’â"“°¢ÒVÇ6R–b‚W6„6öæf–wW&VB‚’’°¢6W&–Âç&–çFÆâ‚%fW&V–ç6¶76S¢tÄâV–ævWG&vVâÂ&W"Fö¶VâöFW"&ö÷BÔ4fV†ÇBâ"“°¢ÒVÇ6R°¢6W&–Âç&–çFÆâ‚%fW&V–ç6¶76S¢6–6†W&RT”BÜ9Æ&W'G&wVær—7BV–ævW&–6‡FWBâ"“°¢6W&–Âç&–çFb‚$¶76Vç6W'fW#¢W5Æâ"ÂfW&V–ç6¶76T•W&Âæ5÷7G"‚’“°¢Ð§Ð §fö–BÆö÷‚’°¢U5çvGDfVVB‚“°¢6W'fW"æ†æFÆT6Æ–VçB‚“°¢&ö6W757FF–öå&V6öææV7B‚“°¢Ö–çF–å7FF–öåv–f’‚“°¢òò¶'FVç66ç2†&Vâf÷'&ærf÷"FW"Ææw6ÖW&Vâ…EE2Ô&g&vRæ6€¢òò66‡&V–&VgG,:FvVâÂFÖ—BV–âÖ—FvÆ–VFW'vV6‡6VÂ6öf÷'BW&¶æçBv—&Bà¢WFöÖF–5V–E66â‚“°¢&WG'•VæF–æuV–B‚“°¢Ö–çF–å&f–E&VFW"‚“°¢öÆÅ—&–æt&÷fÂ‚“°¢öÆÅw&—FT6öÖÖæB‚“°¢&ö6W75w&—FT6öÖÖæB‚“°¢6VÆe&V6÷fW$–e7FÆÆVB‚“°¢&VæFW%7FGW4ÆVB‚“°¢FVÆ’ƒ"“°§Ð