# ESP32-D1-mini-RFID-Leser anbinden

Der ClubIQ-Leser wird einmalig per Bluetooth eingerichtet und arbeitet danach
eigenständig im festen 2,4-GHz-Kassen-WLAN des Raspberry Pi.

Die UID ist nur die Kartenkennung. Mitglied, Rechte, Rechnungen und Kontostände
liegen ausschließlich in PostgreSQL. Jeder Leser besitzt ein eigenes geheimes
Gerätetoken; TLS wird gegen das lokale ClubIQ-Root-Zertifikat geprüft.

## Geprüfte Zustandsfolge

`Bluetooth → WLAN-Daten nur vormerken → 2,4-GHz-WLAN verbinden → IP erhalten → lokale Uhrzeit laden → TLS-Zertifikat prüfen → am Raspberry anmelden → Einstellungen speichern → Neustart`

Bluetooth bleibt ausschließlich während dieser einmaligen Prüfung aktiv. Die
App zeigt jeden erreichten Zustand an. Erst wenn der Raspberry das individuelle
Gerätetoken und die Hardwarekennung über HTTPS bestätigt hat, speichert der
Leser die neuen Daten dauerhaft und startet in den reinen WLAN-Dauerbetrieb.

Schlägt ein Schritt fehl, bleibt der Einrichtungsdialog geöffnet und zeigt die
konkrete Ursache an: WLAN nicht gefunden, Anmeldung abgewiesen, keine IP,
Zeitdienst nicht erreichbar, Zertifikatsfehler oder ungültiges Gerätetoken. Die
zuletzt funktionierende WLAN- und Serverkonfiguration bleibt dabei erhalten.

Nach dem Neustart verlangt die App zusätzlich eine frische Meldung genau dieses
Lesers am Raspberry. Eine alte Registrierung, eine Bluetooth-Trennung oder die
bloße Anzeige „verbunden“ gelten nicht als Erfolg.

Bei einer späteren WLAN-Änderung muss am Gerät einmal eine RFID-Karte aufgelegt
werden. Ist nur das Kassen-WLAN 90 Sekunden lang nicht erreichbar, öffnet der
Leser Bluetooth für fünf Minuten. Ohne neue Einstellungen startet er danach
automatisch neu und versucht wieder das gespeicherte WLAN. Ein bloßer Neustart
des Raspberry oder der Anwendung schaltet den Leser nicht in Bluetooth um.

Der Raspberry-Netzweg lässt sich vor der Lesereinrichtung separat prüfen:

```bash
sudo clubiq rfid-netz-pruefen
```

Der Test prüft das feste 2,4-GHz-Kassen-WLAN, den lokalen Zeitdienst, das
ClubIQ-Root-Zertifikat und die RFID-API. Er verschickt keine Buchung und ändert
keine Leserdaten.

Die Zustandsfolge folgt dem offiziellen Espressif-Provisioning-Verfahren: Ein
Provisioning-Dienst bleibt bis zur erfolgreichen WLAN-Prüfung verfügbar und
unterscheidet insbesondere „Access Point nicht gefunden“ von
„Authentifizierung fehlgeschlagen“. Die Firmware wertet außerdem die offiziellen
Arduino-ESP32-WLAN-Ereignisse für „IP erhalten“ und „Verbindung getrennt“ aus.

Referenzen:

- [Espressif Wi-Fi Provisioning](https://docs.espressif.com/projects/esp-idf/en/v5.1/esp32/api-reference/provisioning/wifi_provisioning.html)
- [Arduino-ESP32 Wi-Fi API und Ereignisse](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html)
