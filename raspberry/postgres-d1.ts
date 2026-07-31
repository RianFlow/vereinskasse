import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg, { type PoolClient, type QueryResult } from "pg";
import { postgresSql } from "./postgres-sql.mjs";

export { postgresSql } from "./postgres-sql.mjs";

type SqlValue = string | number | bigint | null | Uint8Array;
type QueryClient = pg.Pool | PoolClient;

const { Pool, types } = pg;

// pg liefert BIGINT und NUMERIC standardmäßig als Zeichenketten. Die
// bestehende D1-Schnittstelle liefert Zahlen; diese Parser halten beide
// Laufzeiten für die Anwendung identisch.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function postgresConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.VEREINSKASSE_POSTGRES_SSL === "require"
          ? { rejectUnauthorized: true }
          : undefined,
    };
  }
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "vereinskasse",
    user: process.env.PGUSER || "vereinskasse",
    password: process.env.PGPASSWORD,
  };
}

async function applyPostgresMigrations(pool: pg.Pool, projectRoot: string) {
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
      const migrationChecksum = checksum(sql);
      const known = await client.query<{ checksum: string }>(
        "SELECT checksum FROM _vereinskasse_migrations WHERE name=$1",
        [name],
      );
      if (known.rows[0]) {
        if (known.rows[0].checksum !== migrationChecksum) {
          throw new Error(
            `PostgreSQL-Migration ${name} wurde nachträglich verändert. Start aus Sicherheitsgründen abgebrochen.`,
          );
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO _vereinskasse_migrations (name,checksum,applied_at) VALUES ($1,$2,$3)",
          [name, migrationChecksum, new Date().toISOString()],
        );
        await client.query("COMMIT");
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

function resultMeta(result: QueryResult) {
  const changes = result.rowCount || 0;
  return {
    duration: 0,
    changes,
    last_row_id: 0,
    rows_read: result.command === "SELECT" ? changes : 0,
    rows_written: result.command === "SELECT" ? 0 : changes,
  };
}

class PostgresD1PreparedStatement {
  private values: SqlValue[] = [];

  constructor(
    private readonly database: PostgresD1Database,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]) {
    const bound = new PostgresD1PreparedStatement(this.database, this.sql);
    bound.values = values;
    return bound;
  }

  async query(client?: QueryClient, rowMode?: "array") {
    return this.database.query(this.sql, this.values, client, rowMode);
  }

  async first<T = Record<string, unknown>>(columnName?: string) {
    const result = await this.query();
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = Record<string, unknown>>() {
    const result = await this.query();
    return {
      success: true,
      results: result.rows as T[],
      meta: resultMeta(result),
    };
  }

  async raw<T = unknown[]>() {
    const result = await this.query(undefined, "array");
    return result.rows as T[];
  }

  async run(client?: QueryClient) {
    const result = await this.query(client);
    return {
      success: true,
      results: result.rows,
      meta: resultMeta(result),
    };
  }
}

export class PostgresD1Database {
  private readonly pool: pg.Pool;
  private readonly ready: Promise<void>;

  constructor(projectRoot: string) {
    this.pool = new Pool({
      ...postgresConfig(),
      max: Number(process.env.VEREINSKASSE_POSTGRES_POOL_SIZE || 10),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    this.ready = applyPostgresMigrations(this.pool, resolve(projectRoot));
  }

  prepare(sql: string) {
    return new PostgresD1PreparedStatement(this, postgresSql(sql));
  }

  async query(
    sql: string,
    values: SqlValue[],
    client: QueryClient = this.pool,
    rowMode?: "array",
  ): Promise<QueryResult> {
    await this.ready;
    return client.query({
      text: sql,
      values: values.map((value) =>
        value instanceof Uint8Array ? Buffer.from(value) : value,
      ),
      ...(rowMode ? { rowMode } : {}),
    } as never) as Promise<QueryResult>;
  }

  async batch(statements: PostgresD1PreparedStatement[]) {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run(client));
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exec(sql: string) {
    await this.ready;
    const result = await this.pool.query(sql);
    return { count: result.rowCount || 0, duration: 0 };
  }
}

export function createPostgresD1Database(projectRoot: string) {
  return new PostgresD1Database(projectRoot);
}
