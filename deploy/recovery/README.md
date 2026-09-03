# Notfallpaket für Kasse und Verwaltung

Die normale PostgreSQL-Sicherung enthält Vereinsdaten, Rechnungen, Verwaltungskonten und deren verschlüsselte Zwei-Faktor-Daten. Sie enthält **nicht** alle zum Wiederanlauf benötigten Schlüssel. Dieses zusätzliche Paket schließt diese Lücke.

## Was automatisch passiert

- Der Raspberry erzeugt stündlich und nach dem Start ein neues `clubiq-notfall-…tar.gz.age`.
- Enthalten: Docker-`.env`, ausdrücklich ausgewählte Installations-Secrets (einschließlich `backoffice_secret`, Datenbank-, SMTP- und Restic-Zugang), lokale Caddy-Zertifizierungsstelle, gespeicherte NetworkManager-Verbindungen und vorhandene Cloudflare-Tunnel-Konfigurationsdateien. Keine Musikdaten, privaten Benutzer-SSH-Schlüssel oder vollständige Betriebssystemkopie.
- Das Klartextarchiv entsteht nur im Arbeitsspeicher. Verschlüsselt wird mit dem öffentlichen age-Schlüssel. Der **private** Schlüssel gehört nicht auf den Raspberry.
- Eine Kopie liegt auf dem freigegebenen USB-Stick im Verzeichnis `clubiq-notfall`. Ohne tatsächlichen USB-Mount wird nicht versehentlich auf die SD-Karte geschrieben.
- Bei eingerichtetem R2 wird das Paket im **bestehenden privaten Bucket** unter `clubiq-notfall/` abgelegt und zum Vergleich vollständig zurückgelesen. Nur verschlüsselte Bytes verlassen den Raspberry.
- Zusätzlich liegt das neueste verschlüsselte Paket im normalen Backup-Cache. Der separate R2-Pfad ist entscheidend: Sonst wäre das Restic-Passwort nur innerhalb des mit genau diesem Passwort verschlüsselten Restic-Archivs erreichbar.
- Fehlendes Internet verhindert die USB-Kopie nicht; ein fehlender USB-Stick verhindert den R2-Versuch nicht. Fehler werden im nächsten stündlichen Lauf erneut versucht. Alte Notfallpakete werden nicht automatisch gelöscht; Speicherbedarf gelegentlich prüfen.

Das Paket ist **eine Ergänzung**, kein Ersatz für die Datenbankarchive. Cloudflare-Access-Richtlinien liegen bei Cloudflare, nicht im Paket. Cloudflare-Konto, dessen Zwei-Faktor-Notfallcodes und nötigenfalls eine erneute Tailscale-Anmeldung müssen weiterhin verfügbar sein. Der laufende Zustand aller Dienste nach einem echten Stromausfall wird durch diese Sicherung nicht getestet.

## Einmalige Einrichtung

1. Auf einem vertrauenswürdigen eigenen Rechner mit [age](https://github.com/FiloSottile/age) einen Schlüssel erzeugen: `age-keygen -o clubiq-notfallschluessel.txt`. Datei schützen; nicht in Git, Chat, Mail oder denselben Cloudflare-Bucket kopieren.
2. Öffentlichen Schlüssel exportieren: `age-keygen -y clubiq-notfallschluessel.txt > clubiq-empfaenger.txt`. **Nur diese öffentliche Empfängerdatei** auf den Pi übertragen.
3. Den privaten Schlüssel zusätzlich offline oder im geschützten Passwortmanager aufbewahren. Er wird nicht bei jedem Softwareupdate neu erzeugt. Vor einem Schlüsselwechsel alte Schlüssel und passende Pakete erhalten.
4. Auf dem Pi: `sudo clubiq notfall-einrichten /pfad/clubiq-empfaenger.txt`. Installiert age/rclone aus den Debian-Paketquellen und aktiviert den systemd-Timer. Der R2-Export muss vor der Einrichtung ausdrücklich genehmigt sein.
5. `sudo clubiq notfall-sichern` ausführen, anschließend `sudo clubiq notfall-status`. `r2: true` heißt hochgeladen und identisch zurückgelesen, nicht nur „Upload gestartet“.
6. Ein verschlüsseltes Paket auf dem eigenen Rechner mit dem getrennten privaten Schlüssel testweise entschlüsseln und Manifest/Vollständigkeit prüfen. **Nicht** auf die laufende Installation zurückspielen. Geheimnisse dabei nicht anzeigen oder protokollieren.

Die lokale HTTPS-Wartungsseite zeigt unter **Verschlüsseltes Notfallpaket** den Status. Dort lässt sich ein Lauf auch manuell starten. Der Schlüssel selbst kann über die Webseite weder heruntergeladen noch geändert werden. Ein über zwei Stunden alter Status wird als veraltet markiert.

## Wiederanlauf nach Totalausfall

1. Zugriff auf das Cloudflare-Konto oder den USB-Stick und den getrennten privaten age-Schlüssel sicherstellen.
2. Passendes `clubiq-notfall-…tar.gz.age` von USB oder **direkt aus R2 → Bucket → clubiq-notfall/** herunterladen. Hierfür ist zunächst noch kein Restic-Passwort nötig.
3. Auf einem vertrauenswürdigen Rechner in einem zugriffsgeschützten temporären Verzeichnis entschlüsseln: `age -d -i clubiq-notfallschluessel.txt -o wiederherstellung.tar.gz clubiq-notfall-DATUM.tar.gz.age`. Das Ergebnis enthält echte Zugangsdaten und darf nicht ungeschützt liegen bleiben.
4. Das Manifest prüfen und eine frische Raspberry-Installation vorbereiten. Einstellungen gezielt übernehmen, nicht blind `/etc/fstab`, Netzwerkdateien oder komplette Verzeichnisse über ein anderes System schreiben. Dateirechte für Secrets: root, Modus 600.
5. Mit dem wiederhergestellten Restic-Passwort und passenden R2-Zugangsdaten die normale Datenbanksicherung laden; alternativ das separate Datenbankarchiv auf USB verwenden. Die im Paket gespeicherte lokale Caddy-CA erhalten, damit vorhandene Kassentablets die Zertifikatskette weiter erkennen.
6. Datenbank in einer Testumgebung rücksichern und prüfen. Verwaltung zunächst öffentlich gesperrt lassen; alte Sitzungen/Einladungen entfernen und aktuelle Zugangsfreigaben prüfen. **Ein Backup kann damals noch aktive, inzwischen gesperrte oder gelöschte Konten wieder enthalten.**
7. Erst anschließend Kasse, Verwaltung, SMTP, Tunnel und Sicherungen kontrolliert wieder freigeben. Die Music-App wird durch dieses Paket nicht wiederhergestellt.

Der private Schlüssel allein ersetzt keine Cloudflare-Konto-Wiederherstellung. Ein Angreifer mit Raspberry-Rootrechten kann laufende Secrets lesen; Verschlüsselung von Sicherungen schützt nicht vor einem bereits vollständig übernommenen Server.

Technikreferenzen: [age-Format und Werkzeuge](https://github.com/FiloSottile/age), [rclone mit Cloudflare R2](https://rclone.org/s3/#cloudflare-r2).
