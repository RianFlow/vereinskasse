#include <Arduino.h>
#include <time.h>
#include <sys/time.h>
#include <SPI.h>
#include <Wire.h>
#include <EEPROM.h>
#include <stddef.h>
#include <memory>
#include <string>
#if defined(CLUBIQ_ESP32_BLE)
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiClientSecure.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <BLESecurity.h>
#include <Update.h>
#include <esp_system.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>
#else
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266httpUpdate.h>
#include <WiFiClientSecureBearSSL.h>
#include <osapi.h>
#endif
#include <MFRC522.h>
#include <Adafruit_NeoPixel.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "web_ui.h"

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);
#if defined(CLUBIQ_ESP32_BLE)
WebServer server(80);
#else
ESP8266WebServer server(80);
#endif
Adafruit_NeoPixel statusPixels(STATUS_LED_COUNT, PIN_STATUS_LED, NEO_GRB + NEO_KHZ800);
Adafruit_SSD1306 statusDisplay(
    STATUS_DISPLAY_WIDTH, STATUS_DISPLAY_HEIGHT, &Wire, -1);
#if defined(CLUBIQ_ESP32_BLE)
WiFiClientSecure vereinskasseTls;
HTTPUpdate clubiqHttpUpdate;
#else
BearSSL::WiFiClientSecure vereinskasseTls;
BearSSL::X509List *vereinskasseTrustAnchor = nullptr;
#endif
HTTPClient vereinskasseHttps;
String apSsid, apPassword, webUser, webPassword;
String clubWifiSsid, clubWifiPassword, wifiCsrfToken;
String vereinskasseApiUrl, rfidDeviceToken, vereinskasseRootCa;
String pairingRequestId, pairingSecret, pairingCode;
String pairingDeviceName;
String pairingState = "idle";
String pairingMessage = "Noch keine Kopplung gestartet.";
bool pairingActive = false;
unsigned long lastPairingPollAt = 0;
bool wifiSettingsStored = false;
bool serverSettingsStored = false;
bool maintenanceApActive = false;
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
unsigned long stationConnectedAt = 0;
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

#if defined(CLUBIQ_ESP32_BLE)
constexpr char BLE_SERVICE_UUID[] = "4a4f0001-7b5a-4f52-8844-434c55424951";
constexpr char BLE_RX_UUID[] = "4a4f0002-7b5a-4f52-8844-434c55424951";
constexpr char BLE_TX_UUID[] = "4a4f0003-7b5a-4f52-8844-434c55424951";
constexpr char BLE_OTA_UUID[] = "4a4f0004-7b5a-4f52-8844-434c55424951";
BLECharacteristic *bleTx = nullptr;
BLECharacteristic *bleOta = nullptr;
String bleReceiveBuffer;
String blePendingCommand;
bool bleClientConnected = false;
volatile bool bleCommandPending = false;
bool bleSetupInProgress = false;
bool blePairingSent = false;
bool bleReuseExistingIdentity = false;
bool bleProvisioningAuthorized = false;
bool blePhysicalConfirmationPending = false;
String bleDeferredProvisionCommand;
unsigned long bleLastProgressAt = 0;
unsigned long blePhysicalConfirmationUntil = 0;
constexpr unsigned long BLE_PHYSICAL_CONFIRMATION_MS = 90000;
constexpr unsigned long BLE_SESSION_MAX_MS = 11UL * 60UL * 1000UL;
constexpr unsigned long BLE_SCAN_RETRY_MS = 850;
constexpr unsigned long BLE_HEARTBEAT_MS = 10000;
bool bleSessionActive = false;
String bleSessionId, bleSessionNonce, bleHelloNonce;
unsigned long bleSessionStartedAt = 0;
uint32_t bleSessionCounter = 0;
bool blePendingScanReady = false;
String blePendingScanUid, blePendingScanType;
int blePendingScanBlocks = 0;
uint32_t blePendingScanCounter = 0;
unsigned long bleLastScanNotifyAt = 0;
unsigned long bleLastHeartbeatAt = 0;
String blePairTokenHash;
String blePairProof;
bool bleCommandResultPending = false;
String bleResultCommandId, bleResultUid, bleResultValue, bleResultError;
bool bleResultSuccess = false;
bool bleRestartAfterResult = false;
unsigned long bleLastResultNotifyAt = 0;
bool bleOtaActive = false;
size_t bleOtaExpectedSize = 0;
size_t bleOtaWritten = 0;
String bleOtaExpectedSha, bleOtaTargetVersion, bleOtaCommandId;
unsigned long bleOtaLastProgressAt = 0;
mbedtls_sha256_context bleOtaShaContext;
#endif

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
String hardwareId();
bool directBleRuntimeMode();
void startReaderWifi();
void startMaintenanceAp();
void stopMaintenanceAp();
void maintainStationWifi();
#if defined(CLUBIQ_ESP32_BLE)
void disableWifiForBleRuntime();
void bleNotifyJson(const String &payload);
void processBleRuntime();
void rejectBleProvisioning(const String &message);
bool bleIdentityConfigured();
String bytesToLowerHex(const unsigned char *bytes, size_t length);
bool constantTimeHexEquals(const String &left, const String &right);
String sha256Hex(const String &value);
String bleHmac(const String &message, const String &token = "");
bool verifyBleHmac(const String &message, const String &signature,
                   const String &token = "");
void sendBlePendingScan();
#endif

uint32_t secureRandomWord() {
#if defined(CLUBIQ_ESP32_BLE)
  return esp_random();
#else
  return os_random();
#endif
}

void enableWatchdog() {
#if !defined(CLUBIQ_ESP32_BLE)
  ESP.wdtEnable(8000);
#endif
}

void feedWatchdog() {
#if defined(CLUBIQ_ESP32_BLE)
  delay(0);
#else
  ESP.wdtFeed();
#endif
}

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
#if defined(CLUBIQ_ESP32_BLE)
  if (vereinskasseRootCa.length() > 100) {
    vereinskasseTls.setCACert(vereinskasseRootCa.c_str());
  }
#else
  if (vereinskasseTrustAnchor) {
    delete vereinskasseTrustAnchor;
    vereinskasseTrustAnchor = nullptr;
  }
  if (vereinskasseRootCa.length() > 100) {
    vereinskasseTrustAnchor = new BearSSL::X509List(vereinskasseRootCa.c_str());
  }
#endif
}

bool trustAnchorReady() {
#if defined(CLUBIQ_ESP32_BLE)
  return vereinskasseRootCa.length() > 100;
#else
  return vereinskasseTrustAnchor != nullptr;
#endif
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
  const bool bleOnlyIdentity = !apiUrl.length() && !rootCa.length() && deviceToken.length() >= 24;
  return bleOnlyIdentity || trustAnchorReady();
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
  statusLedLastFrame = 0;
}

bool renderStatusLedTest(unsigned long now) {
  if (!statusLedTestActive) return false;
  const unsigned long step = (now - statusLedTestStartedAt) / STATUS_LED_TEST_STEP_MS;
  if (step < STATUS_LED_COUNT) {
    statusPixels.clear();
    for (uint16_t i = 0; i <= step; ++i)
      statusPixels.setPixelColor(i, statusPixels.Color(255, 255, 255));
    statusPixels.show();
    return true;
  }
  if (step == STATUS_LED_COUNT) {
    fillStatusPixels(255, 0, 0);
    return true;
  }
  if (step == STATUS_LED_COUNT + 1) {
    fillStatusPixels(0, 255, 0);
    return true;
  }
  if (step == STATUS_LED_COUNT + 2) {
    fillStatusPixels(0, 0, 255);
    return true;
  }
  if (step == STATUS_LED_COUNT + 3) {
    fillStatusPixels(255, 255, 255);
    return true;
  }
  statusLedTestActive = false;
  statusLedLastFrame = 0;
  statusPixels.clear();
  statusPixels.show();
  return false;
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
  if (renderStatusLedTest(now)) return;
  if (statusLedMode == StatusLedMode::Ready && !displayOrderActive &&
      displayReadySince && now - displayReadySince >= STATUS_DISPLAY_SCREENSAVER_MS) {
    showClubLogo();
  }

  const uint8_t phase = (now / 8) % 160;
  const uint8_t pulse = 55 + (phase < 80 ? phase : 159 - phase) * 2;
  const bool flash = (now / 180) % 2 == 0;
  switch (statusLedMode) {
    case StatusLedMode::Starting: fillStatusPixels(pulse, pulse / 3, 0); break;
    case StatusLedMode::Connecting: fillStatusPixels(0, 0, pulse); break;
    case StatusLedMode::Ready: fillStatusPixels(0, 110, 90); break;
    case StatusLedMode::Scanning: fillStatusPixels(165, 0, 220); break;
    case StatusLedMode::Success: fillStatusPixels(0, 255, 30); break;
    case StatusLedMode::Error: fillStatusPixels(flash ? 255 : 12, 0, 0); break;
    case StatusLedMode::WriteWaiting: fillStatusPixels(pulse, 0, pulse); break;
    case StatusLedMode::Writing: fillStatusPixels(185, 0, 255); break;
    case StatusLedMode::Pairing: fillStatusPixels(255, pulse / 2, 0); break;
    case StatusLedMode::Updating: fillStatusPixels(0, pulse, pulse); break;
  }
}

bool stationConfigured() {
  return clubWifiSsid.length() > 0;
}

bool pushConfigured() {
  return stationConfigured() &&
         rfidDeviceToken.length() >= 24 &&
         vereinskasseApiUrl.startsWith("https://") &&
         trustAnchorReady();
}

