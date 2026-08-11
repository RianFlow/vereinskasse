#pragma once

constexpr char FIRMWARE_VERSION[] = "1.9.5";

// WEMOS/LOLIN ESP32 D1 mini: VSPI plus Pins ohne Boot-Strapping-Konflikte.
constexpr int PIN_RC522_SS = 5;   // D8
constexpr int PIN_RC522_RST = 17; // D3
// Hardware-SPI: D5/SCK GPIO 18, D6/MISO GPIO 19, D7/MOSI GPIO 23.
constexpr int PIN_STATUS_LED = 16; // D4
constexpr int PIN_I2C_SDA = 21;
constexpr int PIN_I2C_SCL = 22;

// WS2812B-Statusstreifen am ESP32 D1 mini.
constexpr uint16_t STATUS_LED_COUNT = 5;
constexpr uint8_t STATUS_LED_BRIGHTNESS = 90;
constexpr unsigned long STATUS_LED_TEST_STEP_MS = 180;

// Optionales I2C-Statusdisplay: SSD1306, 128 x 64 Pixel.
// Der separate I2C-Bus liegt auf den üblichen, boot-sicheren ESP32-Pins.
constexpr bool ENABLE_I2C_STATUS_DISPLAY = true;
constexpr uint8_t STATUS_DISPLAY_ADDRESS = 0x3C;
constexpr uint16_t STATUS_DISPLAY_WIDTH = 128;
constexpr uint16_t STATUS_DISPLAY_HEIGHT = 64;
// Zweifarbige OLEDs haben die gelbe Zone fest in den Pixelzeilen 0 bis 15.
constexpr uint8_t STATUS_DISPLAY_HEADER_HEIGHT = 16;

// secrets.h wird absichtlich nicht in Git gespeichert. Ohne eigene secrets.h
// baut die Firmware mit leeren Beispielwerten und bleibt im Wartungsmodus.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 15000;
// Ist nur das Kassen-WLAN laenger nicht erreichbar, bietet der Leser zeitweise
// die Bluetooth-Wiederherstellung an. Danach startet er selbststaendig neu und
// versucht wieder die gespeicherte WLAN-Verbindung. Ein bloßer Serverneustart
// aktiviert Bluetooth nicht.
constexpr unsigned long WIFI_BLE_RECOVERY_START_MS = 90000;
constexpr unsigned long BLE_RECOVERY_WINDOW_MS = 5UL * 60UL * 1000UL;
constexpr char KIOSK_TIME_URL[] = "http://10.42.0.1:8080/clubiq-time";
constexpr unsigned long RFID_SCAN_INTERVAL_MS = 120;
constexpr unsigned long RFID_REPEAT_GUARD_MS = 1500;
// Karten-Schreibaufträge sind selten. Eine häufigere HTTPS-Abfrage würde den
// wichtigeren UID-Scan unnötig blockieren.
constexpr unsigned long RFID_COMMAND_POLL_INTERVAL_MS = 5000;
// Der erste lokale TLS-Handshake kann auf dem ESP32 waehrend der einmaligen
// Bluetooth-Einrichtung mehrere Sekunden benoetigen. Ein zu kurzes Zeitfenster
// laesst ein korrekt erreichbares Kassen-WLAN faelschlich als TLS-Fehler
// erscheinen.
constexpr unsigned long HTTPS_TIMEOUT_MS = 8000;
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
