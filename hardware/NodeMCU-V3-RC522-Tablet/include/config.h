#pragma once

// NodeMCU V3 / ESP8266: Hardware-SPI plus sichere freie Pins.
// D-Bezeichnungen stehen nur auf der Platine; hier werden GPIO-Nummern verwendet.
constexpr int PIN_RC522_SS = 4;    // D2
constexpr int PIN_RC522_RST = 5;   // D1
// Hardware-SPI ist beim ESP8266 fest: SCK D5, MISO D6, MOSI D7.

// WS2812B-Statusstreifen. D0 ist frei und beeinflusst den Bootvorgang nicht.
// Nur so viele LEDs eintragen, wie am Leser tatsächlich leuchten sollen.
constexpr int PIN_STATUS_LED = 16;       // D0
constexpr uint16_t STATUS_LED_COUNT = 5;
constexpr uint8_t STATUS_LED_BRIGHTNESS = 38;

// Optionales I2C-Statusdisplay: SSD1306, 128 x 64 Pixel.
// D1/D2 werden bereits vom RC522 verwendet, daher liegt der separate I2C-Bus
// auf D3/D4. Beide Pins muessen beim Einschalten HIGH bleiben (Boot-Pins).
constexpr bool ENABLE_I2C_STATUS_DISPLAY = true;
constexpr int PIN_I2C_SDA = 0;           // D3 / GPIO 0
constexpr int PIN_I2C_SCL = 2;           // D4 / GPIO 2
constexpr uint8_t STATUS_DISPLAY_ADDRESS = 0x3C;
constexpr uint16_t STATUS_DISPLAY_WIDTH = 128;
constexpr uint16_t STATUS_DISPLAY_HEIGHT = 64;

// Leer lassen: geräteabhängige Werte werden aus der Chip-ID erzeugt.
// Eigene Werte: AP mindestens 8, Web-Passwort möglichst mindestens 12 Zeichen.
constexpr char CUSTOM_AP_SSID[] = "";
constexpr char CUSTOM_AP_PASSWORD[] = "";
constexpr char CUSTOM_WEB_USER[] = "admin";
constexpr char CUSTOM_WEB_PASSWORD[] = "";

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
constexpr unsigned long STATUS_DISPLAY_SCREENSAVER_MS = 12000;
// Rückfallsicherung: Ein erkannter Scan bleibt im RAM, bis der Server ihn
// bestätigt. Die Abstände wachsen, damit ein Ausfall den Server nicht flutet.
constexpr unsigned long UID_RETRY_INITIAL_MS = 1000;
constexpr unsigned long UID_RETRY_MAX_MS = 30000;
constexpr unsigned long RFID_HEALTHCHECK_INTERVAL_MS = 30000;
constexpr unsigned long SELF_RECOVERY_RESTART_MS = 5UL * 60UL * 1000UL;

// Das Vereins-WLAN wird im EEPROM gespeichert und bleibt dadurch bei normalen
// Firmware-Updates erhalten. Ein kompletter Flash-Erase löscht es weiterhin.
constexpr size_t WIFI_SETTINGS_EEPROM_SIZE = 256;
constexpr int WIFI_SETTINGS_EEPROM_ADDRESS = 0;
