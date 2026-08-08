# ClubIQ RFID-Leser mit ESP32-WROOM-32 oder NodeMCU V3

Ein WLAN-Leser/-Schreiber für **MIFARE Classic** mit direkter Anbindung an die
Vereinskasse. Für neue Geräte wird ein **ESP32-WROOM-32** empfohlen: Er lässt
sich in Chrome auf einem Android-Tablet direkt aus ClubIQ per Bluetooth finden
und vollständig einrichten. Der NodeMCU V3 (ESP8266) bleibt als kompatibler
Rückfall erhalten. Beide Varianten übertragen Kartenscans verschlüsselt an
ClubIQ und bieten ein eigenes Wartungs-WLAN unter `http://192.168.4.1`.

Kontostände, Beträge, Namen und Berechtigungen liegen ausschließlich in der
Kassendatenbank. Die beschreibbaren Kartendaten werden dafür nicht vertraut.

## 1. Stückliste

| Menge | Bauteil | Spezifikation / Hinweis |
|---:|---|---|
| 1 | ESP32-WROOM-32 DevKit | empfohlen; Bluetooth und WLAN, 3,3-V-Logik |
| alternativ | NodeMCU V3 | ESP8266/ESP-12E oder ESP-12F, 3,3-V-Logik |
| 1 | MFRC522/RC522-Modul | SPI, **nur mit 3,3 V versorgen** |
| 1 | WS2812B-Streifen/-Modul | 5 V, drei Anschlüsse `5V`, `DIN`, `GND` |
| optional | I²C-OLED | SSD1306, 128 × 64 Pixel, Adresse `0x3C`, 3,3-V-tauglich |
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

### Empfohlene Verdrahtung am ESP32-WROOM-32 DevKit

Die Bezeichnung `ESP32-WROOM-32` beschreibt das Funkmodul. In PlatformIO wird
für die verbreitete DevKit-Platine trotzdem das Board `esp32dev` verwendet.

| MFRC522 | ESP32 DevKit | Bedeutung |
|---|---:|---|
| 3.3V | 3V3 | Versorgung (niemals 5 V) |
| GND | GND | Masse |
| SDA / SS | GPIO 5 | SPI Chip Select |
| SCK | GPIO 18 | SPI-Takt |
| MOSI | GPIO 23 | SPI-Daten zum Leser |
| MISO | GPIO 19 | SPI-Daten zum ESP32 |
| RST | GPIO 27 | Reset |
| IRQ | nicht verbinden | nicht benötigt |

Die optionale WS2812B-Statusanzeige liegt beim ESP32 auf **GPIO 13**. Für das
OLED werden **GPIO 21 (SDA)** und **GPIO 22 (SCL)** verwendet. Masseleitungen
aller Baugruppen müssen verbunden sein.

### WS2812B-Statusanzeige

Für einen stabilen Dauerbetrieb wird die Datenleitung über einen
**74AHCT125/74HCT245-Pegelwandler** geführt:

| Verbindung | Ziel |
|---|---|
| NodeMCU D8 (GPIO 15) | 74AHCT125 Eingang `1A` |
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

Wichtig: Die Datenleitung liegt jetzt auf **D8**, nicht mehr auf D0. GPIO 16
(`D0`) wird von der schnellen ESP8266-Ausgabe der verwendeten NeoPixel-Bibliothek
nicht zuverlässig angesteuert. D8 besitzt auf dem NodeMCU den nötigen
Boot-Pulldown; deshalb keinen zusätzlichen Pull-up an D8 anschließen.

Beim Einschalten läuft automatisch ein gut sichtbarer Selbsttest: Die fünf LEDs
gehen nacheinander weiß an, anschließend leuchten alle gemeinsam rot, grün,
blau und weiß. Derselbe Test kann auf der Wartungsseite unter
`http://192.168.4.1` erneut gestartet werden.

Statusfarben:

