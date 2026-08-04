# Vereinskasse auf dem Raspberry Pi 4B

> Für neue Installationen wird die abgeschottete Docker-Ausgabe unter
> [`../docker/README.md`](../docker/README.md) empfohlen. Dieser Ordner bleibt
> als ältere direkte Systeminstallation erhalten.

## Vor dem ersten Start

- Raspberry Pi OS Lite 64-Bit auf die microSD schreiben.
- Im Raspberry Pi Imager WLAN, Benutzer, Kennwort, Hostname
  `vereinskasse` und SSH festlegen.
- Für den Kassenbetrieb möglichst LAN statt WLAN verwenden.
- Im Router die IP-Adresse des Raspberry Pi fest reservieren.

Die microSD ist für den Probebetrieb geeignet. Sie ist noch keine zweite
Sicherung. Sobald die SSD da ist, werden Datenbank, Belegspeicher und
Sicherungsziel auf die SSD verschoben.

Die Raspberry-Laufzeit nutzt PostgreSQL. Die bisherige Cloud-Version mit D1
bleibt während der Tests unverändert und erhält keine Raspberry-Buchungen.

## Installation

Auf dem Raspberry anmelden und das öffentliche Projekt holen:

```bash
git clone --branch agent/central-data-backups \
  https://github.com/RianFlow/vereinskasse.git
cd vereinskasse/deploy/raspberry
sudo env VEREINSKASSE_GIT_BRANCH=agent/central-data-backups ./install.sh
```

Danach läuft die Kasse automatisch:

- Anwendung: `https://vereinskasse.local`
- Zertifikat fürs Tablet:
  `http://<IP-DES-RASPBERRY>:8080/vereinskasse-ca.crt`

Das Zertifikat einmal auf dem Tablet als vertrauenswürdige
CA installieren. Erst dann funktionieren Anmeldung, PWA/Kiosk und sichere
Cookies ohne Browserwarnung vollständig.

## Betrieb

```bash
sudo systemctl status vereinskasse
sudo journalctl -u vereinskasse -n 100 --no-pager
sudo vereinskasse-backup
sudo vereinskasse-update
sudo vereinskasse-db-pruefen
```

Täglich um etwa 03:15 Uhr wird automatisch eine konsistente Sicherung
erstellt. Solange nur die SD-Karte vorhanden ist, liegt sie unter
`/var/backups/vereinskasse`. Für echte Redundanz später einen USB-Datenträger
oder ein NAS eintragen:

```text
VEREINSKASSE_SECONDARY_BACKUP_DIR=/mnt/vereinskasse-sicherung
```

Die Einstellung steht in `/etc/vereinskasse/environment`.

## Cloudflare bleibt kostenlos erhalten

Der Raspberry ist die einzige beschreibbare Hauptanwendung. Cloudflare wird
später als kostenlose, sichere Verbindung für den Online-Rechnungsbereich
verwendet:

- Im Vereinsheim läuft die vollständige Kasse direkt über das lokale Netz.
- Von außen wird nur ein noch einzurichtender, schreibgeschützter
  Rechnungsbereich veröffentlicht.
- Der Router benötigt keine offene Portweiterleitung.
- Cloudflare Tunnel stellt HTTPS und die Verbindung zum Raspberry bereit.
- Vorstand/Admin kann zusätzlich über Cloudflare Access geschützt werden.
- Die Mitgliederanmeldung bleibt in der Vereinskassen-App, damit mehr als
  50 Mitglieder nicht von der Benutzergrenze des kostenlosen Access-Tarifs
  betroffen sind.

Die vollständige Planung steht in
[`CLOUDFLARE.md`](./CLOUDFLARE.md). Der Tunnel wird erst eingeschaltet, wenn
der schreibgeschützte Rechnungsbereich fertig ist. Bis dahin bleibt die
bestehende Onlineversion unverändert.

## Wiederherstellung

Zuerst immer nur prüfen:

```bash
sudo vereinskasse-restore /var/backups/vereinskasse/DATEI.tar.gz
```

Erst nach kontrollierter Vorschau wirklich ausführen:

```bash
sudo vereinskasse-restore /var/backups/vereinskasse/DATEI.tar.gz --execute
```

Die bestehende Datenbank wird dabei zusätzlich als separate
PostgreSQL-Archivdatenbank aufbewahrt. Schlägt eine Rücksicherung fehl, wird
automatisch wieder der vorherige Datenstand aktiviert.

## Nach dem Probebetrieb sauber starten

Wenn alle Tests abgeschlossen sind, kann eine neue leere Produktivdatenbank
angelegt werden:

```bash
sudo vereinskasse-neue-datenbank
```

Der Assistent erstellt zuerst eine geprüfte Vollsicherung, verlangt eine klare
Bestätigung und eine neue sechsstellige Start-PIN. Die Testdaten werden nicht
gelöscht, sondern als getrennte Archivdatenbank behalten. Erst nach der ersten
Anmeldung werden der Hauptadmin, Mitglieder, Artikel und RFID-Zuordnungen neu
angelegt.

## Wenn die SSD angekommen ist

1. SSD anschließen und Zustand prüfen.
2. Neue Sicherung erstellen und Prüfsumme kontrollieren.
3. SSD formatieren und dauerhaft unter `/srv/vereinskasse` einhängen.
4. PostgreSQL-Datenverzeichnis nur mit dem PostgreSQL-eigenen Umzugsverfahren
   auf die SSD verschieben; nicht im laufenden Betrieb kopieren.
5. Belegspeicher und Sicherungen mit Prüfsummen kopieren.
6. Die Speicherpfade in `/etc/vereinskasse/environment` auf die SSD umstellen.
7. Anwendung starten und Datenbank, Buchungen und Sicherungsabruf prüfen.
8. SD-Daten erst nach mehreren erfolgreichen Sicherungen unangetastet
   archivieren.

Für diesen Umzug sollte die konkrete SSD-Bezeichnung zuerst am Raspberry
geprüft werden. Das verhindert, dass versehentlich die SD-Karte formatiert
wird.
