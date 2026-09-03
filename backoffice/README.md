# ClubIQ Verwaltung – getrennt von der Kasse

Die Verwaltung ist eine eigenständige React-/Node-Anwendung mit eigenem Docker-Container. Sie verwendet dieselbe PostgreSQL-Datenbank wie die Kasse, aber ein eigenes Datenbankkonto und ein eigenes Identitätsschema. Es wird **keine Kassendaten-Kopie bei einem Cloudanbieter** angelegt. Die bestehende Music-App und ihr Player sind nicht betroffen.

Vorgesehen: `https://verwaltung.clubiq.party` über Cloudflare Tunnel. Die Verwaltung ist **nicht automatisch veröffentlicht**. Erst die ausdrücklich ausgeführte Einrichtung aktiviert sie; spätere Kassen-Updates erhalten den Container. Sie bindet auf dem Pi ausschließlich `127.0.0.1:8092`. Niemals den öffentlichen Tunnel auf die bestehende Kasse (`8090`, `3000`) oder auf die Wartungsseite richten.

## Funktionen dieser ersten Version

- Monatsabrechnungen und festgeschriebene Archivstände mit Prüfsummenprüfung; Einzelposten, CSV-Übersicht, CSV-Einzelposten und Druckansicht.
- Abrechnungspaket mit sichtbarer Empfängerauswahl versenden: eigenes verifiziertes Konto, bestätigte aktive Kassenwarte/Vorstände desselben Profils sowie die Kassenwart-Adressen aus der Wartungsseite (`CLUBIQ_SMTP_REPLY_TO`). Absender und genaue Zieladressen werden vor dem Absenden angezeigt; jeder Empfänger erhält eine separate Nachricht. Der Versandstatus zeigt die Zieladresse. SMTP-Annahme ist keine Lesebestätigung. Die vorhandenen automatischen Monatsmails der Kasse bleiben unverändert.
- Interne Vermerke an Abrechnungen; Überweisungseingänge und begründete Korrekturen als **neue** Kontoeinträge im aktuellen Monat. Festgeschriebene Originale werden nicht umgeschrieben. Kein Verkauf, keine Barzahlung, kein Schichtabschluss, keine RFID-/PIN-Verwaltung.
- Mitglieder ohne E-Mail-Adresse anlegen und Namen bearbeiten. Keine individuellen Mitglieder-E-Mails aus dieser Verwaltung. Vorhandene Kontaktadressen und Einwilligungen werden weder gelöscht noch verändert. Mitgliederstammdaten sind in der bestehenden Kasse profilübergreifend – die Oberfläche weist darauf hin. Bestehende Vereinsrollen und Kassenzugänge bleiben unverändert.
- Neue Einzelartikel mit Namen, Kategorie, Kassensymbol und Normal-/Mitgliederpreis anlegen; bestehende Artikel bearbeiten. Doppelte Namen und wiederholte Speicheranfragen werden abgefangen. Paketbestandteile bleiben erhalten; historische Kaufpreise bleiben unverändert. Neue Angebote/Pakete werden weiterhin in der Kassenadministration zusammengestellt.
- Statistik-Zeitraum frei von 1 bis 36 Monaten wählen, Schnellwahl für 3/6/12 Monate und laufendes Jahr. Diagramme für Monatsumsatz/Kontozahlungen, Artikelverbrauch, Kategorien, Wochentage und aktuelle offene Konten; Kennzahlen und aufklappbare Datentabellen. Stornierte Verkäufe sind ausgeschlossen, leere Monate bleiben sichtbar. Kontozahlungen werden nie nochmals als Umsatz gezählt. Aktuelle offene Beträge und Guthaben gelten unabhängig vom gewählten Zeitraum.
- Persönliche Einladungen, Zugänge sperren/ändern, Änderungsprotokoll. Jedes Verwaltungskonto ist zunächst genau einem Kassenprofil zugeordnet.

Das Erstellen/Festschreiben von Monatsabschlüssen, individuelle Rechnungs-E-Mails an Mitglieder und Änderungen an Vereinsrollen bleiben zunächst in der vorhandenen Kassenadministration. Die Verwaltung bietet kein rechtsverbindlich zertifiziertes Rechnungssystem und keine stillen Änderungen historischer Rechnungen.

