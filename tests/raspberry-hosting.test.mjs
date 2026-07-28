import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("betreibt die Cloud- und Raspberry-Ausgabe aus demselben Quellstand", async () => {
  const [vite, packageJson] = await Promise.all([
    read("vite.config.ts"),
    read("package.json"),
  ]);
  assert.match(vite, /VEREINSKASSE_RUNTIME === "raspberry"/);
  assert.match(vite, /raspberry\/cloudflare-workers\.ts/);
  assert.match(packageJson, /build:raspberry/);
  assert.match(packageJson, /check:raspberry/);
});

test("speichert Raspberry-Daten transaktionssicher und migriert versioniert", async () => {
  const runtime = await read("raspberry/cloudflare-workers.ts");
  for (const safeguard of [
    "DatabaseSync",
    "journal_mode=WAL",
    "synchronous=FULL",
    "_vereinskasse_migrations",
    "Migration ${migration.name} wurde nachträglich verändert",
    "BEGIN IMMEDIATE",
    "ROLLBACK",
  ]) {
    assert.ok(runtime.includes(safeguard), `${safeguard} fehlt`);
  }
});

test("startet nach Stromausfall neu und bleibt auf lokale Datenpfade begrenzt", async () => {
  const service = await read("deploy/raspberry/vereinskasse.service");
  assert.match(service, /Restart=always/);
  assert.match(service, /After=network-online\.target/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/vereinskasse/);
  assert.match(service, /ProtectSystem=strict/);
});

test("sichert SQLite konsistent, prüft Integrität und unterstützt ein zweites Ziel", async () => {
  const [backup, restore, timer] = await Promise.all([
    read("deploy/raspberry/backup.sh"),
    read("deploy/raspberry/restore.sh"),
    read("deploy/raspberry/vereinskasse-backup.timer"),
  ]);
  assert.match(backup, /\.backup/);
  assert.match(backup, /PRAGMA integrity_check/);
  assert.match(backup, /VEREINSKASSE_SECONDARY_BACKUP_DIR/);
  assert.match(backup, /sha256sum/);
  assert.match(restore, /--preview/);
  assert.match(restore, /WIEDERHERSTELLEN/);
  assert.match(restore, /vor-wiederherstellung/);
  assert.match(timer, /Persistent=true/);
});

test("aktualisiert über GitHub mit Vorab-Sicherung und automatischem Rückfall", async () => {
  const update = await read("deploy/raspberry/update.sh");
  assert.match(update, /vereinskasse-backup/);
  assert.match(update, /npm run check:migrations/);
  assert.match(update, /npm run typecheck/);
  assert.match(update, /npm run build:raspberry/);
  assert.match(update, /vorherige Version wurde wieder aktiviert/);
});
