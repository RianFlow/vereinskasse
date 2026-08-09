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
  assert.match(caddy, /default_sni \{\$CLUBIQ_LAN_IP:127\.0\.0\.1\}/);
  assert.match(compose, /VINEXT_TRUSTED_HOSTS: .*CLUBIQ_LAN_IP/);
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
  const [compose, backup, loop, r2, r2Restore] = await Promise.all([
    read("deploy/docker/compose.yaml"),
    read("deploy/raspberry/backup.sh"),
    read("deploy/docker/backup-loop.sh"),
    read("deploy/docker/r2-backup.sh"),
    read("deploy/docker/r2-restore-latest.sh"),
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
  assert.doesNotMatch(backupService, /DAC_READ_SEARCH|DAC_OVERRIDE/);
  assert.match(r2, /restic backup/);
  assert.match(r2, /restic check/);
  assert.match(r2, /RESTIC_PASSWORD_FILE/);
  assert.match(r2Restore, /restic restore/);
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
  assert.match(workflow, /clubiq-rfid-esp8266\.bin/);
  assert.match(workflow, /clubiq-rfid-esp32\.bin/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /BUILDPLATFORM/);
  assert.match(dockerfile, /TARGETPLATFORM/);
  assert.match(dockerfile, /postgresql-client-17 restic tini/);
  const firmwareCopy = dockerfile.indexOf("./public/firmware/clubiq-rfid.bin");
  const applicationBuild = dockerfile.indexOf("RUN npm run build:raspberry");
  assert.ok(firmwareCopy >= 0 && firmwareCopy < applicationBuild, "Firmware muss vor dem App-Build als öffentliche Datei vorliegen");
  assert.match(dockerfile, /platformio run -e nodemcuv2 -e esp32dev/);
  assert.match(dockerfile, /\.\/public\/firmware\/clubiq-rfid-esp8266\.bin/);
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
  assert.match(readme, /clubiq netzwerk-aktualisieren/);
});
