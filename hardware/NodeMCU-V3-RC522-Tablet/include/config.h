#pragma once

constexpr char FIRMWARE_VERSION[] = "1.7.1";

#if defined(CLUBIQ_ESP32_BLE)
// ESP32-WROOM-32 / ESP32 DevKit: VSPI plus Pins ohne Boot-Strapping-Konflikte.
constexpr int PIN_RC522_SS = 5;
constexpr int PIN_RC522_RST = 27;
// Hardware-SPI: SCK GPIO 18, MISO GPIO 19, MOSI GPIO 23.
constexpr int PIN_STATUS_LED = 13;
constexpr int PIN_I2C_SDA = 21;
constexpr int PIN_I2C_SCL = 22;
#else
// NodeMCU V3 / ESP8266: Hardware-SPI plus sichere freie Pins.
// D-Bezeichnungen stehen nur auf der Platine; hier werden GPIO-Nummern verwendet.
constexpr int PIN_RC522_SS = 4;    // D2
constexpr int PIN_RC522_RST = 5;   // D1
// Hardware-SPI ist beim ESP8266 fest: SCK D5, MISO D6, MOSI D7.
constexpr int PIN_STATUS_LED = 15; // D8
constexpr int PIN_I2C_SDA = 0;     // D3 / GPIO 0
constexpr int PIN_I2C_SCL = 2;     // D4 / GPIO 2
#endif

// WS2812B-Statusstreifen. GPIO 16 / D0 wird absichtlich nicht verwendet:
// Die schnelle ESP8266-Ausgabe der NeoPixel-Bibliothek arbeitet mit GPIO 0–15.
// D8 / GPIO 15 ist frei und besitzt auf dem NodeMCU bereits den nötigen
// Boot-Pulldown. Am LED-Dateneingang darf deshalb kein Pull-up angeschlossen sein.
constexpr uint16_t STATUS_LED_COUNT = 5;
constexpr uint8_t STATUS_LED_BRIGHTNESS = 90;
constexpr unsigned long STATUS_LED_TEST_STEP_MS = 180;

// Optionales I2C-Statusdisplay: SSD1306, 128 x 64 Pixel.
// D1/D2 werden bereits vom RC522 verwendet, daher liegt der separate I2C-Bus
// auf D3/D4. Beide Pins muessen beim Einschalten HIGH bleiben (Boot-Pins).
constexpr bool ENABLE_I2C_STATUS_DISPLAY = true;
constexpr uint8_t STATUS_DISPLAY_ADDRESS = 0x3C;
constexpr uint16_t STATUS_DISPLAY_WIDTH = 128;
constexpr uint16_t STATUS_DISPLAY_HEIGHT = 64;
// Zweifarbige OLEDs haben die gelbe Zone fest in den Pixelzeilen 0 bis 15.
constexpr uint8_t STATUS_DISPLAY_HEADER_HEIGHT = 16;

// Leer lassen: geräteabhängige Werte werden aus der Chip-ID erzeugt.
// Eigene Werte: AP mindestens 8, Web-Passwort möglichst mindestens 12 Zeichen.
constexpr char CUSTOM_AP_SSID[] = "";
constexpr char CUSTOM_AP_PASSWORD[] = "";
constexpr char CUSTOM_WEB_USER[] = "admin";
constexpr char CUSTOM_WEB_PASSWORD[] = "svbarverdarts";

// secrets.h wird absichtlich nicht in Git gespeichert. Ohne eigene secrets.h
// baut die Firmware mit leeren Beispielwerten und bleibt im Wartungsmodus.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 15000;
constexpr unsigned long RFID_SCAN_INTERVAL_MS = 120;
constexpr unsigned long RFID_REPEAT_GUARD_MS = 1500;
// Karten-Schreibaufträge sind selten. Eine häufigere HTTPS-Abfrage würde den
// wichtigeren UID-Scan unnötig blockieren.
constexpr unsigned long RFID_COMMAND_POLL_INTERVAL_MS = 5000;
constexpr unsigned long RFID_PAIRING_POLL_INTERVAL_MS = 1200;
// Solange die lokale Wartungsseite benutzt wird, pausieren langsamere
// HTTPS-Hintergrundabfragen. Dadurch reagiert die Oberfläche sofort.
constexpr unsigned long MAINTENANCE_PRIORITY_MS = 4500;
constexpr unsigned long HTTPS_TIMEOUT_MS = 2200;
constexpr unsigned long STATUS_DISPLAY_SCREENSAVER_MS = 12000;
constexpr unsigned long CUSTOMER_DISPLAY_TIMEOUT_MS = 2UL * 60UL * 1000UL;
// Rückfallsicherung: Ein erkannter Scan bleibt im RAM, bis der Server ihn
// bestätigt. Die Abstände wachsen, damit ein Ausfall den Server nicht flutet.
constexpr unsigned long UID_RETRY_INITIAL_MS = 1000;
constexpr unsigned long UID_RETRY_MAX_MS = 30000;
constexpr unsigned long RFID_HEALTHCHECK_INTERVAL_MS = 30000;
constexpr unsigned long SELF_RECOVERY_RESTART_MS = 5UL * 60UL * 1000UL;

// WLAN und Kassenserver werden im EEPROM gespeichert und bleiben dadurch bei
// normalen Firmware-Updates erhalten. Die ersten 256 Byte bleiben mit dem
// bisherigen WLAN-Layout kompatibel; die Serverdaten beginnen danach.
// Ein kompletter Flash-Erase löscht weiterhin alle Einstellungen.
constexpr size_t WIFI_SETTINGS_EEPROM_SIZE = 4096;
constexpr int WIFI_SETTINGS_EEPROM_ADDRESS = 0;
constexpr int SERVER_SETTINGS_EEPROM_ADDRESS = 256;
constexpr size_t SERVER_API_URL_MAX_BYTES = 192;
constexpr size_t SERVER_DEVICE_TOKEN_MAX_BYTES = 160;
constexpr size_t SERVER_ROOT_CA_MAX_BYTES = 2048;