bool pairingConfigured() {
  return stationConfigured() &&
         vereinskasseApiUrl.startsWith("https://") &&
         trustAnchorReady();
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

bool syncClockFromKiosk() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClient client;
  HTTPClient clockRequest;
  clockRequest.setTimeout(HTTPS_TIMEOUT_MS);
  if (!clockRequest.begin(client, KIOSK_TIME_URL)) return false;
  const int status = clockRequest.GET();
  const String body = status == 200 ? clockRequest.getString() : "";
  clockRequest.end();
  const time_t epoch = static_cast<time_t>(strtoul(body.c_str(), nullptr, 10));
  if (status != 200 || epoch <= 1700000000) return false;
  timeval currentTime{epoch, 0};
  settimeofday(&currentTime, nullptr);
  lastPushState = "Sichere Uhrzeit vom lokalen ClubIQ-Server geladen.";
  return clockReady();
}

void resetVereinskasseConnection() {
  // Ein fehlgeschlagener TLS-Aufbau darf nicht im globalen Client haengen
  // bleiben. Das ist besonders wichtig direkt nach einem WLAN-Wechsel.
  vereinskasseHttps.end();
  vereinskasseTls.stop();
}

bool beginVereinskasseRequest(const String &url) {
  if (!trustAnchorReady()) return false;
  resetVereinskasseConnection();
#if defined(CLUBIQ_ESP32_BLE)
  vereinskasseTls.setCACert(vereinskasseRootCa.c_str());
#else
  vereinskasseTls.setTrustAnchors(vereinskasseTrustAnchor);
#endif
  vereinskasseTls.setTimeout(HTTPS_TIMEOUT_MS);
  vereinskasseHttps.setTimeout(HTTPS_TIMEOUT_MS);
  // Lokale Requests sind klein. Ein frischer Socket ist stabiler als ein
  // wiederverwendeter Client nach Funk- oder Serverunterbrechungen.
  vereinskasseHttps.setReuse(false);
  return vereinskasseHttps.begin(vereinskasseTls, url);
}

void beginClockSync() {
  if (timeSyncStarted || WiFi.status() != WL_CONNECTED) return;
  if (syncClockFromKiosk()) {
    timeSyncStarted = true;
    return;
  }
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
    lastPushState = "ClubIQ-Kassen-WLAN nicht verbunden.";
    return false;
  }
  if (!clockReady()) {
    beginClockSync();
    lastPushState = "Warte auf sichere Uhrzeit für TLS.";
    return false;
  }

  if (!beginVereinskasseRequest(vereinskasseApiUrl)) {
    lastPushState = "HTTPS-Verbindung konnte nicht vorbereitet werden.";
    return false;
  }

  vereinskasseHttps.addHeader("Content-Type", "application/json");
  vereinskasseHttps.addHeader("X-RFID-Token", rfidDeviceToken);
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
                 "\",\"serverUrl\":\"" + jsonEscape(vereinskasseApiUrl) +
                 "\",\"serverSettingsStored\":" + String(serverSettingsStored ? "true" : "false") +
                 ",\"pushConfigured\":" + String(pushConfigured() ? "true" : "false") +
                 ",\"pairingState\":\"" + jsonEscape(pairingState) +
                 "\",\"pairingCode\":\"" + jsonEscape(pairingCode) +
                 "\",\"pairingMessage\":\"" + jsonEscape(pairingMessage) +
                 "\",\"hardwareId\":\"" + hardwareId() + "\"" +
                 ",\"firmwareVersion\":\"" + String(FIRMWARE_VERSION) + "\"" +
                 ",\"clockReady\":" + String(clockReady() ? "true" : "false") +
                ",\"pendingScan\":" + String(pendingUidReady ? "true" : "false") +
                ",\"lastUid\":\"" + jsonEscape(lastPushedUid) +
                "\",\"ledPin\":\"D8 / GPIO 15\"" +
                ",\"ledCount\":" + String(STATUS_LED_COUNT) +
                ",\"ledTestActive\":" + String(statusLedTestActive ? "true" : "false") +
                ",\"csrf\":\"" + jsonEscape(wifiCsrfToken) +
                "\",\"message\":\"" + jsonEscape(lastPushState) + "\"}";
  json(200, body);
}

bool validWifiCsrf() {
  return server.hasArg("_csrf") && server.arg("_csrf") == wifiCsrfToken;
}

bool validVereinskasseApiUrl(const String &url) {
  return url.startsWith("https://") &&
         url.endsWith("/api/rfid") &&
         url.indexOf('?') < 0 &&
         url.indexOf('#') < 0 &&
         url.length() <= SERVER_API_URL_MAX_BYTES;
}

bool validRootCertificate(const String &rootCa) {
  return rootCa.length() > 100 &&
         rootCa.length() <= SERVER_ROOT_CA_MAX_BYTES &&
         rootCa.indexOf("-----BEGIN CERTIFICATE-----") >= 0 &&
         rootCa.indexOf("-----END CERTIFICATE-----") >= 0;
}

void handleServerSettingsGet() {
  if (!authorized()) return;
  const String body =
      "{\"apiUrl\":\"" + jsonEscape(vereinskasseApiUrl) +
      "\",\"deviceTokenConfigured\":" +
      String(rfidDeviceToken.length() >= 24 ? "true" : "false") +
      ",\"rootCa\":\"" + jsonEscape(vereinskasseRootCa) +
      "\",\"stored\":" + String(serverSettingsStored ? "true" : "false") + "}";
  json(200, body);
}

void handleServerSettingsSave() {
  if (!authorized()) return;
  if (!validWifiCsrf()) {
    json(403, "{\"error\":\"Sicherheitspruefung fehlgeschlagen. Seite neu laden.\"}");
    return;
  }
  if (server.arg("confirm") != "VERBINDEN") {
    json(400, "{\"error\":\"Bestaetigung VERBINDEN fehlt.\"}");
    return;
  }

  String apiUrl = server.arg("apiUrl");
  apiUrl.trim();
  while (apiUrl.endsWith("/")) apiUrl.remove(apiUrl.length() - 1);
  if (!validVereinskasseApiUrl(apiUrl)) {
    json(400, "{\"error\":\"Die Adresse muss mit https:// beginnen und auf /api/rfid enden.\"}");
    return;
  }

  String deviceToken = server.arg("deviceToken");
  deviceToken.trim();
  if (!deviceToken.length()) deviceToken = rfidDeviceToken;
  if (deviceToken.length() &&
      (deviceToken.length() < 24 || deviceToken.length() > SERVER_DEVICE_TOKEN_MAX_BYTES)) {
    json(400, "{\"error\":\"Der Geraete-Token hat eine ungueltige Laenge.\"}");
    return;
  }

  String rootCa = server.arg("rootCa");
  rootCa.trim();
  if (!rootCa.length()) rootCa = vereinskasseRootCa;
  rootCa.replace("\r\n", "\n");
  rootCa.trim();
  rootCa += '\n';
  if (!validRootCertificate(rootCa)) {
    json(400, "{\"error\":\"Das Root-Zertifikat fehlt oder ist kein gueltiges PEM-Zertifikat.\"}");
    return;
  }

  if (!saveServerSettings(apiUrl, deviceToken, rootCa)) {
    json(500, "{\"error\":\"Die Servereinstellung konnte nicht dauerhaft gespeichert werden.\"}");
    return;
  }
  lastPushState = deviceToken.length()
      ? "Kassenserver gespeichert. Verbindung kann jetzt getestet werden."
      : "Kassenserver gespeichert. Jetzt Kopplung per Einmalcode starten.";
  serverFailureSince = 0;
  json(200, "{\"saved\":true,\"apiUrl\":\"" + jsonEscape(vereinskasseApiUrl) + "\"}");
}

void handleServerConnectionTest() {
  if (!authorized()) return;
  if (!validWifiCsrf()) {
    json(403, "{\"error\":\"Sicherheitspruefung fehlgeschlagen. Seite neu laden.\"}");
    return;
  }
  if (server.arg("confirm") != "TESTEN") {
    json(400, "{\"error\":\"Bestaetigung TESTEN fehlt.\"}");
    return;
  }
  if (!pushConfigured()) {
    json(409, "{\"error\":\"WLAN, Serveradresse, Geraete-Token oder Zertifikat fehlt.\"}");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    json(409, "{\"error\":\"Der Leser ist nicht mit dem ClubIQ-Kassen-WLAN verbunden.\"}");
    return;
  }
  if (!clockReady()) {
    beginClockSync();
    json(409, "{\"error\":\"Die sichere Uhrzeit ist noch nicht verfuegbar. Bitte kurz warten.\"}");
    return;
  }
  if (!beginVereinskasseRequest(commandApiUrl())) {
    json(502, "{\"error\":\"Die HTTPS-Verbindung konnte nicht vorbereitet werden.\"}");
    return;
  }
  vereinskasseHttps.addHeader("X-RFID-Token", rfidDeviceToken);
  const int status = vereinskasseHttps.GET();
  vereinskasseHttps.end();
  if (status >= 200 && status < 300) {
    serverFailureSince = 0;
    lastPushState = "Kassenserver erfolgreich getestet.";
    setStatusLed(StatusLedMode::Success, 900);
    json(200, "{\"ok\":true,\"status\":" + String(status) + "}");
    return;
  }
  lastPushState = status < 0
      ? "Server-Test: Netzwerk-/TLS-Fehler."
      : "Server-Test: HTTP " + String(status) + ".";
  setStatusLed(StatusLedMode::Error, 1800);
  json(502, "{\"error\":\"Kassenserver nicht erreichbar oder Token abgelehnt.\",\"status\":" +
            String(status) + "}");
}

String pairingApiUrl() {
  return vereinskasseApiUrl + "/pair";
}

String secureRandomHex(size_t bytes) {
  static const char hexDigits[] = "0123456789ABCDEF";
  String result;
  result.reserve(bytes * 2);
  uint32_t randomValue = 0;
  for (size_t i = 0; i < bytes; ++i) {
    if ((i % 4) == 0) randomValue = secureRandomWord();
    const uint8_t value = (randomValue >> ((i % 4) * 8)) & 0xFF;
    result += hexDigits[value >> 4];
    result += hexDigits[value & 0x0F];
  }
  return result;
}

