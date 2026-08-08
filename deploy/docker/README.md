# Clubiq Ledger auf dem Raspberry Pi 4B

Diese Ausgabe ist für Raspberry Pi OS 64-Bit auf einem Raspberry Pi 4B mit
4 GB RAM vorbereitet. Sie läuft vollständig auf dem Raspberry; die vorhandene
öffentliche Testseite und deren Daten werden dadurch nicht verändert.

## Was automatisch läuft

- **App:** Clubiq Ledger Version 1.7.1 als ARM64-Container
- **Datenbank:** PostgreSQL 17 in einem nur intern erreichbaren Docker-Netz
- **HTTPS:** Caddy mit lokalem Zertifikat für Tablet, PWA und Kioskmodus
- **Start nach Stromausfall:** alle dauerhaften Dienste starten selbst wieder
- **Datenbankänderungen:** versionierte Migrationen vor jedem App-Start
- **Sicherung:** sofort beim Start und danach stündlich mit Prüfsumme; ältere
  Stände werden zu Tages- und Monatsständen verdichtet
- **Zweitsicherung:** optional auf USB, aber nur nach Prüfung des Mountpoints
- **Außer-Haus-Kopie:** optional verschlüsselt in einem privaten Cloudflare-R2-Bucket
- **Wiederherstellung:** Prüfsumme, Test-Rücksicherung und Rückfall-Datenbank
- **Updates:** Sicherung vor dem Update und automatischer Rückfall bei Fehlern
- **Speicherschutz:** begrenzte Container-Protokolle, damit die SD nicht vollläuft

Die PostgreSQL-Schnittstelle wird **nicht** ins Vereinsnetz oder Internet
veröffentlicht. Nur der Webzugang auf Port 80/443 und der Download des lokalen
Zertifikats auf Port 8080 sind erreichbar. Kennwörter liegen nicht in Git oder
der Compose-Datei, sondern als nur für root lesbare Dateien unter `secrets/`.

Die Anwendung kann technisch auch einen entfernten PostgreSQL-Host mit
Benutzer/Kennwort, `POSTGRES_SSL=require` und
`POSTGRES_SSL_MODE=verify-full` verwenden. Für den Raspberry-Start
bleibt `POSTGRES_HOST=postgres` jedoch die sicherere und schnellere Einstellung.
Bei einem externen Anbieter müssen zusätzlich Sicherung, Rücksicherung,
Migrationen und das Recht zum Anlegen einer temporären Prüfdatenbank erlaubt
sein; nur eine erreichbare Datenbank-URL genügt für den vollständigen sicheren
Betrieb nicht.

## 1. Raspberry vorbereiten

Im Raspberry Pi Imager:

1. Raspberry Pi OS Lite **64-Bit** wählen.
2. Hostname, zum Beispiel `vereinskasse`, festlegen.
3. Benutzer, sicheres Kennwort, WLAN und SSH eintragen.
4. Wenn möglich den Raspberry später per LAN anschließen.
5. Im Router seine IP-Adresse fest reservieren.

Danach am Raspberry anmelden und ausführen:

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone --branch main \
  https://github.com/RianFlow/vereinskasse.git clubiq-ledger