## Gemeinsamer Datenstand / automatische Aktualisierung

Kasse und Verwaltung lesen und schreiben direkt in dieselbe PostgreSQL-Datenbank auf dem Raspberry. Es gibt keinen zeitversetzten Import und keine zweite Kopie beim Cloudanbieter. Nach dem Speichern sind Änderungen auf dem Server verfügbar. Sichtbare Verwaltungsansichten und freie Kassenansichten fragen etwa alle **3 Sekunden**, Statistiken und die Kassen-Monatsansicht etwa alle **5 Sekunden** nach. Das ist zeitnaher Live-Abgleich, keine garantierte verzögerungsfreie Push-Verbindung.

- Nach einem Wechsel zurück zum Browserfenster oder Wiederherstellung der Verbindung wird sofort erneut abgefragt. Unsichtbare Tabs pausieren; Fehler führen zu begrenzten Neuversuchen statt einer Anfragenflut. Jede Abfrage hat ein Zeitlimit.
- Ein Verbindungshinweis zeigt Unterbrechungen. Bereits angezeigte Daten bleiben stehen, können dann aber veraltet sein. Internetzugriff von außerhalb setzt einen erreichbaren Raspberry voraus; das Kassen-WLAN bleibt unabhängig davon lokal nutzbar.
- Während Eingaben, offenen Dialogen oder Speichervorgängen werden Entwürfe nicht durch Hintergrundantworten ersetzt. Ein offener Warenkorb wird nicht still neu bepreist. Hat sich sein Preis inzwischen geändert, lehnt der Server den alten Betrag ab; dann Kasse neu laden und den Warenkorb neu prüfen.
- Artikel und Rabatte nutzen eine gemeinsame Versionsprüfung. Eine veraltete Kassenansicht kann neuere Änderungen aus der Verwaltung nicht durch das Speichern ihres gesamten Sortiments löschen. Bei einem Konflikt wird nichts aus dieser Anfrage übernommen; neu laden und die gewünschte Änderung erneut prüfen.
- Neue Verkäufe, Überweisungen und Korrekturen erscheinen in offenen Monatsständen. Festgeschriebene Monatsabschlüsse bleiben unverändert; spätere Korrekturen sind neue Einträge.
- Automatische Verwaltungsabfragen verlängern die Anmeldesitzung nicht. Die bestehenden Rollen- und Zwei-Faktor-Prüfungen gelten bei jeder Anfrage weiter.

Für diesen Schutz müssen **Kasse und Verwaltung mit diesem Codestand** installiert sein. Das lokale Vorschau-System bleibt eine getrennte Beispiel-Datenbank und ist nicht mit eurer echten Vereinskasse synchronisiert.

## Rollen

| Rolle | Befugnisse |
| --- | --- |
| Lesezugang | Vereinsdaten, Abrechnungen, Statistiken ansehen und exportieren |
| Kassenwart | zusätzlich Vermerke, Überweisungseingänge, begründete Korrekturen, Abrechnungsmails an freigegebene Empfänger |
| Vorstand | zusätzlich gemeinsame Mitgliederstammdaten, Preise und Verwaltungszugänge |

Die Prüfung erfolgt **bei jeder Anfrage auf dem Server**. Ein Verwaltungs-Cookie entsperrt niemals die Kasse. Kontosperrungen wirken sofort und beenden vorhandene Sitzungen. Den eigenen Zugang kann man nicht selbst herabstufen/sperren; mindestens ein Vorstand bleibt erhalten.

## Sicherheitsmodell

Die Umsetzung orientiert sich an etablierten OWASP-Empfehlungen. Das ist **keine Zertifizierung oder unabhängiger Penetrationstest**.