- orange pulsierend: Gerät startet
- blau pulsierend: Vereins-WLAN oder sichere Uhrzeit noch nicht bereit
- gedämpft türkis: Leser bereit
- violett: Chip erkannt bzw. Schreibvorgang läuft
- violett pulsierend: erwarteten Chip zum Beschreiben auflegen
- grün: Scan übertragen oder Schreiben erfolgreich
- rot blinkend: WLAN-, Server-, Karten- oder Schreibfehler

### Optionales I²C-Statusdisplay

Die Firmware ist für ein übliches SSD1306-OLED mit 128 × 64 Pixeln vorbereitet.
Ist kein Display angeschlossen, startet der Leser normal weiter. Das Display
zeigt Start, WLAN-Verbindung, Bereitschaft, Scan, unbekannte Karten, Fehler und
Schreibvorgänge an. Bei einer bereits zugeordneten Karte erscheint außerdem der
Name aus der Vereinskassen-Datenbank; Kontostände und Berechtigungen werden
nicht an das Display übertragen. Während des Verkaufs stehen Name, eine kompakte
Artikelliste und Gesamtbetrag auf dem Kundendisplay. Ein leerer Bon schaltet nach zwölf
Sekunden auf ein vereinfachtes Schwarz-Weiß-Wappen des SV Barver Darts um.

Bei den verbreiteten gelb-blauen OLEDs sind die oberen 16 Pixelzeilen
hardwareseitig gelb. Die Firmware nutzt diesen Bereich ausschließlich für Name
oder Status und beginnt Artikellisten mit Abstand darunter. Dadurch werden
Buchstaben nicht mehr teilweise gelb und teilweise blau dargestellt.

| I²C-OLED | NodeMCU V3 |
|---|---|
| `VCC` | `3V3` |
| `GND` | `GND` |
| `SDA` | `D3` (GPIO 0) |
| `SCL` | `D4` (GPIO 2) |

Wichtig: D3 und D4 sind Boot-Pins und müssen beim Einschalten HIGH bleiben.
Die normalen Pull-up-Widerstände eines I²C-OLEDs nach 3,3 V sind passend.
Keine zusätzlichen Pull-down-Widerstände anschließen und die I²C-Leitungen
nicht mit 5 V betreiben. Falls das Modul die Adresse `0x3D` verwendet, in
`include/config.h` nur `STATUS_DISPLAY_ADDRESS` ändern.

Weitere I²C-Sensoren können später parallel an SDA und SCL angeschlossen werden,
sofern sie eine andere Adresse verwenden. Ein BME280 liegt typischerweise auf
`0x76` oder `0x77`; dessen Temperaturmessung ist noch nicht aktiviert.

Die Warenkorbanzeige wird über die geschützte Vereinskassen-Schnittstelle
übertragen. Deshalb funktioniert sie auch dann, wenn das Tablet nicht mit dem
Wartungs-WLAN `192.168.4.1` verbunden ist. Die Anzeige kann gegenüber dem Tablet
je nach WLAN-Verbindung ungefähr zwei bis fünf Sekunden verzögert sein. Karten-
und Schreibvorgänge werden immer vorrangig angezeigt.

```text
Tablet ))) WLAN ))) NodeMCU ── SPI ── MFRC522 ))) Karte
                         3,3 V ────────┘
```

## 3. Einmalig mit PlatformIO flashen

1. VS Code und die Erweiterung **PlatformIO IDE** installieren.
2. Diesen Ordner öffnen.
3. ESP32 oder NodeMCU per USB-Datenkabel anschließen.
4. Für den ESP32 in PlatformIO die Umgebung **`esp32dev`** wählen und „Upload“
   drücken. Alternativ im Terminal: `pio run -e esp32dev -t upload`.
5. Für einen bisherigen NodeMCU V3 stattdessen **`nodemcuv2`** wählen oder
   `pio run -e nodemcuv2 -t upload` ausführen.
