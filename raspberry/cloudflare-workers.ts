import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createPostgresD1Database } from "./postgres-d1";

type SqlValue = string | number | bigint | null | Uint8Array;
type BoundStatement = LocalD1PreparedStatement;
type ObjectMetadata = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

const projectRoot = resolve(
  process.env.VEREINSKASSE_APP_DIR || process.cwd(),
);
const dataDirectory = resolve(
  process.env.VEREINSKASSE_DATA_DIR || join(projectRoot, "data"),
);
const databasePath = resolve(
  process.env.VEREINSKASSE_DATABASE_PATH ||
    join(dataDirectory, "vereinskasse.sqlite"),
);
const objectDirectory = resolve(
  process.env.VEREINSKASSE_BACKUP_DIR || join(dataDirectory, "backups"),
);
const databaseProvider =
  process.env.VEREINSKASSE_DATABASE_PROVIDER === "postgres" ||
  Boolean(process.env.DATABASE_URL)
    ? "postgres"
    : "sqlite";

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(objectDirectory, { recursive: true });

function ensureInside(base: string, candidate: string) {
  const child = relative(base, candidate);
  if (child.startsWith("..") || isAbsolute(child)) {
    throw new Error("Ungültiger Speicherpfad");
  }
}

function migrationFiles() {
  const directory = join(projectRoot, "drizzle");
  return readdirSync(directory)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, path: join(directory, name) }));
}

function checksum(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function applyMigrations(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _vereinskasse_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const known = database.prepare(
    "SELECT checksum FROM _vereinskasse_migrations WHERE name=?",
  );
  const record = database.prepare(
    "INSERT INTO _vereinskasse_migrations (name,checksum,applied_at) VALUES (?,?,?)",
  );

  for (const migration of migrationFiles()) {
    const sql = readFileSync(migration.path, "utf8");
    const migrationChecksum = checksum(sql);
    const applied = known.get(migration.name) as
      | { checksum: string }
      | undefined;
    if (applied) {
      if (applied.checksum !== migrationChecksum) {
        throw new Error(
          `Migration ${migration.name} wurde nachträglich verändert. Start aus Sicherheitsgründen abgebrochen.`,
        );
      }
      continue;
    }

    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) database.exec(statement);
      record.run(migration.name, migrationChecksum, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

class LocalD1PreparedStatement {
  private values: SqlValue[] = [];

  constructor(
    private readonly statement: StatementSync,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]) {
    const bound = new LocalD1PreparedStatement(this.statement, this.sql);
    bound.values = values;
    return bound;
  }

  private resultMeta(changes = 0, lastRowId = 0) {
    return {
      duration: 0,
      changes,
      last_row_id: lastRowId,
      rows_read: 0,
      rows_written: changes,
    };
  }

  async first<T = Record<string, unknown>>(columnName?: string) {
    const row = this.statement.get(...this.values) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = Record<string, unknown>>() {
    const results = this.statement.all(...this.values) as T[];
    return {
      success: true,
      results,
      meta: this.resultMeta(),
    };
  }

  async raw<T = unknown[]>() {
    this.statement.setReturnArrays(true);
    try {
      return this.statement.all(...this.values) as T[];
    } finally {
      this.statement.setReturnArrays(false);
    }
  }

  async run() {
    const result = this.statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: this.resultMeta(
        Number(result.changes),
        Number(result.lastInsertRowid),
      ),
    };
  }
}

class LocalD1Database {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
    });
    this.database.exec("PRAGMA journal_mode=WAL");
    this.database.exec("PRAGMA synchronous=FULL");
    this.database.exec("PRAGMA busy_timeout=5000");
    this.database.exec("PRAGMA foreign_keys=ON");
    applyMigrations(this.database);
  }

  prepare(sql: string) {
    return new LocalD1PreparedStatement(this.database.prepare(sql), sql);
  }

  async batch(statements: BoundStatement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql: string) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }
}