- Gepinnte Better-Auth-Bibliothek für Passwort-Hashing, Sitzungen, Reset und TOTP; keine selbst erfundenen Passwortverfahren.
- Keine öffentliche Registrierung und keine Standard-Zugangsdaten. Einladungen setzen zunächst ein unbenutzbares Zufallspasswort. Erst der E-Mail-Link aktiviert das Konto.
- Mindestens 15, höchstens 128 Zeichen pro Passwort; Passwortmanager und Leerzeichen erlaubt. HTTPS, HttpOnly-/Secure-/SameSite-Strict-Cookies ohne Domain-Freigabe für Subdomains. Keine Anmeldetoken im Local Storage.
- Vor dem Öffnen von Vereinsdaten ist TOTP erforderlich. Wiederherstellungscodes werden verschlüsselt gespeichert. Kein Abschalten von MFA über die öffentliche API; keine per Passwortreset umgehbare MFA. Kein „Gerät dauerhaft vertrauen“.
- Reset-Link: 15 Minuten, einmal verwendbar, Token-Bezeichner gehasht. Link nur zur fest konfigurierten Origin, Token im URL-Fragment statt in Proxy-Logs. Unbekannte/bekannte Adressen erhalten dieselbe Antwort. Zustellung außerhalb der HTTP-Anfrage über eine verschlüsselte, begrenzt wiederholte Warteschlange.
- Passwortreset beendet Sitzungen und vorherige Reset-/Login-Challenges. Passwortwechsel beendet andere Sitzungen. Sitzungen enden nach einer Stunde ohne Aktivität und nach spätestens acht Stunden ist eine erneute Anmeldung nötig.
- E-Mail-Wechsel am eigenen Konto: aktive Freigabe und MFA-Anmeldung, erneute Passwortprüfung, Bestätigung im bisherigen **und** im neuen Postfach. Die Bibliothek signiert die Links; zusätzliche gehashte, ablaufende Einmal-Challenges binden sie an die unveränderliche Konto-ID. Bestätigung nur per Same-Origin-POST nach ausdrücklichem Klick, nicht schon durch Mail-Link-Vorschauen. Rohe Auth-E-Mail-Endpunkte sind gesperrt; ein Mail-Link allein umgeht niemals MFA. Nach dem Wechsel werden alle Sitzungen und vorherigen Challenges beendet.
- Strikte Origin-Prüfung für Änderungen, JSON-/Größenbegrenzung, feste API-Freigabeliste, Sicherheitsheader, kein Drittanbieter-JavaScript, kein öffentlicher Daten-/Service-Worker-Cache.
- Atomare, persistente Versuchslimits nach Konto und nach Socket-Verbindung. Hinter einem lokalen Tunnel ist das Socket-Limit absichtlich gemeinsam: beliebige `X-Forwarded-For`-Header können es nicht umgehen. Bei Bedarf Cloudflare-Ratelimits ergänzen, nicht ungeprüft Client-IP-Header vertrauen.
- SQL-Parameter statt SQL-Verkettung, profilbezogene Abfragen, Versionsprüfungen bei Änderungen und wiederholsichere Verwaltungsbuchungen. Kein UPDATE/DELETE-Recht auf Verkäufe, Kontoeinträge oder Monatsabschlüsse.
- Mailversand nur mit TLS und Zertifikatsprüfung; Secret-Dateien werden in ein privates Laufzeitverzeichnis kopiert, bevor der Prozess Root-Rechte abgibt.
- Keine frei eingegebenen Versandadressen: Auswahl wird beim Absenden serverseitig gegen die aktuelle Freigabeliste geprüft. Höchstens zehn Empfänger je Auftrag; einzelne Nachrichten, atomare Warteschlange und wiederholsichere Auftragskennung. Die bewusst in der Wartungsseite hinterlegten Kassenwarte gelten wie beim bisherigen Monatsversand profilübergreifend.

## Vorbereitung auf dem Raspberry (erst nach Freigabe / Übernahme des Codes)

