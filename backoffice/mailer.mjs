import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';

export function seal(value, secret) {
  const iv = randomBytes(12), key = createHash('sha256').update(`clubiq-mail:${secret}`).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function unseal(value, secret) {
  const raw = Buffer.from(value, 'base64'), key = createHash('sha256').update(`clubiq-mail:${secret}`).digest();
  const cipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8'));
}
export function createOutbox(pool, config) {
  let transport;
  async function getTransport() {
    if (transport) return transport;
    const s = config.smtp;
    if (!s.host || !s.user || !s.from || !s.passwordFile || !['tls', 'starttls'].includes(s.security)) throw new Error('SMTP_NOT_CONFIGURED');
    transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.security === 'tls',
      requireTLS: s.security === 'starttls', tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      auth: { user: s.user, pass: (await readFile(s.passwordFile, 'utf8')).trim() },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 25000,
      disableFileAccess: true, disableUrlAccess: true });
    return transport;
  }
  return {
    async enqueue(message, lifetime = 86400, db = pool) {
      const id = randomUUID();
      await db.query(`INSERT INTO bo_outbox (id,payload,expires_at) VALUES ($1,$2,now()+($3*interval '1 second'))`,
        [id, seal(message, config.secret), lifetime]);
      return id;
    },
    async deliver() {
      // Dedicated worker claim. Payload is removed after delivery/expiry, not retained in logs.
      await pool.query("UPDATE bo_outbox SET state=CASE WHEN state='failed' THEN 'failed' ELSE 'expired' END,payload=NULL WHERE expires_at<=now() AND payload IS NOT NULL");
      const { rows: [job] } = await pool.query(`UPDATE bo_outbox SET state='sending',locked_at=now(),attempts=attempts+1
        WHERE id=(SELECT id FROM bo_outbox WHERE expires_at>now() AND attempts<5 AND
          ((state='pending' AND available_at<=now()) OR (state='sending' AND locked_at<now()-interval '2 minutes'))
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
      if (!job) return;
      try {
        const message = unseal(job.payload, config.secret);
        await (await getTransport()).sendMail({ ...message, from: config.smtp.from,
          messageId: `<${job.id}@${new URL(config.origin).hostname}>`, disableFileAccess: true, disableUrlAccess: true });
        await pool.query("UPDATE bo_outbox SET state='sent',payload=NULL,finished_at=now() WHERE id=$1", [job.id]);
      } catch {
        await pool.query("UPDATE bo_outbox SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,available_at=now()+interval '60 seconds' WHERE id=$1", [job.id]);
        console.warn('Verwaltungs-Mail noch nicht zugestellt; Status in der Verwaltung prüfen.');
      }
    },
  };
}
