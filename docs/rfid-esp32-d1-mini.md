# ESP32-D1-mini-RFID-Leser anbinden

Der ClubIQ-Leser wird einmalig über ein geschütztes Einrichtungs-WLAN
konfiguriert und arbeitet danach selbstständig im festen
2,4-GHz-Kassen-WLAN des Raspberry Pi.

Die UID ist nur die Kartenkennung. Mitglied, Rechte, Rechnungen und Kontostände
liegen ausschließlich in PostgreSQL. Jeder Leser besitzt ein eigenes geheimes
Gerätetoken; TLS wird gegen das lokale ClubIQ-Root-Zertifikat geprüft.

## Einmalige Einrichtung

1. Der Leser startet das WLAN `ClubIQ-Setup-…` und zeigt dessen zufälliges
   Kennwort im Display an.
2. Tablet oder Handy verbindet sich mit diesem WLAN. Die Einrichtungsseite
   öffnet sich normalerweise automatisch; andernfalls `http://192.168.4.1`
   aufrufen.
3. `ClubIQ-Kasse` beziehungsweise `BarverKasse` aus der gefundenen WLAN-Liste
   auswählen und das Kennwort eintragen.
4. Der Leser speichert die Einstellung, beendet sein Setup-WLAN und startet neu.
5. Er lädt das lokale Root-Zertifikat vom Raspberry und zeigt einen
   sechsstelligen Kopplungscode an.
6. In **Admin > RFID-Leser** den exakt am Leser angezeigten Code freigeben.

Erst diese physische Codebestätigung erzeugt das individuelle Gerätetoken.
Falsche Codes werden protokolliert und nach fünf Versuchen gesperrt.

## Dauerbetrieb und Wiederherstellung

Im Dauerbetrieb verwendet der Leser nur das feste Kassen-WLAN. WLAN-Autoreconnect,
gepufferte Scans und eine regelmäßige RC522-Prüfung sorgen dafür, dass kurze
Ausfälle ohne Eingriff überstanden werden. Bleibt das gespeicherte WLAN 90
Sekunden unerreichbar oder wird in ClubIQ **WLAN ändern** ausgelöst, öffnet der
Leser sein geschütztes Setup-WLAN erneut. Die letzte funktionierende Einstellung
bleibt erhalten, bis eine neue Verbindung wirklich gespeichert wurde.

Der Raspberry-Netzweg lässt sich vorher separat prüfen:

```bash
sudo clubiq rfid-netz-pruefen
```

Der Test prüft das feste 2,4-GHz-Kassen-WLAN, den lokalen Zeitdienst, das
ClubIQ-Root-Zertifikat und die RFID-API. Er verschickt keine Buchung und ändert
keine Leserdaten.

Das Verfahren entspricht dem etablierten SoftAP-/Captive-Portal-Muster für
WLAN-Geräte und vermeidet Android-Web-Bluetooth- und GATT-Verbindungsprobleme.

Referenzen:

- [Espressif Wi-Fi Provisioning](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/provisioning/provisioning.html)
- [WiFiManager Captive Portal](https://github.com/tzapu/WiFiManager)
- [Arduino-ESP32 Wi-Fi API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html)