1. Funktionierenden aktuellen Datenstand sichern: `sudo clubiq sichern` und `sudo clubiq pruefen`.
2. Sicherstellen, dass die Kasse samt PostgreSQL-Migrationen und SMTP-Konfiguration aktuell ist. In `deploy/docker/.env` muss die spätere Origin ausdrücklich gesetzt sein: `BACKOFFICE_ORIGIN=https://verwaltung.clubiq.party`. Ohne diese Angabe bricht die Einrichtung vor Änderungen ab. Das gemeinsame Kassen-Update benötigt einen kurzen Neustart der Kassen-Weboberfläche; die Music-App bleibt unberührt.
3. Eigenständige Verwaltung installieren, ohne Kasse/Player neu zu starten:

   ```bash
   cd /opt/clubiq-ledger
   sudo bash deploy/docker/backoffice-setup.sh
   ```

   Das Skript erzeugt **nur bei fehlenden Dateien** zwei separate Geheimnisse: `backoffice_secret` und `backoffice_db_password` in `deploy/docker/secrets`. Es erstellt den eingeschränkten DB-Benutzer und das neue Schema, ergänzt bei Bedarf die gemeinsame Tabelle für Artikelversionen, baut den separaten Container, migriert das Verwaltungsschema und prüft Port 8092. Danach setzt es die lokale Markierung `.backoffice-enabled`, damit `clubiq` den Dienst bei späteren Updates nicht als verwaisten Container entfernt. Für Aktualisierungen der Verwaltung das Einrichtungsskript erneut ausführen. Es verändert weder vorhandene Kassenbuchungen noch DNS oder Cloudflare/Tailscale. Nach einem Fehler nicht blind wiederholt Benutzer anlegen; erst Ausgabe prüfen.

4. Erstes persönliches Vorstandskonto einladen (Adresse und Namen bewusst wählen):

   ```bash
   cd /opt/clubiq-ledger/deploy/docker
   sudo docker compose --env-file .env -f compose.yaml -f backoffice.compose.yaml \
     exec backoffice gosu node node --experimental-strip-types manage.mjs invite \
     DEINE-EMAIL-ADRESSE "Vorname Nachname" darts admin
   ```

   Das ist kein Versand an eine frei erfundene Adresse: den Platzhalter zuerst ersetzen. Die Einladung funktioniert erst im Browser, nachdem die HTTPS-Adresse freigeschaltet ist. Ein abgelaufener Link lässt sich über „Passwort vergessen?“ ersetzen. Das Verwaltungspasswort ist unabhängig von Gmail-App-Passwort, Kassen-PIN und Raspberry-Kennwort.

5. `sudo clubiq sichern` und `sudo clubiq pruefen` erneut ausführen. Das vorhandene vollständige `pg_dump` enthält das neue `backoffice`-Schema. Die notwendigen Leserechte für den bisherigen Sicherungsbenutzer werden eingerichtet. Das erlaubt diesem bestehenden Sicherungs-/Kassen-DB-Konto auch das Lesen des Identitätsschemas; es bleibt ein besonders schützenswertes internes Konto.

6. **Vor öffentlicher Freigabe:** Workflow „Verwaltung prüfen“ einschließlich PostgreSQL 17 und Containerbau muss grün sein. Erstes Konto, Passwortreset, TOTP, Rollen, Abrechnung und Mailzustellung auf dem Pi abnehmen. Keine vorhandenen echten Rechnungen als Test verändern.

## Domain und Cloudflare

- Zuerst eine Cloudflare-Access-Anwendung für **die gesamte Subdomain** `verwaltung.clubiq.party` (ohne Pfadbeschränkung) anlegen. Nur ausdrücklich freigegebene Vorstands-/Kassenwart-Adressen erlauben; MFA beim Identitätsanbieter verlangen, wo verfügbar. Keine öffentliche Bypass-Regel. Dieser zusätzliche Schutz ersetzt das persönliche Verwaltungskonto nicht.
- Danach eine veröffentlichte HTTP-Anwendung im **auf dem Pi laufenden Cloudflare-Tunnel**: Hostname `verwaltung.clubiq.party`, Dienst `http://127.0.0.1:8092` (cloudflared als Hostdienst). Läuft cloudflared im Container, ist dessen `127.0.0.1` nicht der Pi; dann die Containerverbindung gesondert einrichten.
- Vorhandene Musik-Routen an `clubiq.party` oder `musik.clubiq.party` unverändert lassen. Nicht pauschal die gesamte Domain inklusive aller Subdomains sperren.
- Der Verwaltungs-Hostname darf nie auf die Kassenoberfläche zeigen. Keine Router-Portfreigabe und keinen öffentlichen Tailscale-Funnel dafür hinzufügen.
- Nach der Freigabe Zugang ohne erlaubtes Konto, fremde Origin, gesperrtes Konto und Zugriff auf `/api/data`, `/api/control`, `/api/rfid/pair` prüfen: keine Kassendaten/-aktionen dürfen erreichbar sein.

