# NodeMCU V3 (ESP8266) + MFRC522 NFC/RFID-Webgerät

Ein WLAN-Leser/-Schreiber für **MIFARE Classic** mit direkter Anbindung an die
Vereinskasse. Der ESP8266 behält sein eigenes Wartungs-WLAN unter
`http://192.168.4.1` und verbindet sich gleichzeitig mit dem Vereins-WLAN. Neue
Kartenscans werden als UID verschlüsselt an die Vereinskasse übertragen.

Kontostände, Beträge, Namen und Berechtigungen liegen ausschließlich in der
Kassendatenbank. Die beschreibbaren Kartendaten werden dafür nicht vertraut.

## 1. Stückliste

| Menge | Bauteil | Spezifikation / Hinweis |
|---:|---|---|
| 1 | NodeMCU V3 | ESP8266/ESP-12E oder ESP-12F, 3,3-V-Logik |
| 1 | MFRC522/RC522-Modul | SPI, **nur mit 3,3 V versorgen** |
| 1 | WS2812B-Streifen/-Modul | 5 V, drei Anschlüsse `5V`, `DIN`, `GND` |
| 1 | 74AHCT125 oder 74HCT245 | zuverlässige Pegelanpassung von 3,3 V auf 5 V |
| 1 | Widerstand | 330–470 Ω in der Datenleitung vor `DIN` |
| 1 | Elektrolytkondensator | 500–1000 µF, mindestens 6,3 V |
| 7 | Dupont-Kabel | Buchse–Buchse, möglichst kurz (<20 cm) |
| 1 | USB-Datenkabel | passend zum DevKit |
| 1 | 5-V-USB-Netzteil/Powerbank | mindestens 500 mA |
| optional | Gehäuse | Kunststoff; keine Metallplatte direkt an der Antenne |
| zum Test | MIFARE Classic 1K | bekannte, eigene Karte mit Standardschlüssel |

Kein Pegelwandler ist erforderlich, weil beide Baugruppen mit 3,3-V-Logik arbeiten.

## 2. Verdrahtung

Vor dem Verdrahten USB/Strom abziehen.

| MFRC522 | NodeMCU V3 | Bedeutung |
|---|---:|---|
| 3.3V | 3V3 | Versorgung (niemals 5 V) |
| GND | GND | Masse |
| SDA / SS | D2 (GPIO 4) | SPI Chip Select |
| SCK | D5 (GPIO 14) | SPI-Takt |
| MOSI | D7 (GPIO 13) | SPI-Daten zum Leser |
| MISO | D6 (GPIO 12) | SPI-Daten zum ESP8266 |
| RST | D1 (GPIO 5) | Reset |
| IRQ | nicht verbinden | nicht benötigt |

### WS2812B-Statusanzeige

Für einen stabilen Dauerbetrieb wird die Datenleitung über einen
**74AHCT125/74HCT245-Pegelwandler** geführt:

| Verbindung | Ziel |
|---|---|
| NodeMCU D0 (GPIO 16) | 74AHCT125 Eingang `1A` |
| 74AHCT125 `1OE` | GND |
| 74AHCT125 `1Y` | über 330–470 Ω an WS2812B `DIN` |
| 74AHCT125 `VCC` | 5 V |
| WS2812B `5V` | ausreichend starkes 5-V-Netzteil |
| WS2812B `GND` | Netzteil-GND **und** NodeMCU-GND |
| 500–1000-µF-Kondensator | direkt zwischen `5V` und `GND` am Streifenanfang |

Die Pfeilrichtung auf dem Streifen muss vom Anschluss weg zeigen; verwendet
wird der Eingang `DIN`, nicht `DOUT`. In `include/config.h` ist die Anzeige auf
die fünf LEDs am Leser eingestellt. Ein langer Streifen darf nicht aus dem
3,3-V-Anschluss des NodeMCU versorgt werden.

Statusfarben:

- orange pulsierend: Gerät startet
- blau pulsierend: Vereins-WLAN oder sichere Uhrzeit noch nicht bereit
- gedämpft türkis: Leser bereit
- violett: Chip erkannt bzw. Schreibvorgang läuft
- violett pulsierend: erwarteten Chip zum Beschreiben auflegen
- grün: Scan übertragen oder Schreiben erfolgreich
- rot blinkend: WLAN-, Server-, Karten- oder Schreibfehler

```text
Tablet ))) WLAN ))) NodeMCU ── SPI ── MFRC522 ))) Karte
                         3,3 V ────────┘
```

## 3. Flashen mit PlatformIO (empfohlen)

