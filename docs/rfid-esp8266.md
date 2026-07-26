# ESP8266-RFID-Leser anbinden

Die passend angepasste und mit PlatformIO geprüfte Firmware liegt im Repository
unter [`hardware/NodeMCU-V3-RC522-Tablet`](../hardware/NodeMCU-V3-RC522-Tablet).
Sie behält den lokalen Wartungszugang bei und sendet neue UIDs selbstständig per
HTTPS an die nachfolgend beschriebene Route.

## Gewählte Architektur

Der Browser ruft den Leser **nicht** über `http://192.168.4.1` auf. Stattdessen:

1. Der ESP8266 verbindet sich als WLAN-Client mit dem Vereins-WLAN.
2. Der MFRC522 liest ausschließlich die UID.
3. Der ESP8266 sendet die UID per HTTPS an `https://<vereinskasse>/api/rfid`.
4. Die Kassenoberfläche fragt neue Scans beim Vereinskassen-Server ab.
5. Die Zuordnung UID → Mitglied liegt in D1.

Die bestehende Access-Point- und Basic-Auth-Oberfläche kann als lokale
Wartungsfunktion erhalten bleiben. Für den Kassenbetrieb ist der
gleichzeitige Station-Modus erforderlich.

## Einmalige Einrichtung

Im Adminbereich unter **Sicherheit → Externer Kartenleser** einen Leser
anlegen. Die dort einmalig angezeigte Gerätekennung in der Firmware
hinterlegen.

Die Gerätekennung niemals in Git oder in öffentlich sichtbaren Dateien
speichern.

## Scan an die Vereinskasse senden

```http
POST /api/rfid
Content-Type: application/json
X-RFID-Token: <einmalig erzeugte Gerätekennung>

{
  "uid": "12:34:56:78",
  "type": "MIFARE 1KB",
  "blocks": 64
}
```

Erwartete Antwort:

```json
{
  "accepted": true,
  "id": "..."
}
```

HTTP-Status: `202`

Die Firmware sollte denselben aufgelegten Chip nicht fortlaufend senden.
Entweder auf das Entfernen der Karte warten oder mindestens 2,5 Sekunden
entprellen. Der Server verwirft zusätzlich schnelle Dubletten.

## HTTPS

Der ESP8266 muss das TLS-Zertifikat der Vereinskassen-Domain prüfen.
`setInsecure()` ist für den Livebetrieb nicht zulässig. Die passende
Root-CA wird in der Firmware als Trust Anchor hinterlegt und bei einem
Zertifikatswechsel aktualisiert.

Die Vereinskasse ist für den Gerätebetrieb öffentlich erreichbar. Die
Geräte-API bleibt unabhängig davon durch ihre eigene, lange Gerätekennung
geschützt. Wird die Seite später wieder privat gestellt, benötigt der Leser
einen lokalen Vermittlungsserver.

Die Vereinskasse selbst akzeptiert einen Scan nur mit einer aktiven,
serverseitig gehashten Gerätekennung.

## Karte einem Mitglied zuordnen und beschriften

Im Adminbereich unter **Mitglieder** kann bei einer Person **RFID-Karte**
gewählt werden:

1. Karte auflegen; der Leser sendet ihre UID.
2. UID dem ausgewählten Mitglied zuordnen.
3. Optional einen freien Datenblock und einen Text bis 16 UTF-8-Byte wählen.
4. Karte kurz abnehmen und erneut auflegen.
5. Der ESP8266 schreibt den Block, liest ihn zurück und meldet das geprüfte
   Ergebnis an die Kasse.

Schreibaufträge werden nur für einen angemeldeten Vorstand erzeugt, sind an
den konkreten Leser und die konkrete UID gebunden und laufen nach zwei Minuten
ab. Block 0 und Sektor-Trailer bleiben gesperrt. Die Firmware verwendet für
diese Komfortbeschriftung den MIFARE-Standard-Key A `FFFFFFFFFFFF`.

Der Leser fragt Aufträge über `GET /api/rfid/commands` ab und meldet das
Ergebnis per `POST /api/rfid/commands`. Beide Aufrufe benötigen
`X-RFID-Token`. Geldbeträge, Kontostände, Preisgruppen und Berechtigungen
werden auch nach dem Beschreiben ausschließlich aus der Datenbank gelesen.

## Sicherheitsgrenze

- Auf der RFID-Karte werden keine Preise, Geldbeträge oder Rechte gespeichert.
- Eine UID wählt nur ein Mitglied für den nächsten Kassiervorgang aus.
- Adminzugänge verwenden weiterhin den persönlichen Admin-Code.
- Eine kopierte UID kann daher keine Adminrechte oder Kontostände verändern.
- Jede neue oder geänderte UID-Zuordnung wird im Prüfprotokoll erfasst.