## Bedienung

1. E-Mail-Link öffnen → eigene lange Passphrase festlegen → anmelden.
2. Zwei-Faktor-Anmeldung wie im folgenden Abschnitt einrichten. Der QR-Code erscheint **erst nach erneuter Passworteingabe und Klick auf „Einrichtung starten“**.
3. Unter **Abrechnungen** Monat wählen. „Festgeschrieben“ zeigt das Original, „Vorläufig“ einen lebenden Stand. CSVs lassen sich in Excel/LibreOffice weiterverarbeiten; die Druckansicht kann über den Browser gedruckt werden.
4. **Details** öffnet Artikel des Monats, aktuelle Kontobewegungen und internen Vermerk. Bei geteilten Bons gilt der persönliche Anteil für den gesamten Bon; Artikelpreise sind nicht zusätzlich zu addieren.
5. **Überweisung erfassen** nur nach tatsächlichem Zahlungseingang nutzen. **Korrektur erfassen**: negativer Betrag = Gutschrift, positiver Betrag = Nachbelastung. Begründung ist Pflicht. Beide werden aktuell gebucht und referenzieren den gewählten Monat; das alte Dokument bleibt bestehen.
6. Unter **Mein Konto** E-Mail-Adresse oder Passwort ändern, andere Geräte abmelden und eigene Abrechnungsmails prüfen. Nach einem Mailfehler zunächst SMTP/Logs prüfen und nicht mehrfach hintereinander senden.
7. **Zugänge & Protokoll** (Vorstand): persönliche E-Mail-Adressen einladen, Rechte anpassen, ehemalige Zuständige sperren. Eingeladene Personen ändern später ihre eigene Anmeldeadresse selbst – kein neues Konto und kein SSH dafür nötig.

### Persönliche E-Mail-Adresse ändern

1. **Mein Konto → E-Mail-Adresse ändern** öffnen. Neue Adresse zweimal und das aktuelle Verwaltungspasswort eingeben.
2. Den ersten Link im **bisherigen Postfach** öffnen, nötigenfalls mit der bisherigen Adresse und dem zweiten Faktor anmelden und **Bisherige Adresse bestätigen** klicken.
3. Nun den zweiten Link im **neuen Postfach** öffnen und **Neue Adresse verbindlich speichern** klicken. Jeder Link gilt 15 Minuten und nur einmal.
4. Danach mit der **neuen** Adresse und dem unveränderten Passwort sowie Authenticator-/Wiederherstellungscode anmelden. Rechte, Rechnungen und Kontohistorie bleiben am selben persönlichen Konto.

Persönliche Kassenwart-/Vorstandskonten erscheinen anschließend unter ihrer neuen Adresse in der Empfängerauswahl. Bereits geöffnete Versanddialoge müssen neu geöffnet werden; alte Empfängerkennungen werden serverseitig erneut geprüft. **Wichtig:** Eine zusätzlich in der Wartungsseite eingetragene allgemeine Kassenwart-Adresse ist ein unabhängiger Verteiler. Für den automatischen Monatsversand diesen ebenfalls auf der Wartungsseite aktualisieren; er wird nicht ungefragt überschrieben. Auch bereits vorgemerkte Nachrichten werden nicht umadressiert. Gmail-Absender und SMTP-Anmeldedaten ändern sich nicht. Bei einer zusätzlichen Cloudflare-Access-Freigabe muss der zuständige Administrator auch deren Erlaubnisliste aktualisieren; diese Anwendung besitzt keine Cloudflare-Verwaltungsrechte.