bool sendPairingRequest() {
  if (!beginVereinskasseRequest(pairingApiUrl())) return false;
  vereinskasseHttps.addHeader("Content-Type", "application/json");
  const String idValue = hardwareId();
  const String requestedName = pairingDeviceName.length()
      ? pairingDeviceName
      : "RFID-Leser " + macSuffix();
  const String body = "{\"hardwareId\":\"" + idValue +
                      "\",\"code\":\"" + pairingCode +
                      "\",\"secret\":\"" + pairingSecret +
                      "\",\"name\":\"" + jsonEscape(requestedName) + "\"}";
  const int status = vereinskasseHttps.POST(body);
  const String response = vereinskasseHttps.getString();
  vereinskasseHttps.end();
  if (status < 200 || status >= 300) {
    pairingMessage = status < 0
        ? "Kassenserver-Verbindung: " + String(HTTPClient::errorToString(status).c_str()) +
              " (Fehler " + String(status) + "). Neuer Versuch laeuft."
        : "Kassenserver lehnt die Kopplung ab (HTTP " + String(status) + ").";
    Serial.println(pairingMessage);
    return false;
  }
  pairingRequestId = jsonStringField(response, "id");
  if (!pairingRequestId.length()) {
    pairingMessage = "Kassenserver hat keine Kopplungsnummer geliefert.";
    return false;
  }
  pairingState = "pending";
  pairingMessage = "Code " + pairingCode + " jetzt in Clubiq Ledger freigeben.";
  pairingActive = true;
  lastPairingPollAt = 0;
  setStatusLed(StatusLedMode::Pairing);
  showStatusDisplay("Kopplungscode", pairingCode);
#if defined(CLUBIQ_ESP32_BLE)
  bleNotifyJson("{\"state\":\"pairing\",\"hardwareId\":\"" + idValue +
                "\",\"code\":\"" + pairingCode + "\"}");
#endif
  return true;
}

void handlePairingStart() {
  if (!authorized()) return;
  if (!validWifiCsrf()) {
    json(403, "{\"error\":\"Sicherheitspruefung fehlgeschlagen. Seite neu laden.\"}");
    return;
  }
  if (server.arg("confirm") != "KOPPELN") {
    json(400, "{\"error\":\"Bestaetigung KOPPELN fehlt.\"}");
    return;
  }
  if (!pairingConfigured()) {
    json(409, "{\"error\":\"WLAN, Serveradresse oder Root-Zertifikat fehlt.\"}");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    json(409, "{\"error\":\"Der Leser ist noch nicht mit dem ClubIQ-Kassen-WLAN verbunden.\"}");
    return;
  }
  if (!clockReady()) {
    beginClockSync();
    json(409, "{\"error\":\"Die sichere Uhrzeit wird noch geladen. Bitte kurz warten.\"}");
    return;
  }
  pairingSecret = secureRandomHex(32);
  char codeBuffer[7];
  snprintf(codeBuffer, sizeof(codeBuffer), "%06lu", secureRandomWord() % 1000000UL);
  pairingCode = codeBuffer;
  pairingRequestId = "";
  pairingState = "requesting";
  pairingMessage = "Kopplungsanfrage wird gesendet.";
  pairingActive = false;
  if (!sendPairingRequest()) {
    pairingState = "error";
    setStatusLed(StatusLedMode::Error, 1800);
    json(502, "{\"error\":\"" + jsonEscape(pairingMessage) + "\"}");
    return;
  }
  json(202, "{\"state\":\"pending\",\"hardwareId\":\"" + hardwareId() +
            "\",\"code\":\"" + pairingCode + "\"}");
}

void pollPairingApproval() {
  if (!pairingActive || WiFi.status() != WL_CONNECTED || !clockReady()) return;
  const unsigned long now = millis();
  if (lastPairingPollAt && now - lastPairingPollAt < RFID_PAIRING_POLL_INTERVAL_MS) return;
  lastPairingPollAt = now;
  if (!beginVereinskasseRequest(pairingApiUrl() + "?id=" + pairingRequestId)) return;
  vereinskasseHttps.addHeader("X-RFID-Pairing-Secret", pairingSecret);
  const int status = vereinskasseHttps.GET();
  const String response = vereinskasseHttps.getString();
  vereinskasseHttps.end();
  const String state = jsonStringField(response, "state");
  if (status == 200 && state == "approved") {
    if (!saveServerSettings(vereinskasseApiUrl, pairingSecret, vereinskasseRootCa)) {
      pairingState = "error";
      pairingMessage = "Freigabe erhalten, aber Anmeldung konnte nicht gespeichert werden.";
      pairingActive = false;
      setStatusLed(StatusLedMode::Error, 1800);
#if defined(CLUBIQ_ESP32_BLE)
      bleNotifyJson("{\"state\":\"error\",\"message\":\"" +
                    jsonEscape(pairingMessage) + "\"}");
      bleSetupInProgress = false;
#endif
      return;
    }
    pairingState = "approved";
    pairingMessage = "Sicher gekoppelt. Kartenscans sind jetzt bereit.";
    pairingActive = false;
    pairingSecret = "";
    pairingCode = "";
    pairingRequestId = "";
    serverFailureSince = 0;
    lastPushState = pairingMessage;
    setStatusLed(StatusLedMode::Success, 1400);
    showStatusDisplay("Gekoppelt", "RFID bereit");
#if defined(CLUBIQ_ESP32_BLE)
    bleNotifyJson("{\"state\":\"approved\",\"hardwareId\":\"" + hardwareId() + "\"}");
    bleSetupInProgress = false;
#endif
    return;
  }
  if ((status == 200 && (state == "rejected" || state == "expired")) || status == 410) {
    pairingState = state.length() ? state : "expired";
    pairingMessage = pairingState == "rejected"
        ? "Kopplung wurde in Clubiq Ledger verworfen."
        : "Kopplungscode ist abgelaufen. Bitte neu starten.";
    pairingActive = false;
    pairingSecret = "";
    pairingCode = "";
    pairingRequestId = "";
    setStatusLed(StatusLedMode::Error, 1800);
    showStatusDisplay("Kopplung", "Erneut starten");
#if defined(CLUBIQ_ESP32_BLE)
    bleNotifyJson("{\"state\":\"error\",\"message\":\"" +
                  jsonEscape(pairingMessage) + "\"}");
    bleSetupInProgress = false;
    blePairingSent = false;
#endif
    return;
  }
  if (status != 200) pairingMessage = "Warte auf Kassenserver; Kopplung bleibt offen.";
}

void handleLedTest() {
  if (!authorized()) return;
  if (!validWifiCsrf()) {
    json(403, "{\"error\":\"Sicherheitsprüfung fehlgeschlagen. Seite neu laden.\"}");
    return;
  }
  if (server.arg("confirm") != "TESTEN") {
    json(400, "{\"error\":\"Bestätigung TESTEN fehlt.\"}");
    return;
  }
  startStatusLedTest();
  lastPushState = "LED-Test läuft: fünf LEDs, danach Rot, Grün, Blau und Weiß.";
  json(200, "{\"started\":true,\"count\":" + String(STATUS_LED_COUNT) +
            ",\"pin\":\"D8 / GPIO 15\"}");
}

void reconnectStationWifi() {
#if defined(CLUBIQ_ESP32_BLE)
  if (directBleRuntimeMode()) {
    disableWifiForBleRuntime();
    return;
  }
#endif
  resetVereinskasseConnection();
  WiFi.disconnect(false);
  stationWasConnected = false;
  stationConnectedAt = 0;
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
#if defined(CLUBIQ_ESP32_BLE)
  if (directBleRuntimeMode()) {
    stationReconnectPending = false;
    return;
  }
#endif
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
#if defined(CLUBIQ_ESP32_BLE)
            ",\"secure\":" + String(WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "false" : "true") + "}";
#else
            ",\"secure\":" + String(WiFi.encryptionType(i) == ENC_TYPE_NONE ? "false" : "true") + "}";
#endif
  }
  body += "],\"scanning\":false}";
  WiFi.scanDelete();
  json(200, body);
}

void maintainStationWifi() {
  if (directBleRuntimeMode()) return;
  if (!stationConfigured()) {
    startMaintenanceAp();
    return;
  }
  if (WiFi.status() == WL_CONNECTED) {
    wifiDisconnectedSince = 0;
    if (maintenanceApActive) stopMaintenanceAp();
    if (!stationWasConnected) {
      stationWasConnected = true;
      stationConnectedAt = millis();
      Serial.printf("ClubIQ-Kassen-WLAN verbunden, IP: %s\n", WiFi.localIP().toString().c_str());
    }
    beginClockSync();
    if (clockReady() && !clockWasReady) {
      clockWasReady = true;
      lastPushState = "ClubIQ-Kassen-WLAN und sichere Uhrzeit bereit.";
      if (!bleSetupInProgress && pushConfigured()) {
        setStatusLed(StatusLedMode::Ready);
      } else if (!bleSetupInProgress) {
        setStatusLed(StatusLedMode::Connecting);
        showStatusDisplay("Einrichtung", "In App abschliessen");
      }
      Serial.println(lastPushState);
    }
    return;
  }

  const unsigned long now = millis();
  if (!wifiDisconnectedSince) wifiDisconnectedSince = now;
  if (now - wifiDisconnectedSince >= MAINTENANCE_AP_FALLBACK_MS)
    startMaintenanceAp();
  if (stationWasConnected) {
    stationWasConnected = false;
    stationConnectedAt = 0;
    clockWasReady = false;
    resetVereinskasseConnection();
    setStatusLed(StatusLedMode::Connecting);
    Serial.println("ClubIQ-Kassen-WLAN getrennt.");
  }
  if (lastWifiAttempt && now - lastWifiAttempt < WIFI_RECONNECT_INTERVAL_MS) return;
  lastWifiAttempt = now;
  timeSyncStarted = false;
  lastPushState = "Verbinde mit ClubIQ-Kassen-WLAN.";
  setStatusLed(StatusLedMode::Connecting);
  Serial.printf("Verbinde mit ClubIQ-Kassen-WLAN \"%s\" ...\n", clubWifiSsid.c_str());
  if (maintenanceApActive) WiFi.mode(WIFI_AP_STA);
  else WiFi.mode(WIFI_STA);
  WiFi.begin(clubWifiSsid.c_str(), clubWifiPassword.c_str());
}

