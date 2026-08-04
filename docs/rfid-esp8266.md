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
5. Die Zuordnung UID → Mitglied liegt in der aktiven Vereinskassen-Datenbank
   (auf dem Raspberry in PostgreSQL), niemals auf der Karte.

Die bestehende Access-Point- und Basic-Auth-Oberfläche kann als lokale
Wartungsfunktion erhalten bleiben. Für den Kassenbetrieb ist der
gleichzeitige Station-Modus erforderlich.

## Einmalige Einrichtung

Nach dem einmaligen Aufspielen dieser Firmware ist für die Einrichtung kein PC
und kein PlatformIO mehr nötig:

1. Das Tablet mit `NFC-Reader-xxxxxx` verbinden und `http://192.168.4.1`
   öffnen.
2. Vereins-WLAN, Serveradresse und Root-CA speichern.
3. **Mit Clubiq Ledger koppeln** wählen. Der Leser erzeugt einen sechsstelligen
   Einmalcode und ein eigenes zufälliges Gerätegeheimnis.
4. Das Tablet wieder mit dem Vereins-WLAN verbinden und in Clubiq Ledger
   **Admin → Sicherheit → RFID-Leser** öffnen.
5. Beim wartenden Leser den auf OLED beziehungsweise Wartungsseite angezeigten
   Code eingeben und **Freigeben** wählen.

Der Leser fragt die Freigabe selbstständig ab und speichert anschließend sein
Gerätegeheimnis. Es muss weder kopiert noch in den Quellcode geschrieben
werden. Der Code läuft nach zehn Minuten ab und wird nach fünf falschen
Versuchen gesperrt. Der bisherige manuelle Geräte-Token bleibt eingeklappt als
Notfallweg erhalten.

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

Die Geräte-API bleibt durch ihre eigene, lange Gerätekennung geschützt. Als
Server kann entweder eine öffentlich erreichbare HTTPS-Installation oder der
lokale Raspberry verwendet werden. Für den Raspberry wird
`https://vereinskasse.local/api/rfid` zusammen mit der unter
`http://vereinskasse.local:8080/vereinskasse-ca.crt` bereitgestellten Root-CA
auf der Wartungsseite gespeichert. `setInsecure()` bleibt auch im lokalen
Betrieb verboten.

Beim Wechsel vom Heimnetz ins Vereinsheim wird nur das gespeicherte WLAN des
Lesers geändert. Serveradresse und Zertifikat bleiben gültig, solange derselbe
Raspberry und Hostname verwendet werden. Das Zielnetz darf keine Client- oder
Gastnetz-Isolierung zwischen Leser und Raspberry aktivieren.

Die Vereinskasse selbst akzeptiert einen Scan nur mit einer aktiven,
serverseitig gehashten Gerätekennung.

Bei der Kopplung wird das lange Gerätegeheimnis vom ESP8266 selbst erzeugt und
über die bereits geprüfte HTTPS-Verbindung angemeldet. Der Server speichert nur
den SHA-256-Hash. Die App bestätigt lediglich, dass der am echten Leser
angezeigte Einmalcode übereinstimmt.

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

Ein Vorstand kann über dieselbe geschützte Auftragsstrecke einen Fernneustart
auslösen. Der ESP8266 bestätigt den Auftrag vor `ESP.restart()` und verbindet
sich danach automatisch wieder mit dem Vereins-WLAN. Laufende
Kartenschreibaufträge blockieren einen Neustartauftrag.

## Sicherheitsgrenze

- Auf der RFID-Karte werden keine Preise, Geldbeträge oder Rechte gespeichert.
- Eine UID wählt das zugeordnete Mitglied für den nächsten Kassiervorgang aus.
- Zugeordnete Karten von Vorstandsmitgliedern können eine Admin-Sitzung starten.
  Die Rolle wird dabei ausschließlich aus der Datenbank gelesen und der Einstieg
  im Prüfprotokoll festgehalten; auf dem Chip selbst stehen keine Rechte.
- MIFARE-UIDs können grundsätzlich kopiert werden. Verlorene Admin-Karten daher
  sofort in der Geräteverwaltung trennen. Der persönliche Admin-Code bleibt als
  unabhängiger Ersatzweg erhalten.
- Jede neue oder geänderte UID-Zuordnung wird im Prüfprotokoll erfasst.