Kein Zugriff mehr auf das alte Postfach? Nicht versuchen, die Bestätigung zu umgehen: Der Vorstand muss die Identität prüfen und einen neuen Zugang einladen sowie den alten sperren. Mitglieder ohne Verwaltungszugang benötigen diese Schritte und eine E-Mail-Adresse nicht.

Im **lokalen Testsystem** landen die zwei Bestätigungen ausschließlich unter **Mein Konto → Testpostfach**. Dort jeweils den aktuellen Bestätigungslink öffnen. Dieses Testpostfach existiert nicht im Produktionsserver, zeigt nur Nachrichten des eigenen MFA-Testkontos und verschickt nichts ins Internet. Die Test-Anmeldeadresse bleibt nach einem Neustart gespeichert.

### Zwei-Faktor-Einrichtung Schritt für Schritt

1. Am Handy eine Authenticator-App bereithalten, z. B. Google Authenticator oder Microsoft Authenticator. Die Verwaltungsseite am PC geöffnet lassen.
2. Auf der Seite „Ein zweiter Schlüssel für eure Vereinsdaten“ erneut das **Verwaltungspasswort** eingeben. Das ist dasselbe Passwort wie gerade beim Anmelden, kein Gmail- oder Raspberry-Passwort.
3. **Einrichtung starten** anklicken. Erst jetzt erscheint ein persönlicher QR-Code. Vorher fehlt also nichts.
4. In der Handy-App ein Konto hinzufügen (meist Pluszeichen), „QR-Code scannen“ auswählen und den Code auf dem PC scannen. Nicht nur mit der gewöhnlichen Kamera-App scannen. Bei Verwendung desselben Handys den Abschnitt zur manuellen Einrichtung öffnen und den Schlüssel als **zeitbasierten** Schlüssel eintragen.
5. Die Wiederherstellungscodes sicher und getrennt vom Handy aufbewahren. Jeder ist einmal verwendbar; sie werden danach nicht erneut angezeigt. Das Häkchen **Ich habe die Codes sicher verwahrt** setzen.
6. Den aktuellen sechsstelligen Code beim ClubIQ-Konto aus der Authenticator-App eintippen und **Einrichtung bestätigen** wählen. Nicht einen Wiederherstellungscode verwenden. Der Button bleibt ohne Häkchen deaktiviert.
7. Wird ein Code abgelehnt, auf den nächsten Code warten und die automatische Uhrzeit des Handys prüfen. QR-Code, Einrichtungsschlüssel und Notfallcodes niemals im Chat teilen.

### Artikel hinzufügen

Als Vorstand **Artikel & Preise → Artikel hinzufügen** öffnen. Namen, Kategorie, Normalpreis und optional Mitgliederpreis eingeben, Kassensymbol wählen und **Artikel anlegen** drücken. Ein leerer Mitgliederpreis bedeutet „wie Normalpreis“. Die aktualisierte Kasse übernimmt den Artikel beim nächsten freien Live-Abgleich. Bei einer veralteten Sortimentsansicht verhindert die Versionsprüfung das Überschreiben; dann neu laden und die Änderung erneut prüfen. Vorhandene Browseransichten nach dem Kassen-Update einmal neu laden.

### Abrechnungen an Kassenwarte senden

Unter **Abrechnungen** den Monat wählen und **Abrechnung per E-Mail** öffnen. Im Dialog stehen der Absender sowie Name, Adresse und Herkunft jedes angebotenen Empfängers. Es ist zunächst nur das eigene Konto ausgewählt; weitere Kassenwarte ausdrücklich anhaken. Anschließend Monat und Empfänger bestätigen und den Versand auslösen. Die Übersicht und Einzelposten aller abgerechneten Konten sind enthalten – keine einzelne Mitgliedsrechnung.

Weitere Adressen entweder in der **Wartungsseite** als Kassenwart-Empfänger hinterlegen oder als persönliches Konto mit Rolle Kassenwart/Vorstand einladen. Persönliche Konten erscheinen erst nach Bestätigung der E-Mail-Adresse und nur bei aktiver Freigabe für dieses Profil. Reine Lesezugänge erscheinen nicht automatisch. Nach einer Änderung der Wartungskonfiguration muss der Verwaltungscontainer mit der aktualisierten Compose-Umgebung neu erstellt werden; das Einrichtungs-/Updateskript erledigt dies. Der automatische Monatsversand der Kasse verwendet weiterhin ausschließlich seine Wartungsseiten-Konfiguration.