void retryPendingUid() {
  if (directBleRuntimeMode()) return;
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
  bool directBleAvailable = false;
  bool directBleMode = false;
#if defined(CLUBIQ_ESP32_BLE)
  const bool directBleReady = bleSessionActive && bleClientConnected;
  directBleMode = directBleRuntimeMode();
  directBleAvailable = bleClientConnected && bleIdentityConfigured();
  const bool directBlePending = blePendingScanReady;
#else
  const bool directBlePending = false;
#endif
  const bool transportUnavailable = directBleMode ? !directBleAvailable : !pushConfigured();
  if (writeCommandActive || now - lastScanAt < RFID_SCAN_INTERVAL_MS) return;
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
  if (transportUnavailable) {
    lastPushState = "Karte " + uid + " erkannt; ClubIQ-Einrichtung fehlt noch.";
    setStatusLed(StatusLedMode::Error, 1400);
    showStatusDisplay("Karte erkannt", "Einrichtung fehlt");
    Serial.println(lastPushState);
    return;
  }
  if (pendingUidReady || directBlePending) {
    lastPushState = "Karte " + uid + " erkannt; ein vorheriger Scan wartet noch.";
    setStatusLed(StatusLedMode::Error, 1400);
    showStatusDisplay("Karte erkannt", "1 Scan wartet");
    Serial.println(lastPushState);
    return;
  }
  if (directBleAvailable) {
#if defined(CLUBIQ_ESP32_BLE)
    blePendingScanUid = uid;
    blePendingScanType = type;
    blePendingScanBlocks = blocks;
    blePendingScanCounter = ++bleSessionCounter;
    blePendingScanReady = true;
    bleLastScanNotifyAt = 0;
    lastPushState = "Karte " + uid + " erkannt; sichere Bluetooth-Bestätigung läuft.";
    setStatusLed(StatusLedMode::Scanning);
    if (directBleReady) sendBlePendingScan();
    return;
#endif
  }
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
  const bool wifiStalled = !directBleRuntimeMode() && stationConfigured() && wifiDisconnectedSince &&
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
  return vereinskasseApiUrl + "/commands";
}

String firmwareDownloadUrl(const String &path) {
  const int apiMarker = vereinskasseApiUrl.indexOf("/api/rfid");
  if (apiMarker < 0 || !path.startsWith("/")) return "";
  return vereinskasseApiUrl.substring(0, apiMarker) + path;
}

bool reportDeviceCommandResult(const String &commandId, const String &uid,
                               const String &value, bool success,
                               const String &error) {
  if (!beginVereinskasseRequest(commandApiUrl())) return false;
  vereinskasseHttps.addHeader("Content-Type", "application/json");
  vereinskasseHttps.addHeader("X-RFID-Token", rfidDeviceToken);
  vereinskasseHttps.addHeader("X-RFID-Firmware-Version", FIRMWARE_VERSION);
  const String body = "{\"id\":\"" + jsonEscape(commandId) +
                      "\",\"success\":" + String(success ? "true" : "false") +
                      ",\"uid\":\"" + jsonEscape(uid) +
                      "\",\"hex\":\"" + jsonEscape(value) +
                      "\",\"error\":\"" + jsonEscape(error) + "\"}";
  const int status = vereinskasseHttps.POST(body);
  vereinskasseHttps.end();
  return status >= 200 && status < 300;
}