function objectPaths(key: string) {
  if (!key || key.includes("\\") || key.split("/").includes("..")) {
    throw new Error("Ungültiger Sicherungsschlüssel");
  }
  const contentPath = resolve(objectDirectory, ...key.split("/"));
  ensureInside(objectDirectory, contentPath);
  return {
    contentPath,
    metadataPath: `${contentPath}.metadata.json`,
  };
}

function readMetadata(metadataPath: string): ObjectMetadata {
  if (!existsSync(metadataPath)) return {};
  return JSON.parse(readFileSync(metadataPath, "utf8")) as ObjectMetadata;
}

function storedObject(key: string) {
  const { contentPath, metadataPath } = objectPaths(key);
  if (!existsSync(contentPath) || !statSync(contentPath).isFile()) return null;
  const value = readFileSync(contentPath);
  const metadata = readMetadata(metadataPath);
  const uploaded = statSync(contentPath).mtime;
  return {
    key,
    size: value.byteLength,
    uploaded,
    httpMetadata: metadata.httpMetadata,
    customMetadata: metadata.customMetadata,
    body: value,
    async text() {
      return value.toString("utf8");
    },
    async json<T>() {
      return JSON.parse(value.toString("utf8")) as T;
    },
    async arrayBuffer() {
      return value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      );
    },
  };
}

function objectDescriptor(object: NonNullable<ReturnType<typeof storedObject>>) {
  return {
    key: object.key,
    size: object.size,
    uploaded: object.uploaded,
    httpMetadata: object.httpMetadata,
    customMetadata: object.customMetadata,
  };
}

class LocalR2Bucket {
  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | Blob,
    options: ObjectMetadata = {},
  ) {
    const { contentPath, metadataPath } = objectPaths(key);
    mkdirSync(dirname(contentPath), { recursive: true });
    const bytes =
      typeof value === "string"
        ? Buffer.from(value)
        : value instanceof Blob
          ? Buffer.from(await value.arrayBuffer())
          : ArrayBuffer.isView(value)
            ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
            : Buffer.from(value);
    const temporary = `${contentPath}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, contentPath);
    writeFileSync(metadataPath, JSON.stringify(options), { mode: 0o600 });
    return storedObject(key);
  }

  async get(key: string) {
    return storedObject(key);
  }

  async head(key: string) {
    const object = storedObject(key);
    if (!object) return null;
    return objectDescriptor(object);
  }

  async delete(key: string) {
    const { contentPath, metadataPath } = objectPaths(key);
    if (existsSync(contentPath)) unlinkSync(contentPath);
    if (existsSync(metadataPath)) unlinkSync(metadataPath);
  }

  async list(options: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    include?: string[];
  } = {}) {
    const prefix = options.prefix || "";
    const objects: Array<NonNullable<ReturnType<typeof storedObject>>> = [];
    const walk = (directory: string) => {
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) walk(entryPath);
        else if (!entry.name.endsWith(".metadata.json")) {
          const key = relative(objectDirectory, entryPath).replaceAll("\\", "/");
          if (key.startsWith(prefix)) {
            const object = storedObject(key);
            if (object) objects.push(object);
          }
        }
      }
    };
    walk(objectDirectory);
    objects.sort((a, b) => a.key.localeCompare(b.key));
    const start = options.cursor ? Number(options.cursor) || 0 : 0;
    const limit = Math.max(1, Math.min(options.limit || 1000, 1000));
    const page = objects.slice(start, start + limit).map(objectDescriptor);
    const next = start + page.length;
    return {
      objects: page,
      truncated: next < objects.length,
      cursor: next < objects.length ? String(next) : undefined,
    };
  }
}

export const env = {
  DB:
    databaseProvider === "postgres"
      ? createPostgresD1Database(projectRoot)
      : new LocalD1Database(databasePath),
  BACKUPS: new LocalR2Bucket(),
  VEREINSKASSE_RUNTIME: "raspberry",
  VEREINSKASSE_DATABASE_PROVIDER: databaseProvider,
  VEREINSKASSE_DATABASE_PATH: databasePath,
  VEREINSKASSE_BACKUP_DIR: objectDirectory,
};
