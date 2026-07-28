# Vereinskasse auf dem Raspberry Pi 4B

## Vor dem ersten Start

- Raspberry Pi OS Lite 64-Bit auf die microSD schreiben.
- Im Raspberry Pi Imager WLAN, Benutzer, Kennwort, Hostname
  `vereinskasse` und SSH festlegen.
- Für den Kassenbetrieb möglichst LAN statt WLAN verwenden.
- Im Router die IP-Adresse des Raspberry Pi fest reservieren.

Die microSD ist für den Probebetrieb geeignet. Sie ist noch keine zweite
Sicherung. Sobald die SSD da ist, werden Datenbank, Belegspeicher und
Sicherungsziel auf die SSD verschoben.

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
```

Täglich um etwa 03:15 Uhr wird automatisch eine konsistente Sicherung
erstellt. Solange nur die SD-Karte vorhanden ist, liegt sie unter
`/var/backups/vereinskasse`. Für echte Redundanz später einen USB-Datenträger
oder ein NAS eintragen:

```text
VEREINSKASSE_SECONDARY_BACKUP_DIR=/mnt/vereinskasse-sicherung
```

Die Einstellung steht in `/etc/vereinskasse/environment`.

## Wiederherstellung

Zuerst immer nur prüfen:

```bash
sudo vereinskasse-restore /var/backups/vereinskasse/DATEI.tar.gz
```

Erst nach kontrollierter Vorschau wirklich ausführen:

```bash
sudo vereinskasse-restore /var/backups/vereinskasse/DATEI.tar.gz --execute
```

Die bestehende Datenbank wird dabei zusätzlich als
`vereinskasse.sqlite.vor-wiederherstellung-*` aufbewahrt.

## Wenn die SSD angekommen ist

1. SSD anschließen und Zustand prüfen.
2. Neue Sicherung erstellen und Prüfsumme kontrollieren.
3. SSD formatieren und dauerhaft unter `/srv/vereinskasse` einhängen.
4. Anwendung stoppen.
5. Daten und Sicherungen mit Prüfsummen kopieren.
6. Die drei Speicherpfade in `/etc/vereinskasse/environment` auf die SSD
   umstellen.
7. Anwendung starten und Datenbank, Buchungen und Sicherungsabruf prüfen.
8. SD-Daten erst nach mehreren erfolgreichen Sicherungen unangetastet
   archivieren.

Für diesen Umzug sollte die konkrete SSD-Bezeichnung zuerst am Raspberry
geprüft werden. Das verhindert, dass versehentlich die SD-Karte formatiert
wird.
