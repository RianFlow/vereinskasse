import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { configuredRecipients } from './recipients.mjs';

export function loadConfig(env = process.env) {
  const development = env.BACKOFFICE_DEVELOPMENT === '1' && env.NODE_ENV !== 'production';
  if (!env.BACKOFFICE_ORIGIN) throw new Error('BACKOFFICE_ORIGIN muss ausdrücklich festgelegt werden.');
  const origin = new URL(env.BACKOFFICE_ORIGIN);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(development && origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('BACKOFFICE_ORIGIN muss eine feste HTTPS-Adresse ohne Pfad sein.');
  }
  const secret = readFileSync(env.BACKOFFICE_SECRET_FILE, 'utf8').trim();
  if (secret.length < 48) throw new Error('Der Verwaltungsschlüssel muss mindestens 48 zufällige Zeichen enthalten.');
  const password = readFileSync(env.BACKOFFICE_DB_PASSWORD_FILE, 'utf8').trim();
  if (!password) throw new Error('Datenbankkennwort fehlt.');
  return {
    development, origin: origin.origin, secret,
    port: Number(env.PORT || 8092), host: env.HOST || '127.0.0.1',
    cashManagerRecipients: configuredRecipients(env.CLUBIQ_SMTP_REPLY_TO || ''),
    database: { host: env.PGHOST || '127.0.0.1', port: Number(env.PGPORT || 5432),
      database: env.PGDATABASE || 'vereinskasse', user: env.BACKOFFICE_DB_USER || 'clubiq_backoffice', password,
      options: '-c search_path=backoffice,public', max: 6, connectionTimeoutMillis: 5000,
      statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 },
    smtp: { host: env.CLUBIQ_SMTP_HOST, port: Number(env.CLUBIQ_SMTP_PORT || 587),
      security: env.CLUBIQ_SMTP_SECURITY || 'starttls', user: env.CLUBIQ_SMTP_USER,
      passwordFile: env.CLUBIQ_SMTP_PASSWORD_FILE, from: env.CLUBIQ_SMTP_FROM },
  };
}

export const connectDatabase = config => new Pool(config.database);
