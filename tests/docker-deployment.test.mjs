import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("kapselt PostgreSQL und veröffentlicht nur den HTTPS-Zugang", async () => {
  const [compose, caddy] = await Promise.all([
    read("deploy/docker/compose.yaml"),
    read("deploy/docker/Caddyfile"),
  ]);
  assert.match(compose, /postgres:17-bookworm/);
  assert.match(compose, /POSTGRES_PASSWORD_FILE/);
  assert.match(compose, /PGPASSWORD_FILE/);
  assert.match(compose, /database:\r?\n\s+internal: true/);
  assert.doesNotMatch(compose, /5432:5432/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /max-size: "10m"/);
  assert.match(compose, /PGSSLMODE: \$\{POSTGRES_SSL_MODE:-disable\}/);
  assert.match(compose, /PGSSLROOTCERT: \$\{POSTGRES_SSL_ROOT_CERT:-\}/);
  assert.doesNotMatch(
    compose,
    /PGSSLROOTCERT: \$\{POSTGRES_SSL_ROOT_CERT:-system\}/,
    "Interne Verbindungen mit sslmode=disable dürfen kein systemweites Root-Zertifikat erzwingen",
  );
  assert.match(caddy, /Content-Type application\/x-x509-ca-cert/);
  assert.match(caddy, /Content-Disposition "attachment; filename=clubiq-ledger-ca\.crt"/);
  assert.match(caddy, /https:\/\/\{\$CLUBIQ_LAN_IP:127\.0\.0\.1\}/);
  assert.match(caddy, /default_sni \{\$CLUBIQ_KIOSK_IP:10\.42\.0\.1\}/);
  assert.match(caddy, /https:\/\/\{\$CLUBIQ_KIOSK_IP:10\.42\.0\.1\}/);
  assert.match(compose, /VINEXT_TRUSTED_HOSTS: .*CLUBIQ_LAN_IP/);
  assert.match(compose, /VINEXT_TRUSTED_HOSTS: .*CLUBIQ_KIOSK_IP/);
});

test("stellt Tailscale Serve nur ueber einen lokalen Proxy-Eingang bereit", async () => {
  const [compose, caddy, manager, readme] = await Promise.all([
    read("deploy/docker/compose.yaml"),
    read("deploy/docker/Caddyfile"),
    read("deploy/docker/clubiq"),
    read("deploy/docker/README.md"),
  ]);
  assert.match(compose, /"127\.0\.0\.1:8090:8090"/);
  assert.doesNotMatch(compose, /\n\s+- "8090:8090"/);
  assert.match(caddy, /http:\/\/:8090/);
  assert.match(caddy, /header_up Host \{\$CLUBIQ_HOSTNAME:vereinskasse\.local\}/);
  assert.match(caddy, /header_up X-Forwarded-Proto https/);
  assert.match(manager, /tailscale serve --bg http:\/\/127\.0\.0\.1:8090/);
  assert.match(manager, /tailscale serve --https=443 off/);
  assert.match(manager, /compose_with_tailscale_paused/);
  assert.match(manager, /fernzugriff-einrichten\|remote-access-setup/);
  assert.match(readme, /Tailscale Funnel\s+nicht aktivieren/);
  assert.match(readme, /weder eine Domain noch eine Portfreigabe/);
});

