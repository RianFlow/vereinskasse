import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("kapselt PostgreSQL und veröffentlicht nur den HTTPS-Zugang", async () => {
  const compose = await read("deploy/docker/compose.yaml");
  assert.match(compose, /postgres:17-bookworm/);
  assert.match(compose, /POSTGRES_PASSWORD_FILE/);
  assert.match(compose, /PGPASSWORD_FILE/);
  assert.match(compose, /database:\n\s+internal: true/);
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
});

test("startet Migration, Bootstrap und Gesundheitsprüfung automatisch", async () => {
  const [entrypoint, admin, compose] = await Promise.all([
    read("deploy/docker/app-entrypoint.sh"),
    read("raspberry/postgres-admin.mjs"),
    read("deploy/docker/compose.yaml"),
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
  assert.match(backup, /pg_dump --format=custom/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /cp -a --no-preserve=ownership/);
  assert.match(backup, /VEREINSKASSE_SECONDARY_REQUIRED_MARKER/);
  assert.match(backup, /sha256sum/);
  assert.match(loop, /\.last-backup\.json/);
  const backupService = compose.slice(
    compose.indexOf("\n  backup:"),
    compose.indexOf("\n  tools:"),
  );
  assert.match(backupService, /app:\s*\n\s+condition: service_healthy/);
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
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /BUILDPLATFORM/);
  assert.match(dockerfile, /TARGETPLATFORM/);
  assert.match(dockerfile, /postgresql-client-17 restic tini/);
  assert.doesNotMatch(dockerfile, /purge --auto-remove/);
  assert.match(compose, /\n\s+init: true/);
  assert.match(compose, /CLUBIQ_IMAGE_TAG:-latest/);
  assert.doesNotMatch(compose, /CLUBIQ_IMAGE_TAG:-test/);
  assert.match(environment, /^CLUBIQ_IMAGE_TAG=latest$/m);
  assert.doesNotMatch(environment, /^CLUBIQ_IMAGE_TAG=test$/m);
  assert.match(readme, /git clone --branch main/);
  assert.doesNotMatch(readme, /git clone --branch codex\/raspberry-docker/);
  assert.match(install, /Raspberry Pi OS 64-Bit/);
  assert.match(install, /download\.docker\.com\/linux\/debian/);
});
