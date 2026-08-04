# Kostenlose Cloudflare-Anbindung

## Zielbild

```text
Tablet im Vereinsheim
        │
        ├── lokale Kasse ──> Raspberry Pi ──> PostgreSQL auf SSD
        │
Internet│
        └── Rechnung ansehen
                 │
          Cloudflare Tunnel
                 │
        schreibgeschütztes Portal auf dem Raspberry
```

Der Raspberry bleibt die einzige Quelle für Buchungen, Mitgliederkonten und
Monatsabschlüsse. Dadurch entstehen keine zwei auseinanderlaufenden
Datenbanken.

## Kostenlos nutzbare Bausteine

- Cloudflare Free für DNS, HTTPS, DDoS-Schutz und grundlegende Schutzregeln
- Cloudflare Tunnel für eine ausgehende Verbindung vom Raspberry; keine
  öffentliche IP und keine Portfreigabe am Router
- Cloudflare Access Free nur für eine kleine Gruppe aus Vorstand/Admin
- optional später R2 Free für verschlüsselte externe Sicherungskopien, solange
  die kostenlosen Speicher- und Vorgangsgrenzen eingehalten werden

Aktuelle offizielle Informationen:

- <https://developers.cloudflare.com/tunnel/>
- <https://www.cloudflare.com/plans/>
- <https://developers.cloudflare.com/workers/platform/pricing/>

## Warum nicht alle Mitglieder über Cloudflare Access?

Der kostenlose Zero-Trust-Tarif ist aktuell auf 50 Benutzer begrenzt. Der
Verein hat mehr als 60 Mitglieder. Deshalb authentifiziert der spätere
Rechnungsbereich Mitglieder selbst, zum Beispiel mit persönlichem Zugang und
einem zweiten Merkmal. Cloudflare Access bleibt vor dem Adminzugang und zählt
dort nur die wenigen Verantwortlichen.

## Sicherheitsgrenzen

- Die Kassenoberfläche wird nicht öffentlich durch den Tunnel gereicht.
- Der Onlinebereich darf keine Artikel, Preise, Mitglieder oder Buchungen
  ändern.
- Nur festgeschriebene Monatsabrechnungen werden angezeigt.
- Kontostände und Rechnungen werden erst nach einer eigenen
  Mitgliederanmeldung ausgeliefert.
- Tunnel-Zugangsdaten liegen ausschließlich auf dem Raspberry, niemals im
  GitHub-Repository.
- Fällt Internet oder Cloudflare aus, arbeitet die lokale Kasse weiter.
- Fällt der Raspberry aus, ist das Portal vorübergehend nicht erreichbar; es
  entsteht aber kein abweichender Datenstand.

## Reihenfolge

1. Raspberry zunächst lokal auf der SD-Karte testen.
2. Datenbestand kontrolliert auf die SSD verschieben.
3. Schreibgeschütztes Mitgliederportal implementieren und testen.
4. Eigene Domain oder Subdomain in Cloudflare einrichten.
5. `cloudflared` auf dem Raspberry installieren und den Tunnel als
   Systemdienst starten.
6. Nur den Portal-Endpunkt veröffentlichen.
7. Adminzugang optional mit Cloudflare Access absichern.
8. Von Mobilfunk und aus dem Vereins-WLAN getrennt testen.

Erst danach wird die bisherige öffentliche Kassenanwendung abgeschaltet oder
auf das Rechnungsportal umgeleitet. So gibt es zu keinem Zeitpunkt zwei
beschreibbare Produktivsysteme.
