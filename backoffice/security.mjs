import { createHmac, randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(condition, status, message) { if (!condition) throw new HttpError(status, message); }
export const roles = Object.freeze({ viewer: 'Lesen', treasurer: 'Kassenwart', admin: 'Vorstand' });
export const mayWrite = role => role === 'treasurer' || role === 'admin';
export function email(value) {
  assert(typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value), 400, 'Bitte eine vollständige E-Mail-Adresse angeben.');
  return value.trim().toLowerCase();
}
export function text(value, label, max = 120) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x08\x0b-\x1f]/.test(value), 400, `${label} fehlt oder ist zu lang.`);
  return value.trim();
}
export function billingMonth(value) {
  assert(typeof value === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value), 400, 'Ungültiger Abrechnungsmonat.');
  return value;
}
export function money(value, signed = false) {
  assert(typeof value === 'string' || typeof value === 'number', 400, 'Ungültiger Betrag.');
  const decimal = String(value).replace(',', '.');
  assert((signed ? /^-?\d{1,6}(\.\d{1,2})?$/ : /^\d{1,6}(\.\d{1,2})?$/).test(decimal), 400, 'Beträge bitte mit höchstens zwei Nachkommastellen eingeben.');
  return Math.round(Number(decimal) * 100);
}
export const currentMonth = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).format(new Date());
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const euro = value => Number(value || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    const v = String(value ?? '');
    return '"' + (/^[\s]*[=+@-]/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n');
}
export async function transaction(pool, action) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await action(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
export async function audit(db, actor, action, entity, details = {}) {
  await db.query('INSERT INTO bo_audit (id,user_id,profile_id,action,entity,details,created_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
    [randomUUID(), actor.userId || null, actor.profileId || null, action, entity, JSON.stringify(details)]);
}
export function rateStorage(pool, secret) {
  return { async consume(key, { window, max }) {
    const digest = createHmac('sha256', secret).update(key).digest('hex');
    // One atomic UPSERT: simultaneous requests cannot pass a stale counter.
    const { rows: [row] } = await pool.query(`INSERT INTO bo_limits (key,count,reset_at) VALUES ($1,1,now()+($2*interval '1 second'))
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN bo_limits.reset_at<=now() THEN 1 ELSE bo_limits.count+1 END,
      reset_at=CASE WHEN bo_limits.reset_at<=now() THEN now()+($2*interval '1 second') ELSE bo_limits.reset_at END
      RETURNING count, GREATEST(1,CEIL(EXTRACT(EPOCH FROM (reset_at-now())))) AS retry`, [digest, window]);
    return { allowed: Number(row.count) <= max, retryAfter: Number(row.count) > max ? Number(row.retry) : null };
  } };
}