test("startet Datenbankabgleich, Migration, Bootstrap und Gesundheitsprüfung automatisch", async () => {
  const [entrypoint, admin, compose, reconcile, install, manager] = await Promise.all([
    read("deploy/docker/app-entrypoint.sh"),
    read("raspberry/postgres-admin.mjs"),
    read("deploy/docker/compose.yaml"),
    read("deploy/docker/postgres-reconcile.sh"),
    read("deploy/docker/install.sh"),
    read("deploy/docker/clubiq"),
  ]);
  assert.match(entrypoint, /postgres-admin\.mjs wait/);
  assert.match(entrypoint, /postgres-admin\.mjs migrate/);
  assert.match(entrypoint, /postgres-admin\.mjs bootstrap/);
  assert.match(entrypoint, /gosu node/);
  assert.ok(
    admin.indexOf("SELECT COUNT(*)::int count FROM profiles") <
      admin.indexOf("VEREINSKASSE_INITIAL_PROFILE_PIN muss"),
    "Vorhandene Installationen dürfen beim Neustart keine Start-PIN benötigen",
  );
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /database-setup:/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(reconcile, /WHERE NOT EXISTS \(SELECT 1 FROM pg_roles/);
  assert.match(reconcile, /ALTER ROLE vereinskasse WITH LOGIN PASSWORD/);
  assert.match(reconcile, /ALTER SCHEMA public OWNER TO vereinskasse/);
  assert.match(install, /--resolve "\$\{hostname_setting\}:443:127\.0\.0\.1"/);
  assert.match(manager, /--resolve "\$\{hostname_setting\}:443:127\.0\.0\.1"/);
  assert.match(manager, /netzwerk-aktualisieren\|network-refresh/);
  assert.doesNotMatch(install, /https:\/\/127\.0\.0\.1\/api\/profiles/);
  assert.doesNotMatch(manager, /https:\/\/127\.0\.0\.1\/api\/profiles/);
});

test("sichert stündlich auf lokal, freigegebenen USB und optional verschlüsselt nach R2", async () => {
  const [compose, backup, loop, r2, r2Restore, manager] = await Promise.all([
    read("deploy/docker/compose.yaml"),
    read("deploy/raspberry/backup.sh"),
    read("deploy/docker/backup-loop.sh"),
    read("deploy/docker/r2-backup.sh"),
    read("deploy/docker/r2-restore-latest.sh"),
    read("deploy/docker/clubiq"),
  ]);
  assert.match(compose, /BACKUP_INTERVAL_SECONDS:-3600/);
  assert.match(backup, /read_secret_if_present PGPASSWORD/);
  assert.match(backup, /pg_dump --no-password/);
  assert.match(backup, /pg_dump .*--format=custom/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /gosu node tar -C "\$objects" -cf -/);
  assert.match(backup, /tar -C "\$work\/data\/backups" --no-same-owner -xf -/);
  assert.match(backup, /cp -a --no-preserve=ownership/);
  assert.match(backup, /VEREINSKASSE_SECONDARY_REQUIRED_MARKER/);
  assert.match(backup, /sha256sum/);
  assert.match(loop, /\.last-backup\.json/);
  const backupService = compose.slice(
    compose.indexOf("\n  backup:"),
    compose.indexOf("\n  tools:"),
  );
  assert.match(backupService, /app:\s*\n\s+condition: service_healthy/);
  assert.match(backupService, /cap_add:[\s\S]*?- SETGID\s*\n\s+- SETUID/);
  assert.match(backupService, /networks:\s*\n\s+- database\s*\n\s+- backup-egress/);
  assert.doesNotMatch(backupService, /DAC_READ_SEARCH|DAC_OVERRIDE/);
  const networkDeclarations = compose.slice(
    compose.indexOf("\nnetworks:"),
    compose.indexOf("\nsecrets:"),
  );
  assert.match(networkDeclarations, /\n  backup-egress:\s*(?:\n|$)/);
  assert.doesNotMatch(networkDeclarations, /backup-egress:\s*\n\s+internal: true/);
  assert.match(r2, /restic backup/);
  assert.match(r2, /restic check/);
  assert.match(r2, /RESTIC_PASSWORD_FILE/);
  assert.match(r2Restore, /restic restore/);
  assert.match(manager, /Erlaubt sind 3 bis 63 Kleinbuchstaben, Zahlen und Bindestriche/);
  assert.doesNotMatch(manager, /\[A-Za-z0-9\._-\]\{3,63\}/);
});

test("prüft eine Rücksicherung in einer temporären Datenbank und behält den Rückfall", async () => {
  const [restore, reset, manager] = await Promise.all([
    read("deploy/docker/restore.sh"),
    read("deploy/docker/new-database.sh"),
    read("deploy/docker/clubiq"),
  ]);
  assert.match(restore, /sha256sum -c/);
  assert.match(restore, /restore_preview/);
  assert.match(restore, /pg_restore --no-owner --no-acl --exit-on-error/);
  assert.match(restore, /vor_restore/);
  assert.match(restore, /WIEDERHERSTELLEN/);
  assert.match(reset, /NEUE DATENBANK/);
  assert.match(reset, /test_archiv/);
  assert.match(manager, /Neue Version ist nicht gesund/);
  assert.match(manager, /docker tag/);
});

test("baut dasselbe Image für Raspberry ARM64 und PC", async () => {
  const [workflow, dockerfile, install, compose, environment, readme] = await Promise.all([
    read(".github/workflows/container.yml"),
    read("Dockerfile"),
    read("deploy/docker/install.sh"),
    read("deploy/docker/compose.yaml"),
    read("deploy/docker/.env.example"),
    read("deploy/docker/README.md"),
  ]);
  assert.match(workflow, /linux\/amd64,linux\/arm64/);
  assert.match(workflow, /ghcr\.io\/rianflow\/vereinskasse/);
  assert.match(workflow, /provenance: true/);
  assert.match(workflow, /sbom: true/);
  assert.match(workflow, /curl .*\/firmware\/clubiq-rfid\.bin/);
  assert.match(workflow, /backup-permission-test\/proof\.json/);
  assert.match(workflow, /clubiq-rfid-esp32\.bin/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /BUILDPLATFORM/);
  assert.match(dockerfile, /TARGETPLATFORM/);
  assert.match(dockerfile, /postgresql-client-17 restic tini/);
  const firmwareCopy = dockerfile.indexOf("./public/firmware/clubiq-rfid.bin");
  const applicationBuild = dockerfile.indexOf("RUN npm run build:raspberry");
  assert.ok(firmwareCopy >= 0 && firmwareCopy < applicationBuild, "Firmware muss vor dem App-Build als öffentliche Datei vorliegen");
  assert.match(dockerfile, /platformio run -e esp32_d1_mini/);
  assert.doesNotMatch(dockerfile, /nodemcuv2|clubiq-rfid-esp8266\.bin/);
  assert.match(dockerfile, /\.\/public\/firmware\/clubiq-rfid-esp32\.bin/);
  assert.doesNotMatch(dockerfile, /\.\/dist\/client\/firmware\/clubiq-rfid\.bin/);
  assert.doesNotMatch(dockerfile, /purge --auto-remove/);
  assert.doesNotMatch(compose, /\n\s+init: true/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini"/);
  assert.match(compose, /CLUBIQ_IMAGE_TAG:-latest/);
  assert.doesNotMatch(compose, /CLUBIQ_IMAGE_TAG:-test/);
  assert.match(environment, /^CLUBIQ_IMAGE_TAG=latest$/m);
  assert.match(environment, /^CLUBIQ_LAN_IP=127\.0\.0\.1$/m);
  assert.doesNotMatch(environment, /^CLUBIQ_IMAGE_TAG=test$/m);
  assert.match(readme, /git clone --branch main/);
  assert.doesNotMatch(readme, /git clone --branch codex\/raspberry-docker/);
  assert.match(install, /Raspberry Pi OS 64-Bit/);
  assert.match(install, /download\.docker\.com\/linux\/debian/);
  assert.match(install, /CLUBIQ_LAN_IP/);
  assert.match(readme, /clubiq kassen-wlan-einrichten/);
});

test("richtet ein dauerhaftes 2,4-GHz-Kassen-WLAN getrennt vom Internet-Uplink ein", async () => {
  const [manager, install, environment, caddy] = await Promise.all([
    read("deploy/docker/clubiq"),read("deploy/docker/install.sh"),read("deploy/docker/.env.example"),read("deploy/docker/Caddyfile")
  ]);
  for(const fragment of ["kassen-wlan-einrichten|kiosk-wifi-setup","802-11-wireless.mode ap","802-11-wireless.band bg","802-11-wireless.channel 6","ipv4.method shared","10.42.0.1/24","--ohne-lan"])
    assert.ok(manager.includes(fragment),`Kassen-WLAN-Einrichtung fehlt: ${fragment}`);
  assert.ok(manager.includes("ip -4 -o address show dev eth0"),"Der LAN-Zustand wird weiterhin getrennt ermittelt");
  assert.ok(install.includes("network-manager"),"NetworkManager wird nicht installiert");
  assert.ok(environment.includes("CLUBIQ_KIOSK_WIFI_SSID=ClubIQ-Kasse")&&environment.includes("CLUBIQ_KIOSK_IP=10.42.0.1"),"Stabile Kassen-WLAN-Vorgaben fehlen");
  assert.ok(caddy.includes("/clubiq-time"),"Der RFID-Leser kann offline keine lokale Startzeit laden");
});

test("stellt ein unabhaengiges PIN-geschuetztes Wartungsportal bereit", async () => {
  const [server, service, installer, manager] = await Promise.all([
    read("deploy/maintenance/server.py"),
    read("deploy/maintenance/clubiq-maintenance.service"),
    read("deploy/maintenance/install.sh"),
    read("deploy/docker/clubiq"),
  ]);
  assert.match(service,/Restart=always/);
  assert.match(service,/python3 \/usr\/local\/lib\/clubiq-maintenance\/server\.py/);
  assert.match(installer,/maintenance_pin/);
  assert.match(installer,/systemctl enable --now clubiq-maintenance\.service/);
  assert.match(installer,/firmware-mediatek/);
  assert.match(installer,/modprobe mt76x2u/);
  assert.match(server,/X-ClubIQ-Maintenance-Pin/);
  assert.match(server,/hmac\.compare_digest/);
  assert.match(server,/\/api\/internet-wifi\/scan/);
  assert.match(server,/\/api\/internet-wifi\/connect/);
  assert.match(server,/rfkill.*unblock.*wifi/s);
  assert.match(server,/ip.*link.*set.*interface.*up/s);
  assert.match(server,/iw.*reg.*set.*WIFI_COUNTRY/s);
  assert.match(server,/clubiq-internet-wlan/);
  assert.match(server,/ipv4\.route-metric/);
  assert.match(server,/BSSID,SSID,SIGNAL,SECURITY,FREQ/);
  assert.match(server,/"managed", "yes"/);
  assert.match(server,/device == "wlan0"/);
  assert.match(server,/connection == KIOSK_CONNECTION/);
  assert.match(server,/\/sys\/class\/net\//);
  for(const action of ["restart_stack","restart_wifi","backup","reboot"])
    assert.ok(server.includes(action),`Wartungsaktion fehlt: ${action}`);
  assert.doesNotMatch(server,/docker\.sock/);
  assert.match(manager,/wartung-einrichten\|maintenance-setup/);
});
