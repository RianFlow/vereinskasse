# Vereinskasse

Tabletfreundliches Kassensystem für den SV Barver Darts und weitere Sparten im Dorfgemeinschaftshaus.

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

Die produktiven Speicherbindungen für Datenbank und Sicherungen werden in `.openai/hosting.json` deklariert. Zugangsdaten gehören niemals in das Repository.
