# ClubIQ-RFID-Leser – ESP32 D1 mini

Diese Firmware unterstützt ausschließlich den WEMOS/LOLIN ESP32 D1 mini.
Die frühere ESP8266- und Browser-Bluetooth-Verbindung ist entfernt.

## Betriebsablauf

1. Ohne gültige Einstellung startet der Leser `ClubIQ-Setup-…` mit einem im
   Display angezeigten Zufallskennwort.
2. Tablet oder Handy verbindet sich einmalig mit diesem WLAN und öffnet die
   automatisch angebotene Einrichtungsseite. Ersatzadresse: `http://192.168.4.1`.
3. Das 2,4-GHz-Kassen-WLAN wird aus der WLAN-Liste ausgewählt und gespeichert.
4. Der Leser startet neu, lädt das Root-Zertifikat vom Raspberry und zeigt einen
   sechsstelligen Kopplungscode an.
5. Der Code wird in ClubIQ unter **Admin > RFID-Leser** freigegeben.
6. Danach laufen Scans, Display, Chip-Schreiben, Neustart und OTA direkt über WLAN.

Bleibt das Kassen-WLAN 90 Sekunden unerreichbar oder wird in ClubIQ **WLAN
ändern** gewählt, öffnet der ESP32 das geschützte Setup-WLAN erneut. Die alte
funktionierende Konfiguration wird erst durch eine neue gespeicherte Auswahl
ersetzt.

## Anschlüsse

| Bauteil | Signal | ESP32 D1 mini |
|---|---|---|
| MFRC522 | SDA / SS | D8 / GPIO 5 |
| MFRC522 | SCK | D5 / GPIO 18 |
| MFRC522 | MISO | D6 / GPIO 19 |
| MFRC522 | MOSI | D7 / GPIO 23 |
| MFRC522 | RST | D3 / GPIO 17 |
| MFRC522 | 3,3 V | 3V3 |
| MFRC522 | GND | GND |
| SSD1306 OLED | SDA | D2 / GPIO 21 |
| SSD1306 OLED | SCL | D1 / GPIO 22 |
| WS2812B (5 LEDs) | DIN | D4 / GPIO 16 |

MFRC522 und OLED werden mit 3,3 V betrieben. Der WS2812B-Streifen darf mit 5 V
versorgt werden; alle Komponenten brauchen eine gemeinsame Masse.

## Bauen und per USB flashen

Die Befehle im Ordner mit `platformio.ini` ausführen:

```powershell
Remove-Item -Recurse -Force .pio -ErrorAction SilentlyContinue
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" pkg install -e esp32_d1_mini
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e esp32_d1_mini
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -e esp32_d1_mini -t upload
```

Das fertige Abbild liegt anschließend unter
`.pio/build/esp32_d1_mini/firmware.bin`. Für spätere Aktualisierungen lädt der
Leser die signalisierte ClubIQ-Firmware direkt über das Kassen-WLAN.

## Anzeigen

- `v<Version>` im Display: installierter Firmwarestand
- kleines WLAN-Symbol: Verbindung zum Kassen-WLAN
- kleines Serversymbol: sichere Verbindung zum Raspberry
- „RFID bereit“: Leser kann Karten annehmen
- „Setup“: mit dem angezeigten `ClubIQ-Setup-…`-WLAN verbinden
- „Kopplung“: sechsstelligen Code in ClubIQ freigeben

## Stabilitätsregeln

- kennwortgeschütztes, zeitlich begrenztes Captive Portal
- WLAN aus einer gescannten Liste auswählen statt fehleranfällig abtippen
- bei Fehlern die zuletzt funktionierende Konfiguration behalten
- WLAN-Autoreconnect und gepufferte RFID-Scans
- lokaler Zeitabgleich vor TLS
- verifiziertes Root-Zertifikat, niemals `setInsecure()`
- sechsstellige physische Kopplungsfreigabe und individuelles Gerätetoken
- automatische Rückkehr zum gespeicherten WLAN

Vor der Einrichtung kann der Raspberry mit `sudo clubiq rfid-netz-pruefen`
getestet werden. Referenzen: PlatformIO-Board `wemos_d1_mini32`,
[Arduino-ESP32 WiFi-Events](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html)
und [WiFiManager](https://github.com/tzapu/WiFiManager).