bool reportWriteResult() {
  if (!writeResultReady) return false;
  if (!beginVereinskasseRequest(commandApiUrl())) return false;
  vereinskasseHttps.addHeader("Content-Type", "application/json");
  vereinskasseHttps.addHeader("X-RFID-Token", rfidDeviceToken);
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
  if (!reportDeviceCommandResult(commandId, "DEVICE-RESTART", "", true, "")) {
    lastPushState = "Neustart konnte nicht bestätigt werden.";
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

void performFirmwareUpdate(const String &commandId, const String &targetVersion,
                           const String &path) {
  const String url = firmwareDownloadUrl(path);
  if (!url.length() || !targetVersion.length() || writeCommandActive || pendingUidReady) {
    reportDeviceCommandResult(commandId, "DEVICE-FIRMWARE", targetVersion, false,
                              "Update ist momentan nicht sicher ausführbar.");
    return;
  }
  vereinskasseHttps.end();
  vereinskasseTls.stop();
#if defined(CLUBIQ_ESP32_BLE)
  vereinskasseTls.setCACert(vereinskasseRootCa.c_str());
#else
  vereinskasseTls.setTrustAnchors(vereinskasseTrustAnchor);
#endif
  vereinskasseTls.setTimeout(15000);
#if defined(CLUBIQ_ESP32_BLE)
  clubiqHttpUpdate.rebootOnUpdate(false);
  clubiqHttpUpdate.onStart([] {
#else
  ESPhttpUpdate.rebootOnUpdate(false);
  ESPhttpUpdate.onStart([] {
#endif
    lastPushState = "Firmware wird sicher geladen und installiert.";
    setStatusLed(StatusLedMode::Updating);
    showStatusDisplay("Firmwareupdate", "Strom nicht trennen");
    renderStatusLed();
  });
#if defined(CLUBIQ_ESP32_BLE)
  clubiqHttpUpdate.onProgress([](int current, int total) {
#else
  ESPhttpUpdate.onProgress([](int current, int total) {
#endif
    feedWatchdog();
    if (total > 0) lastPushState = "Firmwareupdate: " + String((current * 100) / total) + "%";
    renderStatusLed();
  });
#if defined(CLUBIQ_ESP32_BLE)
  clubiqHttpUpdate.onError([](int error) {
#else
  ESPhttpUpdate.onError([](int error) {
#endif
    lastPushState = "Firmwareupdate fehlgeschlagen: " + String(error) + ".";
  });
#if defined(CLUBIQ_ESP32_BLE)
  const t_httpUpdate_return result = clubiqHttpUpdate.update(vereinskasseTls, url, FIRMWARE_VERSION);
#else
  const t_httpUpdate_return result = ESPhttpUpdate.update(vereinskasseTls, url, FIRMWARE_VERSION);
#endif
  vereinskasseTls.stop();
  if (result != HTTP_UPDATE_OK) {
    const String error = result == HTTP_UPDATE_NO_UPDATES
        ? "Firmware ist bereits aktuell."
#if defined(CLUBIQ_ESP32_BLE)
        : String(clubiqHttpUpdate.getLastErrorString().c_str());
#else
        : String(ESPhttpUpdate.getLastErrorString().c_str());
#endif
    reportDeviceCommandResult(commandId, "DEVICE-FIRMWARE", targetVersion, false, error);
    setStatusLed(StatusLedMode::Error, 2400);
    return;
  }
  if (!reportDeviceCommandResult(commandId, "DEVICE-FIRMWARE", targetVersion, true, ""))
    lastPushState = "Firmware installiert; Bestätigung folgt nach dem Neustart.";
  setStatusLed(StatusLedMode::Success, 700);
  showStatusDisplay("Update fertig", "Leser startet neu");
  renderStatusLed();
  delay(500);
  ESP.restart();
}

void pollWriteCommand() {
  if (directBleRuntimeMode()) return;
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
  vereinskasseHttps.addHeader("X-RFID-Token", rfidDeviceToken);
  vereinskasseHttps.addHeader("X-RFID-Firmware-Version", FIRMWARE_VERSION);
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
      lastPushState = "Schreibauftrag-Abfrage: " + String(HTTPClient::errorToString(status).c_str());
#if !defined(CLUBIQ_ESP32_BLE)
      char tlsError[120] = {};
      const int tlsCode = vereinskasseTls.getLastSSLError(tlsError, sizeof(tlsError));
      if (tlsCode) lastPushState += " · TLS " + String(tlsCode) + ": " + String(tlsError);
#endif
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
  if (id.length() && action == "firmware") {
    performFirmwareUpdate(id, jsonStringField(response, "version"),
                          jsonStringField(response, "firmwareUrl"));
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

#if defined(CLUBIQ_ESP32_BLE)
class ClubIqBleServerCallbacks final : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleClientConnected = true;
    bleProvisioningAuthorized = !bleIdentityConfigured();
    blePhysicalConfirmationPending = false;
    bleDeferredProvisionCommand = "";
    bleSessionActive = false;
    bleSessionId = "";
    bleLastProgressAt = 0;
  }

  void onDisconnect(BLEServer *) override {
    bleClientConnected = false;
    bleSessionActive = false;
    bleSessionId = "";
    bleProvisioningAuthorized = false;
    blePhysicalConfirmationPending = false;
    bleDeferredProvisionCommand = "";
    if (bleOtaActive) {
      Update.abort();
      mbedtls_sha256_free(&bleOtaShaContext);
      bleOtaActive = false;
    }
    if (bleIdentityConfigured()) {
      setStatusLed(WiFi.status() == WL_CONNECTED && clockReady()
                       ? StatusLedMode::Ready
                       : StatusLedMode::Pairing);
      if (!displayOrderActive)
        showStatusDisplay(WiFi.status() == WL_CONNECTED ? "ClubIQ-WLAN" : "WLAN getrennt",
                          WiFi.status() == WL_CONNECTED ? "Leser ist bereit" : "Verbindung wird repariert");
    }
    BLEDevice::startAdvertising();
  }
};

class ClubIqBleRxCallbacks final : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    const std::string value = characteristic->getValue();
    if (value.empty() || bleCommandPending) return;
    for (const char byte : value) {
      if (byte == '\n') {
        if (bleReceiveBuffer.length() > 0 && bleReceiveBuffer.length() <= 6144) {
          blePendingCommand = bleReceiveBuffer;
          bleCommandPending = true;
        }
        bleReceiveBuffer = "";
        continue;
      }
      if (bleReceiveBuffer.length() < 6144) bleReceiveBuffer += byte;
      else bleReceiveBuffer = "";
    }
  }
};

class ClubIqBleOtaCallbacks final : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    if (!bleOtaActive) return;
    const std::string value = characteristic->getValue();
    if (value.empty() || bleOtaWritten + value.size() > bleOtaExpectedSize) {
      Update.abort();
      mbedtls_sha256_free(&bleOtaShaContext);
      bleOtaActive = false;
      bleNotifyJson("{\"state\":\"error\",\"message\":\"Firmwaredaten sind unvollständig oder zu groß.\"}");
      return;
    }
    const size_t written = Update.write(
        reinterpret_cast<uint8_t *>(const_cast<char *>(value.data())), value.size());
    if (written != value.size()) {
      Update.abort();
      mbedtls_sha256_free(&bleOtaShaContext);
      bleOtaActive = false;
      bleNotifyJson("{\"state\":\"error\",\"message\":\"Firmware konnte nicht geschrieben werden.\"}");
      return;
    }
    mbedtls_sha256_update_ret(&bleOtaShaContext,
                              reinterpret_cast<const unsigned char *>(value.data()),
                              value.size());
    bleOtaWritten += written;
  }
};

void bleNotifyJson(const String &payload) {
  if (!bleTx || !bleClientConnected) return;
  const String framed = payload + "\n";
  for (size_t offset = 0; offset < framed.length(); offset += 18) {
    const size_t count = min(static_cast<size_t>(18), framed.length() - offset);
    bleTx->setValue(std::string(framed.c_str() + offset, count));
    bleTx->notify();
    // Einige Android-Bluetooth-Stacks verlieren direkt aufeinanderfolgende
    // Teilbenachrichtigungen. Der kleine Abstand macht die JSON-Rahmen stabil,
    // ohne die einmalige Einrichtung merklich zu verlangsamen.
    delay(35);
  }
}

String bleSessionMessage(const String &sessionId, const String &nonce,
                         const String &expiresAt) {
  return "session|" + hardwareId() + "|" + sessionId + "|" + nonce + "|" + expiresAt;
}

void sendBleReady() {
  const String proof = bleIdentityConfigured() && bleHelloNonce.length() == 48
      ? bleHmac("hello|" + hardwareId() + "|" + bleHelloNonce + "|" + FIRMWARE_VERSION)
      : "";
  bleNotifyJson("{\"state\":\"ready\",\"hardwareId\":\"" + hardwareId() +
                "\",\"firmwareVersion\":\"" + FIRMWARE_VERSION +
                "\",\"mode\":\"" +
                String(bleIdentityConfigured() ? "ble" : "setup") +
                "\",\"nonce\":\"" + bleHelloNonce +
                "\",\"proof\":\"" + proof + "\"}");
}

void clearBleSession() {
  bleSessionActive = false;
  bleSessionId = "";
  bleSessionNonce = "";
  bleSessionStartedAt = 0;
  bleLastHeartbeatAt = 0;
}

void sendBlePendingScan() {
  if (!bleSessionActive || !blePendingScanReady || !bleClientConnected) return;
  const String message = "scan|" + hardwareId() + "|" + bleSessionId + "|" +
      String(blePendingScanCounter) + "|" + blePendingScanUid + "|" +
      String(blePendingScanBlocks) + "|" + FIRMWARE_VERSION;
  const String signature = bleHmac(message);
  if (!signature.length()) return;
  bleNotifyJson("{\"state\":\"scan\",\"hardwareId\":\"" + hardwareId() +
                "\",\"sessionId\":\"" + bleSessionId +
                "\",\"counter\":" + String(blePendingScanCounter) +
                ",\"uid\":\"" + blePendingScanUid +
                "\",\"cardType\":\"" + jsonEscape(blePendingScanType) +
                "\",\"blocks\":" + String(blePendingScanBlocks) +
                ",\"firmwareVersion\":\"" + FIRMWARE_VERSION +
                "\",\"signature\":\"" + signature + "\"}");
  bleLastScanNotifyAt = millis();
}

void sendBleHeartbeat() {
  if (!bleSessionActive || !bleClientConnected) return;
  const String message = "heartbeat|" + hardwareId() + "|" + bleSessionId + "|" +
                         String(bleSessionCounter) + "|" + FIRMWARE_VERSION;
  const String signature = bleHmac(message);
  if (!signature.length()) return;
  bleNotifyJson("{\"state\":\"heartbeat\",\"hardwareId\":\"" + hardwareId() +
                "\",\"counter\":" + String(bleSessionCounter) +
                ",\"firmwareVersion\":\"" + FIRMWARE_VERSION +
                "\",\"signature\":\"" + signature + "\"}");
  bleLastHeartbeatAt = millis();
}

void queueBleCommandResult(const String &commandId, bool success,
                           const String &uid, const String &value,
                           String error, bool restartAfterAck = false) {
  error.replace("|", " ");
  error.replace("\n", " ");
  error.replace("\r", " ");
  if (error.length() > 240) error.remove(240);
  bleResultCommandId = commandId;
  bleResultSuccess = success;
  bleResultUid = uid;
  bleResultValue = value;
  bleResultError = error;
  bleRestartAfterResult = restartAfterAck;
  bleCommandResultPending = true;
  bleLastResultNotifyAt = 0;
}

void sendBleCommandResult() {
  if (!bleSessionActive || !bleClientConnected || !bleCommandResultPending) return;
  const String message = "result|" + hardwareId() + "|" + bleSessionId + "|" +
      bleResultCommandId + "|" + String(bleResultSuccess ? 1 : 0) + "|" +
      bleResultUid + "|" + bleResultValue + "|" + bleResultError;
  const String signature = bleHmac(message);
  if (!signature.length()) return;
  bleNotifyJson("{\"state\":\"command_result\",\"commandId\":\"" +
                bleResultCommandId + "\",\"success\":" +
                String(bleResultSuccess ? "true" : "false") +
                ",\"uid\":\"" + jsonEscape(bleResultUid) +
                "\",\"value\":\"" + jsonEscape(bleResultValue) +
                "\",\"error\":\"" + jsonEscape(bleResultError) +
                "\",\"signature\":\"" + signature + "\"}");
  bleLastResultNotifyAt = millis();
}

void prepareBlePairOffer() {
  pairingSecret = secureRandomHex(32);
  blePairTokenHash = sha256Hex(pairingSecret);
  blePairProof = bleIdentityConfigured()
      ? bleHmac("pair|" + hardwareId() + "|" + blePairTokenHash)
      : "";
  if (!blePairTokenHash.length()) {
    rejectBleProvisioning("Sichere Gerätekennung konnte nicht erzeugt werden.");
    return;
  }
  setStatusLed(StatusLedMode::Pairing);
  showStatusDisplay("Bluetooth", "In App bestätigen");
  bleNotifyJson("{\"state\":\"pair_offer\",\"hardwareId\":\"" + hardwareId() +
                "\",\"tokenHash\":\"" + blePairTokenHash +
                "\",\"proof\":\"" + blePairProof + "\"}");
}

String decodeProvisionField(const String &body, const String &name) {
  const String encoded = jsonStringField(body, name);
  if (!encoded.length() || encoded.length() > 4096) return "";
  size_t outputLength = 0;
  const size_t capacity = (encoded.length() * 3) / 4 + 4;
  std::unique_ptr<unsigned char[]> output(new unsigned char[capacity + 1]);
  if (mbedtls_base64_decode(output.get(), capacity, &outputLength,
                            reinterpret_cast<const unsigned char *>(encoded.c_str()),
                            encoded.length()) != 0) return "";
  output[outputLength] = '\0';
  return String(reinterpret_cast<char *>(output.get())).substring(0, outputLength);
}

void rejectBleProvisioning(const String &message) {
  bleSetupInProgress = false;
  blePairingSent = false;
  bleReuseExistingIdentity = false;
  setStatusLed(StatusLedMode::Error, 1800);
  bleNotifyJson("{\"state\":\"error\",\"message\":\"" + jsonEscape(message) + "\"}");
}

void beginBleCommand(const String &body) {
  if (!bleSessionActive) {
    rejectBleProvisioning("Sichere Bluetooth-Sitzung fehlt.");
    return;
  }
  const String commandId = jsonStringField(body, "id");
  const String action = jsonStringField(body, "action");
  const String uid = jsonStringField(body, "uid");
  const String payload = jsonStringField(body, "payload");
  const String expiresAt = jsonStringField(body, "expiresAt");
  const String sha256 = jsonStringField(body, "sha256");
  const String authorization = jsonStringField(body, "authorization");
  const int block = jsonIntField(body, "block");
  const int size = jsonIntField(body, "size");
  const String message = "command|" + hardwareId() + "|" + bleSessionId + "|" +
      commandId + "|" + action + "|" + uid + "|" + String(block) + "|" +
      payload + "|" + expiresAt + "|" + String(max(0, size)) + "|" + sha256;
  if (!commandId.length() || !verifyBleHmac(message, authorization)) {
    rejectBleProvisioning("RFID-Auftrag ist nicht sicher freigegeben.");
    return;
  }
  if (action == "restart" && uid == "DEVICE-RESTART" && block == -1) {
    queueBleCommandResult(commandId, true, uid, payload, "", true);
    return;
  }
  if (action == "write") {
    byte parsed[16];
    if (writeCommandActive || bleOtaActive || uid.length() < 8 || block < 1 ||
        isTrailer(block) || !parseHex(payload, parsed, 16)) {
      queueBleCommandResult(commandId, false, uid, "",
                            "Schreibauftrag ist momentan nicht ausführbar.");
      return;
    }
    writeCommandId = commandId;
    writeCommandUid = uid;
    writeCommandHex = payload;
    writeCommandBlock = block;
    writeCommandActive = true;
    writeResultReady = false;
    writeResultSuccess = false;
    writeResultHex = "";
    writeResultError = "";
    setStatusLed(StatusLedMode::WriteWaiting);
    showStatusDisplay("Chip schreiben", "Passende Karte auflegen");
    return;
  }
  if (action == "firmware" && uid == "DEVICE-FIRMWARE" && block == -2) {
    if (payload == FIRMWARE_VERSION) {
      queueBleCommandResult(commandId, true, uid, payload, "");
      return;
    }
    if (bleOtaActive || writeCommandActive || size < 100000 || size > 0x1E0000 ||
        sha256.length() != 64 || !Update.begin(static_cast<size_t>(size), U_FLASH)) {
      queueBleCommandResult(commandId, false, uid, "",
                            "Firmwareupdate konnte nicht vorbereitet werden.");
      return;
    }
    bleOtaActive = true;
    bleOtaExpectedSize = static_cast<size_t>(size);
    bleOtaWritten = 0;
    bleOtaExpectedSha = sha256;
    bleOtaTargetVersion = payload;
    bleOtaCommandId = commandId;
    bleOtaLastProgressAt = 0;
    mbedtls_sha256_init(&bleOtaShaContext);
    mbedtls_sha256_starts_ret(&bleOtaShaContext, 0);
    setStatusLed(StatusLedMode::Updating);
    showStatusDisplay("Firmwareupdate", "Strom nicht trennen");
    bleNotifyJson("{\"state\":\"ota_ready\",\"commandId\":\"" +
                  commandId + "\"}");
    return;
  }
  rejectBleProvisioning("Unbekannter oder ungültiger RFID-Auftrag.");
}

void finishBleOta(const String &body) {
  const String commandId = jsonStringField(body, "id");
  if (!bleOtaActive || commandId != bleOtaCommandId) {
    rejectBleProvisioning("Kein passendes Firmwareupdate aktiv.");
    return;
  }
  unsigned char digest[32];
  mbedtls_sha256_finish_ret(&bleOtaShaContext, digest);
  mbedtls_sha256_free(&bleOtaShaContext);
  const String actualSha = bytesToLowerHex(digest, sizeof(digest));
  const bool valid = bleOtaWritten == bleOtaExpectedSize &&
                     constantTimeHexEquals(actualSha, bleOtaExpectedSha);
  if (!valid) {
    Update.abort();
    bleOtaActive = false;
    queueBleCommandResult(commandId, false, "DEVICE-FIRMWARE", "",
                          "Firmware-Prüfsumme stimmt nicht überein.");
    return;
  }
  const bool installed = Update.end(true);
  bleOtaActive = false;
  queueBleCommandResult(commandId, installed, "DEVICE-FIRMWARE",
                        installed ? bleOtaTargetVersion : "",
                        installed ? "" : "Firmware konnte nicht aktiviert werden.",
                        installed);
}

void processBleCommand() {
  if (!bleCommandPending) return;
  const String body = blePendingCommand;
  blePendingCommand = "";
  bleCommandPending = false;
  const String action = jsonStringField(body, "type");
  if (action == "hello") {
    bleHelloNonce = jsonStringField(body, "nonce");
    if (bleHelloNonce.length() != 48) bleHelloNonce = "";
    sendBleReady();
    return;
  }
  if (action == "pair_ble") {
    if (bleIdentityConfigured() && !bleProvisioningAuthorized) {
      bleDeferredProvisionCommand = body;
      blePhysicalConfirmationPending = true;
      blePhysicalConfirmationUntil = millis() + BLE_PHYSICAL_CONFIRMATION_MS;
      bleLastProgressAt = 0;
      setStatusLed(StatusLedMode::Pairing);
      showStatusDisplay("App-Freigabe", "Jetzt Karte auflegen");
      bleNotifyJson("{\"state\":\"confirmation_required\",\"hardwareId\":\"" +
                    hardwareId() + "\"}");
      return;
    }
    prepareBlePairOffer();
    return;
  }
  if (action == "pair_activate") {
    const String approval = jsonStringField(body, "approval");
    const String message = "activate|" + hardwareId() + "|" + blePairTokenHash;
    if (!pairingSecret.length() || !verifyBleHmac(message, approval, pairingSecret) ||
        !saveServerSettings("", pairingSecret, "") || !saveWifiSettings("", "")) {
      rejectBleProvisioning("Bluetooth-Freigabe konnte nicht sicher gespeichert werden.");
      return;
    }
    disableWifiForBleRuntime();
    clearBleSession();
    pairingSecret = "";
    blePairTokenHash = "";
    blePairProof = "";
    bleProvisioningAuthorized = true;
    setStatusLed(StatusLedMode::Success, 1200);
    showStatusDisplay("Verbunden", "Tablet übernimmt");
    bleNotifyJson("{\"state\":\"approved\",\"hardwareId\":\"" + hardwareId() + "\"}");
    return;
  }
  if (action == "session") {
    const String sessionId = jsonStringField(body, "sessionId");
    const String nonce = jsonStringField(body, "nonce");
    const String expiresAt = jsonStringField(body, "expiresAt");
    const String authorization = jsonStringField(body, "authorization");
    if (!bleIdentityConfigured() || sessionId.length() < 16 || nonce.length() != 48 ||
        !verifyBleHmac(bleSessionMessage(sessionId, nonce, expiresAt), authorization)) {
      rejectBleProvisioning("Bluetooth-Sitzung wurde vom Server nicht bestätigt.");
      return;
    }
    bleSessionId = sessionId;
    bleSessionNonce = nonce;
    bleSessionStartedAt = millis();
    bleSessionCounter = blePendingScanReady ? 1 : 0;
    if (blePendingScanReady) blePendingScanCounter = bleSessionCounter;
    bleSessionActive = true;
    bleLastHeartbeatAt = 0;
    setStatusLed(StatusLedMode::Ready);
    if (!displayOrderActive) showStatusDisplay("RFID bereit", "Karte auflegen");
    bleNotifyJson("{\"state\":\"session_ready\",\"hardwareId\":\"" +
                  hardwareId() + "\"}");
    return;
  }
  if (action == "scan_ack") {
    const uint32_t counter = static_cast<uint32_t>(jsonIntField(body, "counter"));
    const String uid = jsonStringField(body, "uid");
    const String state = jsonStringField(body, "state");
    const String memberName = jsonStringField(body, "memberName");
    const String acknowledgement = jsonStringField(body, "acknowledgement");
    const String message = "ack|" + hardwareId() + "|" + bleSessionId + "|" +
        String(counter) + "|" + uid + "|" + state + "|" + memberName;
    if (!blePendingScanReady || counter != blePendingScanCounter ||
        uid != blePendingScanUid || !verifyBleHmac(message, acknowledgement)) return;
    blePendingScanReady = false;
    blePendingScanUid = "";
    setStatusLed(StatusLedMode::Success, 900);
    if (state == "recognized" && memberName.length()) showStatusDisplay("Erkannt", memberName);
    else showStatusDisplay("Unbekannt", "In der App zuordnen");
    return;
  }
  if (action == "display") {
    if (!bleSessionActive) return;
    displayOrderActive = jsonStringField(body, "state") == "cart";
    displayOrderCustomer = jsonStringField(body, "customerName");
    displayOrderItems = jsonStringField(body, "itemsText");
    displayOrderItemCount = max(0, jsonIntField(body, "itemCount"));
    displayOrderTotalCents = max(0, jsonIntField(body, "totalCents"));
    displayOrderUpdatedAt = millis();
    if (displayOrderActive) showOrderDisplay();
    else {
      displayReadySince = millis();
      showStatusDisplay("RFID bereit", "Karte auflegen");
    }
    return;
  }
  if (action == "command") {
    beginBleCommand(body);
    return;
  }
  if (action == "ota_end") {
    finishBleOta(body);
    return;
  }
  if (action == "command_ack") {
    const String id = jsonStringField(body, "id");
    const String status = jsonStringField(body, "status");
    const String acknowledgement = jsonStringField(body, "acknowledgement");
    const String message = "command_ack|" + hardwareId() + "|" + bleSessionId +
                           "|" + id + "|" + status;
    if (!bleCommandResultPending || id != bleResultCommandId ||
        !verifyBleHmac(message, acknowledgement)) return;
    const bool restart = bleRestartAfterResult;
    bleCommandResultPending = false;
    bleRestartAfterResult = false;
    bleResultCommandId = "";
    if (restart) {
      showStatusDisplay("Neustart", "Bitte kurz warten");
      setStatusLed(StatusLedMode::Starting);
      renderStatusLed();
      delay(350);
      ESP.restart();
    }
    return;
  }
  if (action != "provision") {
    rejectBleProvisioning("Unbekannter Bluetooth-Auftrag.");
    return;
  }
  if (bleIdentityConfigured() && !bleProvisioningAuthorized) {
    bleDeferredProvisionCommand = body;
    blePhysicalConfirmationPending = true;
    blePhysicalConfirmationUntil = millis() + BLE_PHYSICAL_CONFIRMATION_MS;
    bleLastProgressAt = 0;
    setStatusLed(StatusLedMode::Pairing);
    showStatusDisplay("App-Freigabe", "Jetzt Karte auflegen");
    bleNotifyJson("{\"state\":\"confirmation_required\",\"hardwareId\":\"" +
                  hardwareId() + "\"}");
    return;
  }
  String ssid = decodeProvisionField(body, "ssid");
  const String password = decodeProvisionField(body, "password");
  String apiUrl = decodeProvisionField(body, "apiUrl");
  const String rootCa = decodeProvisionField(body, "rootCa");
  String requestedName = decodeProvisionField(body, "name");
  ssid.trim();
  apiUrl.trim();
  requestedName.trim();
  while (apiUrl.endsWith("/")) apiUrl.remove(apiUrl.length() - 1);
  if (!ssid.length() || ssid.length() > 32 || password.length() > 63 ||
      (password.length() > 0 && password.length() < 8)) {
    rejectBleProvisioning("WLAN-Name oder Kennwort ist ungueltig.");
    return;
  }
  if (!validVereinskasseApiUrl(apiUrl) || !validRootCertificate(rootCa)) {
    rejectBleProvisioning("ClubIQ-Adresse oder Zertifikat ist ungueltig.");
    return;
  }
  if (requestedName.length() < 3) requestedName = "RFID-Leser " + macSuffix();
  if (requestedName.length() > 60) requestedName.remove(60);
  // Bei einer bestaetigten WLAN-Aenderung eines bereits registrierten Lesers
  // bleibt dessen geheime Geraetekennung erhalten. Nur ein neuer oder nicht
  // mehr freigegebener Leser durchlaeuft anschliessend die Kopplung erneut.
  const bool reuseExistingIdentity = bleIdentityConfigured();
  const String existingDeviceToken = reuseExistingIdentity ? rfidDeviceToken : String("");
  if (!saveWifiSettings(ssid, password) ||
      !saveServerSettings(apiUrl, existingDeviceToken, rootCa)) {
    rejectBleProvisioning("Einstellungen konnten nicht gespeichert werden.");
    return;
  }
  pairingDeviceName = requestedName;
  pairingRequestId = "";
  pairingSecret = "";
  pairingCode = "";
  pairingState = "idle";
  pairingActive = false;
  bleSetupInProgress = true;
  blePairingSent = false;
  bleReuseExistingIdentity = reuseExistingIdentity;
  bleLastProgressAt = 0;
  scheduleStationReconnect();
  setStatusLed(StatusLedMode::Connecting);
  showStatusDisplay("Einrichtung", "Verbinde ClubIQ-WLAN");
  bleNotifyJson("{\"state\":\"wifi_connecting\",\"hardwareId\":\"" + hardwareId() + "\"}");
}

bool bleIdentityConfigured() {
  return rfidDeviceToken.length() >= 24;
}

#if defined(CLUBIQ_ESP32_BLE)
String bytesToLowerHex(const unsigned char *bytes, size_t length) {
  static const char digits[] = "0123456789abcdef";
  String result;
  result.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) {
    result += digits[bytes[i] >> 4];
    result += digits[bytes[i] & 0x0F];
  }
  return result;
}

bool constantTimeHexEquals(const String &left, const String &right) {
  if (left.length() != right.length()) return false;
  uint8_t difference = 0;
  for (size_t i = 0; i < left.length(); ++i)
    difference |= static_cast<uint8_t>(tolower(left[i]) ^ tolower(right[i]));
  return difference == 0;
}

String sha256Hex(const String &value) {
  unsigned char digest[32];
  if (mbedtls_sha256_ret(reinterpret_cast<const unsigned char *>(value.c_str()),
                         value.length(), digest, 0) != 0) return "";
  return bytesToLowerHex(digest, sizeof(digest));
}

String bleHmac(const String &message, const String &token) {
  const String source = token.length() ? token : rfidDeviceToken;
  if (source.length() < 24) return "";
  unsigned char key[32], digest[32];
  if (mbedtls_sha256_ret(reinterpret_cast<const unsigned char *>(source.c_str()),
                         source.length(), key, 0) != 0) return "";
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info || mbedtls_md_hmac(info, key, sizeof(key),
                               reinterpret_cast<const unsigned char *>(message.c_str()),
                               message.length(), digest) != 0) return "";
  return bytesToLowerHex(digest, sizeof(digest));
}

bool verifyBleHmac(const String &message, const String &signature,
                   const String &token) {
  return signature.length() == 64 &&
         constantTimeHexEquals(bleHmac(message, token), signature);
}
#endif

void processBlePhysicalConfirmation() {
  if (!blePhysicalConfirmationPending || !bleClientConnected) return;
  const unsigned long now = millis();
  if ((long)(now - blePhysicalConfirmationUntil) >= 0) {
    blePhysicalConfirmationPending = false;
    bleDeferredProvisionCommand = "";
    rejectBleProvisioning("Freigabe abgelaufen. Bitte die Verbindung erneut starten.");
    return;
  }
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  finishCard();
  bleProvisioningAuthorized = true;
  blePhysicalConfirmationPending = false;
  setStatusLed(StatusLedMode::Success, 1000);
  showStatusDisplay("Freigegeben", "App verbindet Leser");
  bleNotifyJson("{\"state\":\"physical_confirmed\",\"hardwareId\":\"" +
                hardwareId() + "\"}");
  blePendingCommand = bleDeferredProvisionCommand;
  bleDeferredProvisionCommand = "";
  bleCommandPending = true;
}

void processBleProvisioning() {
  processBleCommand();
  if (!bleClientConnected) return;
  if (bleSessionActive) return;
  const unsigned long now = millis();
  processBlePhysicalConfirmation();
  if (blePhysicalConfirmationPending) {
    if (!bleLastProgressAt || now - bleLastProgressAt > 3000) {
      bleLastProgressAt = now;
      bleNotifyJson("{\"state\":\"confirmation_required\",\"hardwareId\":\"" +
                    hardwareId() + "\"}");
    }
    return;
  }
  if (!bleSetupInProgress) {
    if (!bleLastProgressAt || now - bleLastProgressAt > 5000) {
      bleLastProgressAt = now;
      sendBleReady();
    }
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (!bleLastProgressAt || now - bleLastProgressAt > 3000) {
      bleLastProgressAt = now;
      bleNotifyJson("{\"state\":\"wifi_connecting\"}");
    }
    return;
  }
  if (!clockReady()) {
    beginClockSync();
    if (!bleLastProgressAt || now - bleLastProgressAt > 3000) {
      bleLastProgressAt = now;
      bleNotifyJson("{\"state\":\"securing_connection\"}");
    }
    return;
  }
  if (stationConnectedAt && now - stationConnectedAt < WIFI_TLS_SETTLE_MS) {
    if (!bleLastProgressAt || now - bleLastProgressAt > 1200) {
      bleLastProgressAt = now;
      bleNotifyJson("{\"state\":\"securing_connection\",\"message\":\"WLAN steht. Sichere Verbindung wird stabilisiert.\"}");
    }
    return;
  }
  if (bleReuseExistingIdentity) {
    if (bleLastProgressAt && now - bleLastProgressAt < 3000) return;
    bleLastProgressAt = now;
    if (!beginVereinskasseRequest(commandApiUrl())) {
      bleNotifyJson("{\"state\":\"retrying_server\",\"message\":\"Sichere Verbindung wird erneut vorbereitet.\"}");
      return;
    }
    vereinskasseHttps.addHeader("X-RFID-Token", rfidDeviceToken);
    vereinskasseHttps.addHeader("X-RFID-Firmware-Version", FIRMWARE_VERSION);
    const int status = vereinskasseHttps.GET();
    vereinskasseHttps.end();
    if (status == 200 || status == 204) {
      bleNotifyJson("{\"state\":\"approved\",\"hardwareId\":\"" + hardwareId() + "\"}");
      bleSetupInProgress = false;
      bleReuseExistingIdentity = false;
      serverFailureSince = 0;
      lastPushState = "Bestehender Leser ist im ClubIQ-Kassen-WLAN angemeldet.";
      setStatusLed(StatusLedMode::Success, 1400);
      showStatusDisplay("ClubIQ verbunden", "RFID bereit");
      return;
    }
    if (status == 401 || status == 403) {
      // Die lokale Kennung gehoert nicht mehr zur Datenbank. Sicher auf eine
      // neue Kopplung zurueckfallen, statt dauerhaft offline zu bleiben.
      if (!saveServerSettings(vereinskasseApiUrl, "", vereinskasseRootCa)) {
        rejectBleProvisioning("Alte Geraetefreigabe konnte nicht erneuert werden.");
        return;
      }
      bleReuseExistingIdentity = false;
      bleLastProgressAt = 0;
    } else {
      const String detail = status < 0
          ? String(HTTPClient::errorToString(status).c_str()) + " (Fehler " + String(status) + ")"
          : "HTTP " + String(status);
      bleNotifyJson("{\"state\":\"retrying_server\",\"message\":\"ClubIQ noch nicht erreichbar: " +
                    jsonEscape(detail) + ". Neuer Versuch laeuft.\"}");
      return;
    }
  }
  if (pairingActive) {
    if (!bleLastProgressAt || now - bleLastProgressAt > 3000) {
      bleLastProgressAt = now;
      bleNotifyJson("{\"state\":\"pairing\",\"hardwareId\":\"" + hardwareId() +
                    "\",\"code\":\"" + pairingCode + "\"}");
    }
    return;
  }
  if (blePairingSent) return;
  if (bleLastProgressAt && now - bleLastProgressAt < 3000) return;
  bleLastProgressAt = now;
  if (!pairingSecret.length()) {
    pairingSecret = secureRandomHex(32);
    char codeBuffer[7];
    snprintf(codeBuffer, sizeof(codeBuffer), "%06lu", secureRandomWord() % 1000000UL);
    pairingCode = codeBuffer;
  }
  pairingState = "requesting";
  pairingMessage = "Bluetooth-Kopplung wird an ClubIQ gesendet.";
  if (sendPairingRequest()) {
    blePairingSent = true;
    return;
  }
  bleNotifyJson("{\"state\":\"retrying_server\",\"message\":\"" +
                jsonEscape(pairingMessage) + "\"}");
}

void processBleRuntime() {
  if (!bleClientConnected) return;
  const unsigned long now = millis();
  if (bleSessionActive && writeCommandActive && writeResultReady &&
      !bleCommandResultPending) {
    queueBleCommandResult(writeCommandId, writeResultSuccess, writeCommandUid,
                          writeResultHex, writeResultError);
    writeCommandActive = false;
    writeResultReady = false;
    writeCommandId = "";
  }
  if (bleSessionActive && now - bleSessionStartedAt >= BLE_SESSION_MAX_MS) {
    clearBleSession();
    bleNotifyJson("{\"state\":\"session_expired\",\"hardwareId\":\"" +
                  hardwareId() + "\"}");
    return;
  }
  if (bleSessionActive && blePendingScanReady &&
      (!bleLastScanNotifyAt || now - bleLastScanNotifyAt >= BLE_SCAN_RETRY_MS))
    sendBlePendingScan();
  if (bleSessionActive &&
      (!bleLastHeartbeatAt || now - bleLastHeartbeatAt >= BLE_HEARTBEAT_MS))
    sendBleHeartbeat();
  if (bleSessionActive && bleCommandResultPending &&
      (!bleLastResultNotifyAt || now - bleLastResultNotifyAt >= BLE_SCAN_RETRY_MS))
    sendBleCommandResult();
  if (bleOtaActive && bleOtaExpectedSize &&
      (!bleOtaLastProgressAt || now - bleOtaLastProgressAt >= 1200)) {
    bleOtaLastProgressAt = now;
    const int percent = static_cast<int>((bleOtaWritten * 100UL) / bleOtaExpectedSize);
    bleNotifyJson("{\"state\":\"ota_progress\",\"percent\":" +
                  String(percent) + "}");
  }
}

void startBleProvisioning() {
  const String deviceName = "ClubIQ-RFID-" + macSuffix();
  BLEDevice::init(deviceName.c_str());
  BLEDevice::setMTU(247);
  BLEDevice::setEncryptionLevel(ESP_BLE_SEC_ENCRYPT);
  BLESecurity *security = new BLESecurity();
  security->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);
  security->setCapability(ESP_IO_CAP_NONE);
  BLEServer *bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ClubIqBleServerCallbacks());
  BLEService *service = bleServer->createService(BLE_SERVICE_UUID);
  BLECharacteristic *rx = service->createCharacteristic(
      BLE_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  rx->setCallbacks(new ClubIqBleRxCallbacks());
  bleTx = service->createCharacteristic(
      BLE_TX_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  bleTx->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED);
  bleTx->addDescriptor(new BLE2902());
  bleOta = service->createCharacteristic(
      BLE_OTA_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  bleOta->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  bleOta->setCallbacks(new ClubIqBleOtaCallbacks());
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.printf("Bluetooth-Einrichtung: %s\n", deviceName.c_str());
}
#endif

String macSuffix() {
  char buf[7];
#if defined(CLUBIQ_ESP32_BLE)
  snprintf(buf, sizeof(buf), "%06X", static_cast<uint32_t>(ESP.getEfuseMac() & 0xFFFFFF));
#else
  snprintf(buf, sizeof(buf), "%06X", ESP.getChipId() & 0xFFFFFF);
#endif
  return String(buf);
}

String hardwareId() {
#if defined(CLUBIQ_ESP32_BLE)
  return "ESP32-" + macSuffix();
#else
  return "ESP8266-" + macSuffix();
#endif
}

bool directBleRuntimeMode() {
  // Bluetooth dient nur noch der einmaligen Einrichtung und dem Notfallweg.
  // Der laufende Kassenbetrieb geht immer direkt per WLAN zum Raspberry.
  return false;
}

void startMaintenanceAp() {
  if (maintenanceApActive) return;
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(apSsid.c_str(), apPassword.c_str(), 6, false, 2)) {
    Serial.println("FEHLER: WLAN-AP konnte nicht gestartet werden.");
    return;
  }
  maintenanceApActive = true;
  Serial.printf("Wartungs-WLAN aktiv: %s, Adresse %s\n", apSsid.c_str(),
                WiFi.softAPIP().toString().c_str());
}

void stopMaintenanceAp() {
  if (!maintenanceApActive) return;
  WiFi.softAPdisconnect(true);
  maintenanceApActive = false;
  WiFi.mode(WIFI_STA);
  Serial.println("Wartungs-WLAN beendet; ClubIQ-Kassen-WLAN ist verbunden.");
}

void startReaderWifi() {
  WiFi.mode(WIFI_STA);
#if !defined(CLUBIQ_ESP32_BLE)
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
#endif
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  if (!stationConfigured()) startMaintenanceAp();
  maintainStationWifi();
}

#if defined(CLUBIQ_ESP32_BLE)
void disableWifiForBleRuntime() {
  stationReconnectPending = false;
  stationWasConnected = false;
  clockWasReady = false;
  timeSyncStarted = false;
  wifiDisconnectedSince = 0;
  lastWifiAttempt = 0;
  pendingUidReady = false;
  serverFailureSince = 0;
  vereinskasseHttps.end();
  vereinskasseTls.stop();
  WiFi.softAPdisconnect(true);
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
  lastPushState = "Bluetooth-Direktbetrieb; Leser-WLAN deaktiviert.";
}
#endif

void setup() {
  Serial.begin(115200);
  delay(300);
  enableWatchdog();
  statusPixels.begin();
  statusPixels.setBrightness(STATUS_LED_BRIGHTNESS);
  statusPixels.clear();
  statusPixels.show();
  startStatusLedTest();
  while (statusLedTestActive) {
    renderStatusLed();
    feedWatchdog();
    delay(2);
  }
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
  loadServerSettings();

  // Bluetooth vor dem WLAN initialisieren. Das verhindert, dass die
  // Funk-Koexistenz beim Start die BLE-Werbung ausbremst.
#if defined(CLUBIQ_ESP32_BLE)
  startBleProvisioning();
  delay(200);
#endif

#if defined(CLUBIQ_ESP32_BLE)
  if (directBleRuntimeMode()) {
    disableWifiForBleRuntime();
    setStatusLed(StatusLedMode::Pairing);
    showStatusDisplay("Bluetooth", "Tablet wird gesucht");
  } else {
    startReaderWifi();
  }
#else
  startReaderWifi();
#endif

  server.on("/", HTTP_GET, [] {
    if (!authorized()) return;
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(200, "text/html; charset=utf-8", INDEX_HTML);
  });
  server.on("/api/uid", HTTP_GET, handleUid);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/led-test", HTTP_POST, handleLedTest);
  server.on("/api/wifi", HTTP_POST, handleWifiSave);
  server.on("/api/wifi", HTTP_DELETE, handleWifiDelete);
  server.on("/api/wifi/scan", HTTP_GET, handleWifiScan);
  server.on("/api/server", HTTP_GET, handleServerSettingsGet);
  server.on("/api/server", HTTP_POST, handleServerSettingsSave);
  server.on("/api/server/test", HTTP_POST, handleServerConnectionTest);
  server.on("/api/pair/start", HTTP_POST, handlePairingStart);
  server.on("/api/read", HTTP_POST, handleRead);
  server.on("/api/write", HTTP_POST, handleWrite);
  server.onNotFound([] { if (authorized()) json(404, "{\"error\":\"Nicht gefunden.\"}"); });
  server.begin();

  Serial.println("\n=== NodeMCU V3 NFC/RFID ===");
  Serial.printf("Firmware: %s\n", FIRMWARE_VERSION);
  Serial.printf("RC522 Version: 0x%02X\n", rfid.PCD_ReadRegister(MFRC522::VersionReg));
  if (maintenanceApActive) {
    Serial.printf("WLAN: %s\nWLAN-Kennwort: %s\n", apSsid.c_str(), apPassword.c_str());
    Serial.printf("Adresse: http://%s\nWeb-Benutzer: %s\nWeb-Kennwort: %s\n",
                  WiFi.softAPIP().toString().c_str(), webUser.c_str(), webPassword.c_str());
  } else {
    Serial.printf("Betriebsart: ClubIQ-WLAN direkt, SSID: %s\n", clubWifiSsid.c_str());
  }
  if (!stationConfigured()) {
    Serial.println("Vereinskasse: noch nicht eingerichtet (include/secrets.h fehlt oder WLAN leer).");
  } else if (!pushConfigured()) {
    Serial.println("Vereinskasse: WLAN eingetragen, aber Token oder Root-CA fehlt.");
  } else {
    Serial.println("Vereinskasse: sichere UID-Übertragung ist eingerichtet.");
    Serial.printf("Kassenserver: %s\n", vereinskasseApiUrl.c_str());
  }
}

void loop() {
  feedWatchdog();
  server.handleClient();
  processStationReconnect();
  maintainStationWifi();
#if defined(CLUBIQ_ESP32_BLE)
  processBleProvisioning();
  processBleRuntime();
#endif
  // Kartenscans haben Vorrang vor der langsameren HTTPS-Abfrage nach
  // Schreibaufträgen, damit ein Mitgliederwechsel sofort erkannt wird.
  automaticUidScan();
  retryPendingUid();
  maintainRfidReader();
  pollPairingApproval();
  pollWriteCommand();
  processWriteCommand();
  selfRecoverIfStalled();
  renderStatusLed();
  delay(2);
}