Unter **Mein Konto → Meine Abrechnungsmails** sieht die absendende Person Zieladresse, Monat und Status ihrer Aufträge. „Zugestellt an Mailserver“ bedeutet SMTP-Annahme; Spamordner und tatsächlichen Posteingang trotzdem prüfen. Im lokalen Testsystem steht ausdrücklich **Nur simuliert – keine E-Mail gesendet**.

### Statistik richtig lesen

- Umsatz basiert auf Verkäufen; spätere Kontozahlungen sind getrennt dargestellt und dürfen nicht hinzuaddiert werden.
- Verbrauch zählt tatsächliche Artikel inklusive Paketbestandteilen, aber nicht zusätzlich eine reine Paket-Hülle.
- Kategorien beruhen auf der heutigen Artikelzuordnung. Frühere Verkaufspreise stammen weiterhin aus den jeweiligen Buchungen; gelöschte Artikel erscheinen als „Nicht zugeordnet“.
- Wochentage zeigen Summen über den ausgewählten Zeitraum nach deutscher Ortszeit, nicht Tagesdurchschnitte.
- Offene Beträge und Guthaben sind aktuelle Kontosalden, keine Aussage zur Fälligkeit. Sie verändern sich nicht mit dem Statistik-Zeitraum.
- Unter jedem Diagramm lässt sich die zugehörige Datentabelle öffnen.

## Wiederherstellung und Sicherung

- `backoffice_secret` zusätzlich offline verwahren! Es verschlüsselt TOTP-Geheimnisse, Wiederherstellungscodes und ausstehende Mails. Datenbankbackup allein genügt nicht. Nicht als Screenshot oder im Chat teilen, nicht in Git committen. Verlust erfordert eine kontrollierte Neuanmeldung/MFA-Einrichtung aller Konten.
- `clubiq wiederherstellen` und `clubiq neue-datenbank` stoppen eine eingerichtete Verwaltung vor der Änderung. Danach die Verwaltung zunächst **gestoppt lassen**, den öffentlichen Zugang sperren, `backoffice-setup.sh` erneut zur schema-begrenzten Rechte-/Eigentümerreparatur ausführen und anschließend Sicherung testen. Wiederhergestellte Sitzungen und abgelaufene Einladungen vor einer öffentlichen Freigabe kontrollieren/beenden.
- Handy verloren: erst Wiederherstellungscode verwenden. Sind alle Codes verloren, nur ein vertrauenswürdiger Betreiber nach persönlicher Identitätsprüfung auf dem Pi:

  ```bash
  cd /opt/clubiq-ledger/deploy/docker
  sudo docker compose --env-file .env -f compose.yaml -f backoffice.compose.yaml \
    exec backoffice gosu node node --experimental-strip-types manage.mjs recover-mfa \
    BETROFFENE-EMAIL-ADRESSE IDENTITAET-GEPRUEFT
  ```

  Dadurch werden alte Anmeldungen und Challenges entfernt. Erneute E-Mail-Aktivierung und MFA-Einrichtung sind Pflicht. Dieses Verfahren ist absichtlich nicht öffentlich erreichbar.

## Entwicklung / Prüfung

```bash
cd backoffice
npm ci
npm test
npm run build
npm audit --audit-level=moderate
```

Lokal laufen Authentifizierungstests mit einer leeren SQLite-Datenbank und SQL-/Rechte-/Migrations-/Buchungstests in einem **lokalen PostgreSQL-WASM-Prozess (PGlite)**. GitHub CI verwendet zusätzlich einen frischen PostgreSQL-17-Service. Es werden keine vorhandenen Tabellen gelöscht: eine externe Test-URL ist nur für die leere Datenbank `clubiq_backoffice_test` erlaubt.