1. VS Code und die Erweiterung **PlatformIO IDE** installieren.
2. Diesen Ordner öffnen.
3. NodeMCU per USB-Datenkabel anschließen.
4. In PlatformIO „Upload“ wählen. Alternativ im Terminal:
   `pio run -t upload`
5. Danach den seriellen Monitor mit 115200 Baud öffnen:
   `pio device monitor`
6. Dort stehen WLAN-Name, WLAN-Kennwort, Web-Benutzer und Web-Kennwort.

Die Kennwörter werden deterministisch aus der eindeutigen ESP8266-Chip-ID
gebildet. Sie sind daher pro Gerät verschieden und bleiben nach Neustarts gleich.
Für ein höheres Schutzniveau eigene lange Kennwörter in `include/config.h`
eintragen.

## 4. Verbindung mit der Vereinskasse

1. In der Vereinskasse als Administrator **Admin → Sicherheit → RFID-Leser**
   öffnen und einen Leser anlegen.
2. Den einmal angezeigten Geräte-Token sicher kopieren.
3. `include/secrets.example.h` als `include/secrets.h` kopieren.
4. In `secrets.h` Vereins-WLAN und Geräte-Token eintragen. Die zur aktuellen
   `*.floh510.chatgpt.site`-Zertifikatskette passende Root-CA ist bereits enthalten.
   Bei einem anderen Host muss sie ersetzt werden.
5. Firmware erneut hochladen und den seriellen Monitor öffnen.

`include/secrets.h` wird durch `.gitignore` nicht in Git gespeichert. Der
Geräte-Token und das WLAN-Kennwort werden nicht im seriellen Monitor ausgegeben.
Ohne Root-CA sendet die Firmware absichtlich nichts; unsicheres TLS ist nicht
vorgesehen.

Wichtig: Eine als **privat** geschützte Vorschau-Webseite kann der ESP8266 nicht
anmelden. Für den echten Leser muss die Vereinskasse öffentlich erreichbar sein
oder der Scan über einen lokalen Vermittlungsserver laufen. Die RFID-Route selbst
bleibt durch den zufälligen Geräte-Token geschützt.

Beim Start arbeitet das Gerät im kombinierten Modus:

- Wartungs-WLAN `NFC-Reader-xxxxxx` für Diagnose, Lesen und Schreiben
- Verbindung zum Vereins-WLAN für NTP-Zeit und HTTPS-Übertragung
- automatische Wiederverbindung nach WLAN-Ausfällen
- kurze Wiederholungssperre gegen versehentliche Doppelscans
- sichere Schreibaufträge aus dem Adminbereich mit UID-Prüfung und Rücklesen

Der lokale Status ist nach Anmeldung unter `http://192.168.4.1` sichtbar.

### Beschreiben aus der Vereinskassen-App

Im Adminbereich beim Mitglied **RFID-Karte** wählen. Nach dem ersten Scan kann
die UID nur zugeordnet oder zusätzlich ein freier Datenblock beschriftet
werden. Für einen Schreibauftrag die Karte kurz abnehmen und erneut auflegen.
Die Firmware akzeptiert nur den Auftrag für die erwartete UID, sperrt Block 0
und Sektor-Trailer und meldet erst nach erfolgreichem Rücklesen „Fertig“.

Die App schreibt lediglich eine optionale Kurzbezeichnung bis 16 Byte. Diese
Beschriftung ist kein Berechtigungsnachweis; alle verbindlichen Daten bleiben
in der Vereinskassen-Datenbank.

### Arduino IDE

ESP8266-Boardpaket und die Bibliothek **MFRC522 by GithubCommunity** installieren.
`src/main.cpp` als `.ino` übernehmen und `include/web_ui.h` sowie
`include/config.h` als weitere Tabs/Dateien einfügen. Board „NodeMCU 1.0
(ESP-12E Module)“,
Upload Speed 460800, serieller Monitor 115200.

## 5. Bedienung

1. Tablet mit dem angezeigten WLAN `NFC-Reader-xxxxxx` verbinden. Android kann
   „kein Internet“ melden; trotzdem verbunden bleiben.
2. Im Browser `http://192.168.4.1` öffnen und Web-Zugangsdaten eingeben.
3. Karte plan auf die Antenne legen, dann **UID lesen**.
4. Für einen Datenblock Blocknummer und Key A oder Key B auswählen. Der übliche
   Werksschlüssel ist `FFFFFFFFFFFF`.
5. Lesen zeigt exakt 16 Byte als Hex und als druckbaren Text.
6. Schreiben akzeptiert 32 Hex-Zeichen oder Text (UTF-8-Bytes, mit Nullen auf
   16 Byte aufgefüllt). Zusätzlich muss `SCHREIBEN` bestätigt werden.
7. Nach jedem Schreiben liest die Firmware den Block zurück und vergleicht ihn.

