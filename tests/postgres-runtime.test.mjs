import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { newDb } from "pg-mem";
import { postgresSql } from "../raspberry/postgres-sql.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("übersetzt die bestehende D1-Abfrageschnittstelle sicher nach PostgreSQL", () => {
  assert.equal(
    postgresSql("SELECT member_id memberId FROM members WHERE id=? AND name='?'"),
    `SELECT member_id "memberId" FROM members WHERE id=$1 AND name='?'`,
  );
  assert.equal(
    postgresSql("INSERT OR IGNORE INTO sales (id) VALUES (?)"),
    "INSERT INTO sales (id) VALUES ($1) ON CONFLICT DO NOTHING",
  );
  assert.match(
    postgresSql(
      "SELECT GROUP_CONCAT(si.quantity || 'x ' || si.product_name, ' | ') details FROM sale_items si",
    ),
    /STRING_AGG\(si\.quantity::text.*ORDER BY si\.id\)/,
  );
  assert.match(
    postgresSql(
      "UPDATE random_reward_campaigns SET remaining_wins=MAX(0,remaining_wins-1)",
    ),
    /GREATEST/,
  );
});

test("legt ein vollständiges leeres PostgreSQL-Schema mit exakten Geldwerten an", async () => {
  const schema = await read("postgres/migrations/0001_baseline.sql");
  const rfidPairing = await read("postgres/migrations/0002_rfid_pairing.sql");
  const productIds = await read("postgres/migrations/0005_product_ids_bigint.sql");
  const tables = [...schema.matchAll(/CREATE TABLE ([a-z_]+)/g)].map(
    (match) => match[1],
  );
  for (const table of [
    "profiles",
    "members",
    "products",
    "sales",
    "sale_items",
    "sale_allocations",
    "account_transactions",
    "monthly_closures",
    "rfid_cards",
    "audit_logs",
  ]) {
    assert.ok(tables.includes(table), `${table} fehlt im PostgreSQL-Schema`);
  }
  assert.ok(tables.length >= 25, "PostgreSQL-Schema ist unvollständig");
  assert.match(schema, /NUMERIC\(12,2\)/);
  assert.doesNotMatch(schema, /INSERT INTO profiles/);
  assert.match(productIds, /ALTER TABLE products ALTER COLUMN id TYPE BIGINT/);
  assert.match(productIds, /ALTER TABLE sale_items ALTER COLUMN product_id TYPE BIGINT/);

  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  try {
    await pool.query(schema);
    await pool.query(rfidPairing);
    await pool.query(productIds);
    const timestampId = Date.now();
    await pool.query(
      "INSERT INTO products (id,name,price,profile_id,member_price,included_items_json,is_offer,icon,category,color,updated_at) VALUES ($1,$2,$3,$4,NULL,'[]',0,$5,$6,$7,$8)",
      [timestampId, "Neuer Artikel", 1, "darts", "sparkles", "Sonstiges", "#a6a1d8", new Date().toISOString()],
    );
    const storedProduct = await pool.query("SELECT id FROM products WHERE id=$1", [timestampId]);
    assert.equal(Number(storedProduct.rows[0].id), timestampId);
    await pool.query(
      "INSERT INTO members (id,name,role,code,initials,active) VALUES ($1,$2,$3,$4,$5,1)",
      ["M-1", "Test Mitglied", "Mitglied", "NOLOGIN-M-1", "TM"],
    );
    const selected = await pool.query(
      postgresSql("SELECT member_id memberId FROM rfid_cards WHERE uid=?"),
      ["00:00:00:00"],
    );
    assert.deepEqual(selected.rows, []);
    const counted = await pool.query("SELECT COUNT(*)::int count FROM members");
    assert.equal(counted.rows[0].count, 1);
    await pool.query(
      "INSERT INTO rfid_pairing_requests (id,hardware_id,name,code_hash,token_hash,status,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7)",
      ["PAIR-1", "ESP8266-123ABC", "Leser Test", "code-hash", "token-hash", new Date().toISOString(), new Date(Date.now()+60000).toISOString()],
    );
    const pairing = await pool.query("SELECT hardware_id,status FROM rfid_pairing_requests WHERE id=$1",["PAIR-1"]);
    assert.deepEqual(pairing.rows,[{hardware_id:"ESP8266-123ABC",status:"pending"}]);
  } finally {
    await pool.end();
  }
});

test("migriert PostgreSQL versioniert und führt D1-Batches als Transaktion aus", async () => {
  const runtime = await read("raspberry/postgres-d1.ts");
  for (const safeguard of [
    "_vereinskasse_migrations",
    "pg_advisory_lock",
    'client.query("BEGIN")',
    'client.query("COMMIT")',
    'client.query("ROLLBACK")',
    "ON CONFLICT DO NOTHING",
    "VEREINSKASSE_POSTGRES_SSL",
    "rejectUnauthorized: true",
  ]) {
    const sources = `${runtime}\n${await read("raspberry/postgres-sql.mjs")}`;
    assert.ok(sources.includes(safeguard), `${safeguard} fehlt`);
  }
});

test("installiert, prüft, sichert und erneuert die Raspberry-Datenbank kontrolliert", async () => {
  const [install, backup, restore, reset, service, admin] = await Promise.all([
    read("deploy/raspberry/install.sh"),
    read("deploy/raspberry/backup.sh"),
    read("deploy/raspberry/restore.sh"),
    read("deploy/raspberry/reset-database.sh"),
    read("deploy/raspberry/vereinskasse.service"),
    read("raspberry/postgres-admin.mjs"),
  ]);
  assert.match(install, /postgresql postgresql-client/);
  assert.match(install, /VEREINSKASSE_DATABASE_PROVIDER=postgres/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /pg_restore --list/);
  assert.match(restore, /restore_preview/);
  assert.match(restore, /WIEDERHERSTELLEN/);
  assert.match(reset, /NEUE DATENBANK/);
  assert.match(reset, /vereinskasse-backup/);
  assert.match(reset, /test_archiv/);
  assert.match(reset, /archive_objects/);
  assert.match(service, /Requires=postgresql\.service/);
  assert.match(admin, /must_change_pin/);
  assert.match(admin, /100_000/);
});
