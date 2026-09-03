// Developer-only reproducible SQL generator. Does not contact a database or write files.
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../auth.mjs';
const client = { query: async () => ({ rows: [] }), release() {}, on() {}, off() {} };
const database = { connect: async () => client, end: async () => {} };
const options = authOptions({ database, config: { origin: 'https://clubiq.party', secret: 'schema-only-not-for-use-in-production-00000000000000' },
  outbox: { enqueue: async () => {} }, limiter: { consume: async () => ({ allowed: true, retryAfter: null }) } });
const migration = await getMigrations(options);
console.log(await migration.compileMigrations());