Der Live-Abgleich hat gemeinsame Scheduler-Tests in `tests/live-poll.test.mjs` (sichtbare Tabs, Entwürfe, kein Überlappen, Zeitlimit, Wiederverbindung). PostgreSQL-Tests prüfen gemeinsame Artikelversionen, abgewiesene veraltete Kassen-Schreibversuche, Rollback und direkt sichtbare Kontoeinträge. Die freigegebene Browser-QA prüft zwei getrennte Ansichten, geschützte Eingaben, Versionskonflikte und eine simulierte Verbindungsunterbrechung ohne manuelles Neuladen. Das ersetzt nicht die abschließende Abnahme am echten Raspberry.

Die vorhandene Kassen-Anwendung hat ihren eigenen Abhängigkeitsbaum. Dessen Audit-Warnungen werden durch eine neue Verwaltung nicht automatisch behoben; separate Paketpflege bleibt erforderlich. Für die neue Verwaltungsanwendung werden keine bekannten Audit-Funde bewusst akzeptiert.

Prüfstand der Erstveröffentlichung (03.09.2026): vollständiger npm-Audit der Verwaltung ohne Funde. In der Kasse wurden Nodemailer, React/RSC, PostCSS und kompatible Unterpakete korrigiert; der auf deklarierte Produktionspakete begrenzte Audit ist ohne Funde. Im vollständigen Kassen-Baum bleiben zehn Meldungen (drei hoch, sieben mittel) bei Vinext/image-size und der Cloudflare-/Drizzle-Werkzeugkette. Die Einordnung als `devDependency` bedeutet nicht automatisch, dass kein Code davon im Kassen-Laufzeitimage steckt. Diese Paketpflege ist separat offen; die Kasse bleibt privat und wird nicht über den Verwaltungstunnel freigegeben. Ein Major-/Beta-Wechsel von Vinext oder ein von npm vorgeschlagener Drizzle-Downgrade ist nicht Teil dieser Veröffentlichung. Keine Sicherheitszertifizierung.

Für eine rein lokale UI-Vorschau mit **wegwerfbaren Beispieldaten**: `node --experimental-strip-types scripts/preview-fixture.mjs` und in einem zweiten Terminal `npm run dev`; Adresse `http://127.0.0.1:5176`. Testkonto: `officer@example.test`, Passwort: `Only for local tests! 123456`. Die Testanmeldung inklusive MFA sowie Testartikel/Versandmetadaten werden jetzt in `outputs/backoffice-preview/demo-auth.sqlite` gespeichert (Git-ignoriert), damit ein Neustart nicht jedes Mal die Einrichtung zurücksetzt. Keine echten Daten eingeben, den Testdienst nicht öffentlich erreichbar machen. Die Beispieldiagramme sind keine Auswertung eurer echten Kasse. E-Mails werden ausschließlich simuliert. Die Testskripte und Testzugänge gehören nicht in den Runtime-Container. Browser-QA wird nur nach ausdrücklicher Freigabe ausgeführt und verwendet das separate wegwerfbare Konto `browserqa@example.test`, ohne die Test-MFA des Benutzers zurückzusetzen.

Die Vorschau enthält acht erfundene Mitglieder mit Einzelposten: offene und teilweise bezahlte Konten, vollständig bezahlte Konten, ein Guthaben und ein Mitglied ohne Käufe. Ausgangsbeispiel: 203 € neue Buchungen, 93 € Zahlungen, 146,50 € positive offene Salden und 10 € Guthaben. Mitgliedsnamen, neue Testmitglieder, zusätzliche Testzahlungen und Vermerke bleiben ebenfalls lokal gespeichert. Die Demo-Bestätigungslinks sind nur über das eigene geschützte Testpostfach einsehbar. Wer seine Test-E-Mail ändert, meldet sich danach auch nach einem Neustart mit dieser neuen Adresse an.

Referenzen: [OWASP Passwort-Wiederherstellung](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [OWASP Berechtigungen](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [Better Auth](https://better-auth.com/docs/reference/security), [Better Auth E-Mail-Wechsel](https://better-auth.com/docs/concepts/users-accounts), [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/).
