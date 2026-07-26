# ESP8266-RFID-Leser anbinden

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

Solange die Testseite nur für ein persönliches OpenAI-Konto freigegeben ist,
erreicht ein eigenständiger ESP8266 sie nicht. Für den Gerätebetrieb wird
später entweder:

- der Vereinszugang der Kasse bereitgestellt und die Geräte-API durch ihre
  eigene Gerätekennung geschützt, oder
- ein getrenntes öffentliches RFID-Gateway vorgeschaltet.

Die Vereinskasse selbst akzeptiert einen Scan nur mit einer aktiven,
serverseitig gehashten Gerätekennung.

## Sicherheitsgrenze

- Auf der RFID-Karte werden keine Preise, Geldbeträge oder Rechte gespeichert.
- Eine UID wählt nur ein Mitglied für den nächsten Kassiervorgang aus.
- Adminzugänge verwenden weiterhin den persönlichen Admin-Code.
- Eine kopierte UID kann daher keine Adminrechte oder Kontostände verändern.
- Jede neue oder geänderte UID-Zuordnung wird im Prüfprotokoll erfasst.
