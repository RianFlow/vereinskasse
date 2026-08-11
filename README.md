# Vereinskasse

## Raspberry-Pi-Testbetrieb

Die vollständige Docker-Ausgabe mit PostgreSQL, lokalem HTTPS, stündlichen
Sicherungen, USB-Zweitziel, optional verschlüsseltem Cloudflare-R2-Backup und
kontrollierter Wiederherstellung steht unter
[`deploy/docker/README.md`](deploy/docker/README.md).

Tabletfreundliches Kassensystem für den SV Barver Darts und weitere Sparten im Dorfgemeinschaftshaus.

## RFID-Betrieb

Der Raspberry stellt ein festes 2,4-GHz-WLAN `ClubIQ-Kasse` für Tablet und
RFID-Leser bereit. Bluetooth wird beim ESP32 nur einmal verwendet, um dieses
WLAN und die sichere lokale Serveradresse zu übertragen. Danach laufen Scans,
Displayanzeige, Chip-Schreiben, Neustart und geprüfte Firmwareupdates direkt
zwischen Leser und Raspberry. Der Kassenbetrieb bleibt auch ohne Internet lokal
verfügbar; LAN wird nur für Fernzugriff, E-Mail, R2-Sicherung und Updates benötigt.
Unterstützt wird ausschließlich der ESP32 D1 mini. Fehlen die Einstellungen oder
bleiben Kassen-WLAN beziehungsweise Kassenserver 90 Sekunden unerreichbar,
schaltet der Leser kontrolliert in den Bluetooth-Einrichtungsmodus. Bluetooth
und WLAN laufen dabei nie gleichzeitig.

## Datensicherheit

- Strukturierte Betriebsdaten liegen zentral in der Datenbank, nicht ausschließlich auf dem Tablet.
- Jede Buchung wird vor dem Eintrag in die Datenbank zusätzlich als unabhängige Sicherung abgelegt.
- Vollständige, prüfsummengeschützte Sicherungen können im Adminbereich erstellt und heruntergeladen werden.
- Produkt- und Rabattänderungen sichern automatisch den vorherigen Stand.
- Datenbankänderungen werden ausschließlich als nummerierte Migrationen veröffentlicht.
- Der Migrationscheck blockiert unbeabsichtigte Löschbefehle.

## Sicherer Updateablauf

1. Im Adminbereich unter **System & Updates** eine vollständige Sicherung erstellen und herunterladen.
2. Änderungen über einen eigenen Git-Branch und Pull Request einspielen.
3. Die automatische GitHub-Prüfung muss erfolgreich sein.
4. Erst danach die geprüfte Version veröffentlichen.
5. Nach der Veröffentlichung Systemstatus, Anmeldung, Testbuchung und Auswertung prüfen.

Die veröffentlichten Datenbankmigrationen dürfen niemals nachträglich geändert oder gelöscht werden. Neue Schemaänderungen erhalten immer eine neue Migrationsnummer.

## Vergessene Profil-PIN

Jedes Profil kann drei getrennte Notfallkarten verwenden. Zum Zurücksetzen einer vergessenen PIN sind zwei unterschiedliche Karten erforderlich. Nach erfolgreicher Wiederherstellung werden alle bisherigen Karten ungültig; anschließend erzeugt ein Vorstand im Adminbereich ein neues Dreierset. Codes und PINs werden ausschließlich als abgeleitete Prüfwerte gespeichert und sind nicht auslesbar.

## Entwicklung

Voraussetzung ist Node.js 22 oder neuer.

```bash
npm ci
npm run dev
npm test
```

Wichtige Befehle:

- `npm run lint` – Codequalität prüfen
- `npm test` – Migrationen, Produktionsbuild und Funktionsprüfungen ausführen
- `npm run db:generate` – neue Datenbankmigration erzeugen
- `npm run check:migrations` – Migrationen auf Vollständigkeit und Datenlöschung prüfen
- `npm run db:postgres:migrate` – PostgreSQL-Schema auf dem Raspberry aktualisieren
- `npm run db:postgres:check` – PostgreSQL-Verbindung und Tabellenbestand prüfen

Die produktiven Speicherbindungen für Datenbank und Sicherungen werden in `.openai/hosting.json` deklariert. Zugangsdaten gehören niemals in das Repository.

## Datenbank-Laufzeiten

- Die bestehende ChatGPT-Sites-Testversion verwendet weiterhin Cloudflare D1.
- Der Raspberry verwendet PostgreSQL als eigenständige Hauptdatenbank.
- Beide Laufzeiten verwenden dieselben Kassen- und API-Funktionen; es gibt keinen dauerhaften Doppel-Schreibbetrieb.
- Eine spätere Produktivdatenbank wird mit `sudo vereinskasse-neue-datenbank` kontrolliert leer angelegt. Der bisherige Teststand wird davor gesichert und als getrennte Archivdatenbank behalten.

## Docker

PostgreSQL wird zusammen mit pgadmin in einer Docker-Umgebung bereitgestellt. Die Datenbank ist auf Port 5432 erreichbar. pgadmin ist auf Port 5050 erreichbar. Um in pgadmin eine Verbindung mit der Datenbank herzustellen, wird die lokale Adresse / Host 127.0.0.1 oder 172.17.0.1 verwendet.

- `docker compose up` – Docker-Umgebung starten
- `docker compose down` – Docker-Umgebung stoppen
- `docker compose pull` – Images neu laden / aktualisieren