cd /opt/clubiq-ledger
sudo ./deploy/docker/install.sh
```

Der Assistent installiert Docker aus dem offiziellen Paketarchiv, fragt die
erste sechsstellige Profil-PIN ab, erzeugt getrennte Zufallskennwörter und
startet die Kasse. Falls das fertige GitHub-Image noch nicht öffentlich
abrufbar ist, wird es einmalig direkt auf dem Raspberry gebaut; das dauert
deutlich länger, ändert aber nichts an den Daten.

## 2. Tablet verbinden

Der Installationsassistent zeigt zwei Adressen an. Zuerst auf dem Tablet das
lokale CA-Zertifikat laden, zum Beispiel:

```text
http://192.168.1.50:8080/vereinskasse-ca.crt
```

Das Zertifikat als vertrauenswürdiges **CA-Zertifikat** installieren.
Danach die Kasse über den angezeigten Namen öffnen, typischerweise:

```text
https://vereinskasse.local
```

Falls ein Tablet keine `.local`-Namen auflöst, funktioniert die zusätzlich
angezeigte HTTPS-Adresse mit der aktuellen Raspberry-IP. Nach einem Umzug in
ein anderes Netzwerk wird diese Adresse einmalig aktualisiert:

```bash
sudo clubiq netzwerk-aktualisieren
```

Über den Browser kann die PWA dann zum Startbildschirm hinzugefügt und im
Vollbild-/Kioskmodus verwendet werden.

## 3. Bedienung auf dem Raspberry

```bash
sudo clubiq status
sudo clubiq sichern
sudo clubiq sicherungen
sudo clubiq pruefen
sudo clubiq protokoll
sudo clubiq aktualisieren
```

`clubiq aktualisieren` erstellt zuerst eine neue Sicherung. Wird die neue
Version nicht innerhalb von zwei Minuten gesund, wird das vorherige App-Image
automatisch wieder aktiviert. PostgreSQL und die Datenvolumes werden beim
Update niemals gelöscht oder neu angelegt.

## 4. USB-Stick als echte zweite Sicherung

Der Stick muss zuerst vom Betriebssystem dauerhaft unter
`/mnt/vereinskasse-sicherung` eingehängt werden. Vorher mit `lsblk -f` die
Gerätebezeichnung und UUID prüfen. Der Installationsassistent formatiert
absichtlich keinen Datenträger, damit eine falsche Geräteauswahl nicht die
SD-Karte löschen kann.

Wenn `findmnt /mnt/vereinskasse-sicherung` den USB-Stick als eigenes Ziel zeigt:

```bash
sudo clubiq usb-freigeben /mnt/vereinskasse-sicherung
sudo clubiq sichern
sudo clubiq sicherungen
```

Die Freigabemarkierung verhindert, dass bei einem nicht eingehängten Stick
versehentlich wieder auf die SD-Karte „gesichert“ wird.

## 5. Optional verschlüsselt zu Cloudflare R2

1. In Cloudflare R2 einen **privaten** Bucket anlegen.
2. Einen auf genau diesen Bucket beschränkten Token mit „Object Read & Write“
   erzeugen.
3. Für einen EU-Bucket den angezeigten EU-Endpunkt verwenden.
4. Auf dem Raspberry starten:

```bash
sudo clubiq r2-einrichten
sudo clubiq r2-pruefen
```

Restic verschlüsselt die Archive bereits auf dem Raspberry. Cloudflare erhält
nur verschlüsselte Daten. Den Inhalt von
`deploy/docker/secrets/restic_password` zusätzlich offline aufbewahren; ohne
diesen Schlüssel ist eine R2-Rücksicherung absichtlich nicht möglich.
Nach einem vollständigen SD-/USB-Ausfall holt
`sudo clubiq r2-laden` das jüngste verschlüsselte Archiv zurück in den lokalen
Sicherungsbereich; anschließend wird es mit `clubiq wiederherstellen` wie jede
andere Sicherung geprüft und aktiviert.

## 6. Wiederherstellung testen oder ausführen

Zunächst vorhandene Archive anzeigen:

```bash
sudo clubiq sicherungen
```

Dann eine Datei angeben. Vor jeder Veränderung wird automatisch eine
Testdatenbank aus dem Archiv erstellt und geprüft:

```bash
sudo clubiq wiederherstellen /backups/local/vereinskasse-DATUM.tar.gz
```

Erst nach der exakten Bestätigung `WIEDERHERSTELLEN` werden App und Sicherung
kurz gestoppt und der geprüfte Stand aktiviert. Der vorige Datenbankstand und
Belegspeicher bleiben als Rückfall erhalten.

## 7. Nach dem Probebetrieb leer beginnen

```bash
sudo clubiq neue-datenbank
```

Auch hierbei entsteht zuerst eine Vollsicherung. Die Testdaten werden als
getrennte Archivdatenbank behalten. Der Assistent verlangt eine neue PIN und
legt dann ein sauberes Startprofil an.

## Speicherorte

- PostgreSQL-Daten: Docker-Volume `clubiq-ledger_postgres_data`
- App-/Belegspeicher: Docker-Volume `clubiq-ledger_app_data`
- lokale Archive: Docker-Volume `clubiq-ledger_backup_cache`
- USB-Archive: `/mnt/vereinskasse-sicherung`
- geheime Einstellungen: `deploy/docker/secrets/`
- nicht geheime Einstellungen: `deploy/docker/.env`

Solange Docker noch auf der SD-Karte liegt, liegen auch die ersten drei
Volumes physisch unter `/var/lib/docker/volumes`. USB und R2 sind daher die
unabhängigen Kopien. Beim späteren SSD-Umzug wird zuerst eine Sicherung geprüft,
dann Docker vollständig gestoppt und sein Datenverzeichnis kontrolliert auf
die SSD verschoben. Die konkrete Gerätebezeichnung muss dafür am Raspberry
geprüft werden; sie ist bewusst nicht in einem allgemeinen Skript fest codiert.

## Sicherheitsgrenzen

- Keine Router-Portfreigabe einrichten.
- PostgreSQL-Port 5432 nicht veröffentlichen.
- Docker-Verwaltung nur mit `sudo`; den normalen Benutzer nicht unüberlegt in
  die Docker-Gruppe aufnehmen, weil diese praktisch root-Rechte verleiht.
- Betriebssystem und Docker regelmäßig mit den normalen Paketupdates pflegen.
- Vor produktivem Einsatz eine USB-Sicherung wirklich zurückspielen und prüfen.
- Cloudflare Tunnel für den späteren Online-Rechnungsbereich ist vorbereitet,
  aber absichtlich noch nicht aktiviert.