6. Danach den seriellen Monitor mit 115200 Baud öffnen:
   `pio device monitor`
7. Dort stehen Wartungs-WLAN, Web-Benutzer und Web-Kennwort.

Die Kennwörter werden deterministisch aus der eindeutigen Chip-ID
gebildet. Sie sind daher pro Gerät verschieden und bleiben nach Neustarts gleich.
Für ein höheres Schutzniveau eigene lange Kennwörter in `include/config.h`
eintragen.

## 4. ESP32 direkt in ClubIQ verbinden (Android)

Ab Version 1.8.0 erledigt die ClubIQ-App die gesamte Einrichtung und den
laufenden Betrieb des ESP32.
Voraussetzungen sind Chrome auf einem Android-Tablet, eingeschaltetes Bluetooth,
die geöffnete sichere ClubIQ-Adresse und ein ESP32 mit dieser Firmware.

1. Firmware 1.8.0 einmal per USB mit der Umgebung `esp32dev` aufspielen.
2. Tablet mit dem Vereins-WLAN verbinden und ClubIQ öffnen.
3. **Admin → Sicherheit → RFID-Leser** öffnen.
4. **Android-Auswahl einmalig öffnen** drücken und im geschützten Android-Fenster
   `ClubIQ-RFID-xxxxxx` auswählen.
5. Einen leicht verständlichen Namen vergeben und **Ausgewählten Leser mit
   ClubIQ verknüpfen** drücken.
6. Bei **RFID-Leser bereit** ist die Einrichtung fertig. ClubIQ stellt die
   Verbindung nach einem Neustart oder einer Unterbrechung automatisch wieder her.

Ein bereits eingerichteter Leser bleibt für ClubIQ auffindbar. Bevor bestehende
WLAN- oder Serverdaten überschrieben werden, zeigt sein Display
**App-Freigabe – Jetzt Karte auflegen**. Eine beliebige RFID-Karte direkt am
Leser bestätigt die physische Anwesenheit; die Karte wird dabei nicht gebucht.
Ohne diese Bestätigung verwirft die Firmware die Änderung nach 90 Sekunden.

Das Tablet bleibt durchgehend im Vereins-WLAN. Der ESP32 selbst benötigt keine
Zugangsdaten zum Vereins-WLAN: Scan, Kundendisplay, Schreiben, Neustart und OTA
laufen direkt über die verschlüsselte Bluetooth-Verbindung. Das Tablet vermittelt
zum Raspberry. Ein Wechsel zum Wartungs-WLAN, Zertifikats-Upload und Abtippen
eines Codes entfallen.

Die App verwendet kurzlebige, vom Raspberry signierte Sitzungen. Scans haben
einen fortlaufenden Zähler und werden erst nach signierter Bestätigung verworfen.
Nach Verbindungsabbrüchen sendet der Leser den ausstehenden Scan erneut. Geld,
Kontostände und Berechtigungen bleiben ausschließlich in PostgreSQL.

### ESP8266 oder manueller Rückfall

Beim bisherigen ESP8266 und falls Bluetooth nicht verfügbar ist, bleibt der
Wartungsweg erhalten:

1. Tablet beziehungsweise PC mit demselben Netz wie den Raspberry verbinden.
2. `http://vereinskasse.local:8080/vereinskasse-ca.crt` herunterladen und den
   vollständigen PEM-Inhalt mit `BEGIN CERTIFICATE` und `END CERTIFICATE`
   bereithalten.
3. Wartungs-WLAN `NFC-Reader-xxxxxx` öffnen und `http://192.168.4.1` aufrufen.
4. Als Serveradresse `https://vereinskasse.local/api/rfid` eintragen.
5. Die heruntergeladene Root-CA einfügen und den Server speichern.
6. **Kopplung starten**, anschließend in Clubiq Ledger den sechsstelligen Code
   beim wartenden Leser bestätigen.

