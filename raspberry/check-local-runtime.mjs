import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const testDirectory = mkdtempSync(join(tmpdir(), "vereinskasse-pi-check-"));
const port = 32000 + Math.floor(Math.random() * 2000);
const child = spawn(
  process.execPath,
  ["node_modules/vinext/dist/cli.js", "start"],
  {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      VEREINSKASSE_RUNTIME: "raspberry",
      VEREINSKASSE_APP_DIR: process.cwd(),
      VEREINSKASSE_DATA_DIR: testDirectory,
    },
  },
);

let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

try {
  const deadline = Date.now() + 30_000;
  let response;
  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response?.ok) throw new Error(`Lokaler Server nicht erreichbar.\n${output}`);
  const profileResponse = await fetch(`http://127.0.0.1:${port}/api/profiles`);
  if (!profileResponse.ok) {
    throw new Error(
      `Lokale Datenbank-API nicht erreichbar: HTTP ${profileResponse.status}.\n${output}`,
    );
  }

  const db = new DatabaseSync(join(testDirectory, "vereinskasse.sqlite"));
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const tables = db
    .prepare(
      "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .get();
  db.close();
  if (integrity?.integrity_check !== "ok" || Number(tables?.count || 0) < 10) {
    throw new Error(
      `Die lokale Datenbankprüfung ist fehlgeschlagen: ${JSON.stringify({ integrity, tables })}`,
    );
  }
  console.log(
    `Raspberry-Laufzeit geprüft: HTTP ${response.status}, Datenbank vollständig (${tables.count} Tabellen).`,
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 2_000);
  });
  rmSync(testDirectory, { recursive: true, force: true });
}
