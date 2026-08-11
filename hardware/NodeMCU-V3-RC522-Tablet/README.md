# ClubIQ-RFID-Leser – ESP32 D1 mini

Diese Firmware unterstützt ausschließlich den WEMOS/LOLIN ESP32 D1 mini.
Andere Leserplattformen und ein Leser-eigenes Wartungs-WLAN werden nicht
unterstützt.

## Betriebsablauf

1. Ohne gültige Einstellungen startet der Leser nur Bluetooth.
2. In ClubIQ unter **Admin > RFID-Leser** wird der ESP32 D1 mini ausgewählt.
3. Die App überträgt Name, 2,4-GHz-Kassen-WLAN, Serveradresse und Root-Zertifikat.
4. Der Leser bestätigt das Speichern und startet neu.
5. Danach läuft nur WLAN. Scans, Display, Chip-Schreiben, Neustart und OTA gehen
   direkt zwischen Leser und Raspberry.
6. Erst eine neue Meldung des Lesers am Raspberry gilt in der App als Erfolg.

Bluetooth und WLAN werden bewusst nicht parallel betrieben. Bleibt das
Kassen-WLAN 90 Sekunden unerreichbar, beendet der ESP32 WLAN und bietet für fünf
Minuten die Bluetooth-Wiederherstellung an. Ohne Änderung startet er danach neu
und versucht wieder das gespeicherte WLAN. Ein reiner Serverausfall aktiviert
Bluetooth nicht. So übersteht der Leser Raspberry- und App-Neustarts ohne
manuelles Eingreifen; zugleich lässt sich das WLAN später ohne USB ändern.

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
- „Einrichtung“: in ClubIQ einmalig per Bluetooth auswählen

## Stabilitätsregeln

- Keine parallele BLE-/WLAN-Funknutzung
- WLAN-Autoreconnect und gepufferte RFID-Scans
- lokaler Zeitabgleich vor TLS
- verifiziertes Root-Zertifikat, niemals `setInsecure()`
- zeitlich begrenzte Bluetooth-Wiederherstellung nur bei WLAN-Ausfall
- automatische Rückkehr zum gespeicherten WLAN ohne Benutzereingriff
- App-Erfolg erst nach serverseitig frischem `last_seen_at`

Referenzen: PlatformIO-Board `wemos_d1_mini32`, Arduino-ESP32 WiFi-Events und
Espressif Wi-Fi Provisioning.