Beim Umzug vom Heimnetz in das Vereinsheim muss danach nur das Vereins-WLAN auf
der Wartungsseite geändert werden. Solange derselbe Raspberry mit demselben
Hostnamen verwendet wird, bleiben Serveradresse, Zertifikat, RFID-Zuordnungen
und Datenbank unverändert. Das Vereins-WLAN muss direkte Verbindungen zwischen
Raspberry und Leser erlauben; ein isoliertes Gastnetz ist ungeeignet.

`include/secrets.h` wird durch `.gitignore` nicht in Git gespeichert. Der
Geräte-Token und das WLAN-Kennwort werden nicht im seriellen Monitor ausgegeben.
Ohne Root-CA sendet die Firmware absichtlich nichts; unsicheres TLS ist nicht
vorgesehen. Eine gespeicherte Einstellung hat Vorrang vor den Rückfallwerten in
`secrets.h`.

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
- geschützter Fernneustart aus der Geräteverwaltung

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

### Leser aus der App neu starten

Unter **Admin → Sicherheit → RFID-Leser** kann ein aktiver Leser mit
**Neu starten** kontrolliert neu gestartet werden. Ein laufender
Kartenschreibauftrag wird dabei nicht unterbrochen. Der Leser bestätigt den
Auftrag zuerst am Kassenserver, startet anschließend neu und verbindet sich
selbstständig wieder mit dem Vereins-WLAN. Dafür muss diese Firmware-Version
einmal per USB auf den NodeMCU übertragen worden sein.

### Firmware später ohne USB aktualisieren

Ab Version 1.6.0 meldet der Leser seinen Firmwarestand an ClubIQ. Unter
**Admin → Sicherheit → RFID-Leser** erscheint bei einer neueren, im
ClubIQ-Container enthaltenen Firmware die Schaltfläche **Firmware
aktualisieren**. Der Leser lädt die Binärdatei ausschließlich über seine bereits
geprüfte HTTPS-Verbindung, installiert sie in den OTA-Bereich und startet neu.
WLAN, Serveradresse, Root-CA und Geräte-Token bleiben im EEPROM erhalten.

Für den direkten Bluetooth-Betrieb muss Version 1.8.0 auf dem ESP32 einmal per USB
installiert werden. Danach überträgt die App weitere Versionen geprüft per BLE-OTA;
der ESP32 prüft Größe und SHA-256-Prüfsumme vor dem Neustart.
Während eines Kartenauftrags oder eines noch nicht übertragenen Scans wird kein
Update gestartet. Während der Installation die Stromversorgung nicht trennen.

### Arduino IDE

ESP8266-Boardpaket und die Bibliothek **MFRC522 by GithubCommunity** installieren.
`src/main.cpp` als `.ino` übernehmen und `include/web_ui.h` sowie
`include/config.h` als weitere Tabs/Dateien einfügen. Board „NodeMCU 1.0
(ESP-12E Module)“, Upload Speed 115200, serieller Monitor 115200. Für den
empfohlenen ESP32 ist PlatformIO vorzuziehen.

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

- ESP32 erscheint nicht in ClubIQ: Chrome auf Android verwenden, Bluetooth und
  Standort-/Geräteberechtigung für Chrome erlauben und den Leser neu starten.
  Ein bereits vollständig gekoppelter Leser sendet absichtlich kein
  Einrichtungs-Bluetooth mehr aus.
- Bluetooth ist im Browser nicht verfügbar: ClubIQ über die installierte und
  vertrauenswürdige HTTPS-Adresse öffnen, nicht über eine HTTP-Adresse.
- Einrichtung bleibt bei WLAN stehen: nur ein 2,4-GHz-WLAN verwenden und
  prüfen, dass es kein isoliertes Gastnetz ist.
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
- I²C-Display bleibt dunkel: Versorgung, D3/D4 und Adresse `0x3C` prüfen; bei
  Bootproblemen sicherstellen, dass kein Modul D3 oder D4 nach GND zieht.

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
