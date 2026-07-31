import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const command = process.argv[2] || "check";
const projectRoot = resolve(process.env.VEREINSKASSE_APP_DIR || process.cwd());

function config() {
  const ssl =
    process.env.VEREINSKASSE_POSTGRES_SSL === "require"
      ? { rejectUnauthorized: true }
      : undefined;
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
    };
  }
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "vereinskasse",
    user: process.env.PGUSER || "vereinskasse",
    password: process.env.PGPASSWORD,
    ssl,
  };
}

const checksum = (value) =>
  createHash("sha256").update(value).digest("hex");

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('clubiq-ledger-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS _vereinskasse_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const directory = join(projectRoot, "postgres", "migrations");
    const migrations = readdirSync(directory)
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    for (const name of migrations) {
      const sql = readFileSync(join(directory, name), "utf8");
      const digest = checksum(sql);
      const known = await client.query(
        "SELECT checksum FROM _vereinskasse_migrations WHERE name=$1",
        [name],
      );
      if (known.rows[0]) {
        if (known.rows[0].checksum !== digest) {
          throw new Error(
            `Migration ${name} wurde nachträglich verändert. Abbruch.`,
          );
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO _vereinskasse_migrations (name,checksum,applied_at) VALUES ($1,$2,$3)",
          [name, digest, new Date().toISOString()],
        );
        await client.query("COMMIT");
        console.log(`Migration angewendet: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('clubiq-ledger-migrations'))")
      .catch(() => {});
    client.release();
  }
}

async function bootstrap(pool) {
  const existing = await pool.query("SELECT COUNT(*)::int count FROM profiles");
  if (Number(existing.rows[0]?.count || 0) > 0) {
    console.log("Startprofil bereits vorhanden; keine Änderung vorgenommen.");
    return;
  }
  const pin = process.env.VEREINSKASSE_INITIAL_PROFILE_PIN || "";
  if (!/^\d{6}$/.test(pin)) {
    throw new Error(
      "VEREINSKASSE_INITIAL_PROFILE_PIN muss genau sechs Ziffern enthalten.",
    );
  }
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(pin, salt, 100_000, 32, "sha256").toString("hex");
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO profiles
      (id,name,short_name,color,pin_salt,pin_hash,must_change_pin,failed_attempts,recovery_failed_attempts,active,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,1,0,0,1,$7,$7)`,
    ["darts", "SV Barver Darts", "Darts", "#1d5b4c", salt, hash, now],
  );
  console.log(
    "Sauberes Startprofil angelegt. Die PIN muss bei der ersten Anmeldung geändert werden.",
  );
}

async function check(pool) {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public') tables,
      (SELECT COUNT(*)::int FROM profiles) profiles,
      (SELECT COUNT(*)::int FROM members) members,
      (SELECT COUNT(*)::int FROM sales) sales,
      pg_database_size(current_database()) bytes
  `);
  const row = result.rows[0];
  if (Number(row.tables) < 20) {
    throw new Error("PostgreSQL-Schema ist unvollständig.");
  }
  console.log(
    `PostgreSQL bereit: ${row.tables} Tabellen, ${row.profiles} Profile, ${row.members} Mitglieder, ${row.sales} Buchungen, ${row.bytes} Byte.`,
  );
}

if (!["migrate", "bootstrap", "check"].includes(command)) {
  console.error(
    "Verwendung: node raspberry/postgres-admin.mjs migrate|bootstrap|check",
  );
  process.exit(2);
}

const pool = new Pool({ ...config(), connectionTimeoutMillis: 5_000, max: 2 });
try {
  if (command === "migrate" || command === "bootstrap") await migrate(pool);
  if (command === "bootstrap") await bootstrap(pool);
  await check(pool);
} finally {
  await pool.end();
}