Nur eigene bzw. ausdrücklich autorisierte Karten beschreiben. Vorher Daten sichern.

## 6. Sichere Grenzen

- Block **0** (Herstellerblock/UID) ist nicht beschreibbar.
- Jeder Sektor-Trailer (Block 3, 7, 11, …; bei 4K ab Sektor 32 andere Geometrie)
  ist für Schreibvorgänge gesperrt. Damit können Schlüssel und Access Bits nicht
  versehentlich zerstört werden.
- Gültig sind Block 0–63 für Classic 1K und 0–255 für Classic 4K. Die Firmware
  erkennt die Kartengröße und lehnt Bereiche außerhalb davon ab.
- Die Verbindung ist lokales HTTP, nicht HTTPS. WPA2 und HTTP-Basic-Auth schützen
  den Zugang, aber für sensible/produktive Systeme ist das keine
  Hochsicherheitslösung.
- MIFARE Classic Crypto1 gilt als kryptografisch gebrochen. Keine Geheimnisse,
  Zutrittsrechte oder Zahlungsdaten allein darauf absichern.
- Die UID ist eine praktische Kennung, aber kein fälschungssicherer
  Identitätsnachweis. Eine zugeordnete Vorstandskarte kann eine Admin-Sitzung
  starten; die Rolle kommt ausschließlich aus der Datenbank und der Einstieg
  wird protokolliert. Verlorene Karten müssen sofort getrennt werden.
- Der Geräte-Token kann in der Vereinskasse deaktiviert und durch einen neu
  angelegten Leser ersetzt werden.

## 7. Grenzen des RC522

Der MFRC522 ist ein 13,56-MHz-Frontend für ISO/IEC 14443 A/MIFARE/NTAG. Dieses
Projekt implementiert Lesen/Schreiben von **MIFARE Classic 1K/4K**. UID-Lesen
funktioniert auch bei mehreren ISO-14443-A-Tags, sofern der Chip sie erkennt.

Nicht zugesichert bzw. nicht unterstützt:

- NFC Forum Type 4 / ISO-DEP (z. B. viele Smartphones und moderne Smartcards)
- Kredit-/Debitkarten-EMV-Daten oder sichere Bezahlfunktionen
- Smartphone Card Emulation
- NDEF-Komfortfunktionen; NTAG/Ultralight-Schreiben ist hier nicht implementiert
- 125-kHz-RFID (EM4100/T5577)
- geklonte „Magic Cards“ und UID-Änderung

Für breitere NFC-Kompatibilität ist ein PN532/PN7150 meist geeigneter.

## 8. Fehlerhilfe

- `Version=0x00/0xFF`: Versorgung oder SPI-Leitungen prüfen; Kabel kürzen.
- Karte wird nicht erkannt: Es muss 13,56 MHz/ISO 14443 A sein; mittig auflegen.
- Authentifizierung fehlgeschlagen: falscher Schlüssel oder Access Bits.
- Schreiben verweigert: geschützter Block, falsche Kartengröße oder Access Bits.
- Tablet öffnet die Seite nicht: mobile Daten kurz deaktivieren und
  `http://192.168.4.1` ausdrücklich mit `http://` eingeben.
- Vereins-WLAN bleibt getrennt: SSID/Kennwort in `include/secrets.h` prüfen;
  2,4-GHz-WLAN verwenden.
- „Warte auf sichere Uhrzeit“: Internetzugriff auf NTP ist noch nicht möglich.
- „Übertragung nicht eingerichtet“: Geräte-Token oder Root-CA fehlt.
- HTTP 401/403: Geräte-Token ist falsch, deaktiviert oder der private
  Hosting-Zugang blockiert das Gerät.
- TLS-Fehler: Root-CA passt nicht zum aktuell verwendeten Serverzertifikat.

## Ordner

```text
NodeMCU-V3-RC522-Tablet/
├── include/
│   ├── config.h       Gerätepins und optionale eigene Zugangsdaten
│   ├── secrets.example.h Vorlage für WLAN, Geräte-Token und Root-CA
│   ├── secrets.h      lokale Geheimnisse (nicht in Git)
│   └── web_ui.h       responsive deutsche Oberfläche
├── src/
│   └── main.cpp       Firmware und API
├── platformio.ini     reproduzierbare Build-Konfiguration
├── LICENSE
└── README.md
```

## Quellen

- NXP, MFRC522-Datenblatt: https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf
- ESP8266 Arduino Core, WLAN-Dokumentation:
  https://arduino-esp8266.readthedocs.io/en/latest/esp8266wifi/readme.html
- MFRC522-Bibliothek: https://github.com/miguelbalboa/rfid
