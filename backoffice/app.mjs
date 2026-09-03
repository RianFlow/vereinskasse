import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { createHash } from 'node:crypto';
import { assert, audit, billingMonth, currentMonth, HttpError, mayWrite, transaction } from './security.mjs';
import { buildCashManagerReport } from '../app/monthly-cash-manager-report.ts';
import { recipientService, selectRecipients } from './recipients.mjs';
import { emailChangeService } from './email-change.mjs';

const AUTH_PATHS = new Set([
  'GET /get-session', 'GET /list-sessions', 'POST /sign-in/email', 'POST /sign-out',
  'POST /request-password-reset', 'POST /reset-password', 'POST /change-password',
  'POST /revoke-session', 'POST /revoke-sessions', 'POST /revoke-other-sessions',
  'POST /two-factor/enable', 'POST /two-factor/verify-totp', 'POST /two-factor/verify-backup-code',
  'POST /two-factor/generate-backup-codes',
]);

export function createApp({ auth, provisioningAuth, accounts, data, pool, config, limiter, outbox,
  peerAddress = () => '127.0.0.1', staticRoot = './dist', recipients = recipientService(pool,config) }) {
  const app = new Hono();
  const emailChanges=emailChangeService({auth,limiter,pool,config});
  app.use('*', async (c, next) => {
    c.header('Cache-Control','no-store');
    c.header('X-Content-Type-Options','nosniff');
    c.header('Referrer-Policy','no-referrer');
    c.header('X-Frame-Options','DENY');
    c.header('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), bluetooth=()');
    c.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
    if (!config.development) c.header('Strict-Transport-Security','max-age=31536000');
    if (['POST','PUT','PATCH','DELETE'].includes(c.req.method)) {
      assert(c.req.header('origin') === config.origin,403,'Die Anfrage stammt nicht von der Verwaltungsseite.');
      assert(c.req.header('content-type')?.split(';')[0] === 'application/json',415,'Bitte JSON senden.');
    }
    await next();
  });
  app.use('/api/*', bodyLimit({ maxSize: 32768, onError: c => c.json({ error:'Die Anfrage ist zu groß.' },413) }));
  app.get('/health', async c => { await pool.query('SELECT 1 FROM bo_grants LIMIT 1'); return c.json({ status:'ok', service:'clubiq-backoffice' }); });
  app.use('/api/*', async (c,next) => {
    // Deliberately use the real socket peer. Behind the local Cloudflare tunnel this is
    // a shared limit; no untrusted X-Forwarded-For / CF-Connecting-IP can bypass it.
    const peer = peerAddress(c);
    c.set('peer',peer);
    const rule = await limiter.consume(`api:${peer}`, { window:60, max:300 });
    if (!rule.allowed) { c.header('Retry-After',String(rule.retryAfter)); return c.json({ error:'Zu viele Anfragen. Bitte kurz warten.' },429); }
    await next();
  });
  app.all('/api/auth/*', async c => {
    const path = c.req.path.slice('/api/auth'.length);
    assert(AUTH_PATHS.has(`${c.req.method} ${path}`),404,'Diese Funktion ist nicht verfügbar.');
    const headers = new Headers(c.req.raw.headers);
    headers.set('x-clubiq-peer-ip',c.get('peer'));
    for (const header of ['x-forwarded-for','x-forwarded-host','x-forwarded-proto','cf-connecting-ip']) headers.delete(header);
    if (path === '/two-factor/enable') {
      const session = await auth.api.getSession({ headers });
      assert(session && !session.user.twoFactorEnabled,409,'Der zweite Faktor ist bereits eingerichtet. Für einen Gerätewechsel bitte die Wiederherstellung verwenden.');
    }
    let request = new Request(c.req.raw,{headers});
    if (c.req.method === 'POST') {
      const body = await request.clone().json();
      if (path === '/sign-in/email' || path === '/request-password-reset') {
        const rule = await limiter.consume(`account:${path}:${String(body.email || '').trim().toLowerCase()}`,
          { window:900,max:path === '/sign-in/email'?10:3 });
        if (!rule.allowed) { c.header('Retry-After',String(rule.retryAfter)); return c.json({ error:'Bitte vor einem weiteren Versuch etwas warten.' },429); }
      }
      if (path === '/change-password') body.revokeOtherSessions = true;
      if (path.startsWith('/two-factor/')) body.trustDevice = false;
      request = new Request(request,{body:JSON.stringify(body)});
    }
    const started = Date.now();
    const response = await auth.handler(request);
    if (path === '/request-password-reset') {
      // Mail is queued, never sent during this response. Pad the local DB work for unknown accounts too.
      await new Promise(resolve => setTimeout(resolve,Math.max(0,650-(Date.now()-started))));
    }
    return response;
  });
  async function identity(c, requireMfa = true) {
    // Background refresh must not keep an unattended administrative session alive.
    const session = await auth.api.getSession({ headers:c.req.raw.headers, query:{disableRefresh:c.req.method==='GET'&&c.req.header('X-ClubIQ-Background')==='1'} });
    assert(session && session.user.emailVerified,401,'Bitte neu anmelden.');
    assert(Date.now()-new Date(session.session.createdAt).getTime()<8*3600_000,401,'Bitte nach acht Stunden erneut anmelden.');
    const grant = await accounts.grant(session.user.id);
    assert(grant,403,'Dieser Zugang ist nicht freigeschaltet.');
    assert(!requireMfa || session.user.twoFactorEnabled,403,'Bitte zuerst die Zwei-Faktor-Anmeldung einrichten.');
    return { ...grant,name:session.user.name,email:session.user.email,requiresMfa:!session.user.twoFactorEnabled };
  }
  app.get('/api/me',async c => c.json({...await identity(c,false),preview:Boolean(config.preview)}));
  app.post('/api/account/email',async c=>c.json(await emailChanges.start(await identity(c),c.req.raw.headers,await c.req.json()),202));
  app.post('/api/account/email/confirm',async c=>c.json(await emailChanges.confirm(await identity(c),c.req.raw.headers,await c.req.json())));
  app.use('/api/manage/*', async (c,next) => { c.set('actor',await identity(c)); await next(); });
  const admin = c => { const actor=c.get('actor'); assert(actor.role==='admin',403,'Nur der Vorstand darf diese Einstellung ändern.'); return actor; };
  const writer = c => { const actor=c.get('actor'); assert(mayWrite(actor.role),403,'Dieser Zugang darf nur lesen.'); return actor; };
  app.get('/api/manage/members',async c => c.json({ members:await data.members() }));
  app.post('/api/manage/members',async c => c.json(await data.createMember(admin(c),await c.req.json()),201));
  app.patch('/api/manage/members/:id',async c => c.json(await data.saveMember(admin(c),c.req.param('id'),await c.req.json())));
  app.get('/api/manage/products',async c => c.json({ products:await data.products(c.get('actor').profileId) }));
  app.post('/api/manage/products',async c => c.json(await data.createProduct(admin(c),await c.req.json()),201));
  app.patch('/api/manage/products/:id',async c => {
    assert(/^\d{1,16}$/.test(c.req.param('id')),400,'Ungültiger Artikel.');
    return c.json(await data.saveProduct(admin(c),c.req.param('id'),await c.req.json()));
  });
  app.get('/api/manage/archive',async c => c.json({ archive:await data.archive(c.get('actor').profileId),currentMonth:currentMonth() }));
  app.get('/api/manage/reports/:month',async c => c.json(await data.report(c.get('actor').profileId,c.req.param('month'))));
  app.get('/api/manage/reports/:month/export',async c => {
    const actor=c.get('actor'), report=await data.report(actor.profileId,c.req.param('month'));
    const packet=buildCashManagerReport(actor.profileName,report.closure.statementNumber || 'VORLAEUFIG',report);
    const index=c.req.query('kind')==='items'?1:0, attachment=packet.attachments[index];
    c.header('Content-Type','text/csv; charset=utf-8');
    c.header('Content-Disposition',`attachment; filename="${attachment.filename}"`);
    return c.body(attachment.content);
  });
  app.get('/api/manage/reports/:month/print',async c => {
    const actor=c.get('actor'), report=await data.report(actor.profileId,c.req.param('month'));
    const packet=buildCashManagerReport(actor.profileName,report.closure.statementNumber || 'VORLAEUFIG',report);
    return c.html(packet.attachments[2].content);
  });
  app.post('/api/manage/reports/:month/send',async c => {
    const actor=writer(c),month=billingMonth(c.req.param('month'));
    const input=await c.req.json();
    assert(input.confirmed===true,400,'Bitte die Empfänger vor dem Versand bestätigen.');
    assert(/^[0-9a-f-]{36}$/i.test(input.idempotencyKey || ''),400,'Versandkennung fehlt. Bitte den Dialog neu öffnen.');
    const selected=selectRecipients(await recipients.list(actor),input.recipientIds);
    const rate=await limiter.consume(`report-mail:${actor.userId}`,{window:3600,max:10});
    assert(rate.allowed,429,'Bitte vor weiteren Abrechnungsmails warten.');
    const report=await data.report(actor.profileId,month);
    const packet=buildCashManagerReport(actor.profileName,report.closure.statementNumber || 'VORLAEUFIG',report);
    const fingerprint=createHash('sha256').update(JSON.stringify(['report-mail',actor.profileId,month,selected.map(r=>r.email).sort()])).digest('hex');
    const result=await transaction(pool,async db=>{
      const claim=await db.query('INSERT INTO bo_mutations(id,user_id,fingerprint) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[input.idempotencyKey,actor.userId,fingerprint]);
      if(!claim.rowCount){
        const {rows:[prior]}=await db.query('SELECT user_id,fingerprint FROM bo_mutations WHERE id=$1',[input.idempotencyKey]);
        assert(prior.user_id===actor.userId && prior.fingerprint===fingerprint,409,'Diese Versandkennung wurde bereits anders verwendet.');
        return {ok:true,duplicate:true,message:'Dieser Versandauftrag wurde bereits vorgemerkt.'};
      }
      for(const recipient of selected){
        const id=await outbox.enqueue({to:recipient.email,...packet,subject:`${report.closure.closed?'':'Vorläufig · '}${packet.subject}`},86400,db);
        await audit(db,actor,'REPORT_MAIL_QUEUED',id,{month,recipientEmail:recipient.email,recipientName:recipient.name});
      }
      return {ok:true,message:`Abrechnung für ${selected.length} Empfänger vorgemerkt: ${selected.map(r=>r.email).join(', ')}.`};
    });
    return c.json(result,202);
  });
  app.get('/api/manage/mail-recipients',async c=>{
    const actor=writer(c);
    return c.json({recipients:await recipients.list(actor),sender:config.smtp?.from || null,
      demo:Boolean(config.preview),configured:config.preview || Boolean(config.smtp?.host && config.smtp?.user && config.smtp?.from)});
  });
  app.patch('/api/manage/reports/:month/notes/:memberId',async c => c.json(await data.note(writer(c),c.req.param('month'),c.req.param('memberId'),await c.req.json())));
  app.get('/api/manage/entries/:memberId',async c => c.json({entries:await data.entries(c.get('actor').profileId,c.req.param('memberId'))}));
  app.post('/api/manage/entries',async c => c.json(await data.addEntry(writer(c),await c.req.json()),201));
  app.get('/api/manage/statistics',async c => c.json(await data.statistics(c.get('actor').profileId,{from:c.req.query('from'),to:c.req.query('to')})));
  app.get('/api/manage/accounts',async c => {
    const actor=admin(c);
    return c.json({accounts:(await pool.query(`SELECT u.id,u.name,u.email,u."twoFactorEnabled" AS mfa,u."emailVerified" AS verified,g.role,g.active
      FROM bo_grants g JOIN bo_user u ON u.id=g.user_id WHERE g.profile_id=$1 ORDER BY u.name`,[actor.profileId])).rows});
  });
  app.post('/api/manage/accounts',async c => c.json(await accounts.invite(admin(c),await c.req.json(),provisioningAuth),201));
  app.patch('/api/manage/accounts/:id',async c => c.json(await accounts.change(admin(c),c.req.param('id'),await c.req.json())));
  app.get('/api/manage/audit',async c => {
    const actor=admin(c);
    return c.json({events:(await pool.query('SELECT a.action,a.entity,a.details,a.created_at,u.name FROM bo_audit a LEFT JOIN bo_user u ON u.id=a.user_id WHERE a.profile_id=$1 ORDER BY a.created_at DESC LIMIT 100',[actor.profileId])).rows});
  });
  app.get('/api/manage/mail',async c => {
    const actor=writer(c);
    return c.json({jobs:(await pool.query(`SELECT o.id,o.state,o.attempts,o.created_at,o.finished_at,a.details->>'recipientEmail' AS recipient,a.details->>'month' AS month FROM bo_outbox o JOIN bo_audit a ON a.entity=o.id
      WHERE a.profile_id=$1 AND a.user_id=$2 AND a.action='REPORT_MAIL_QUEUED' ORDER BY o.created_at DESC LIMIT 20`,[actor.profileId,actor.userId])).rows});
  });
  app.notFound(c => c.json({error:'Diese Seite oder Funktion ist nicht verfügbar.'},404));
  app.onError((error,c) => {
    if (error instanceof HttpError) return c.json({error:error.message},error.status);
    if (error instanceof SyntaxError) return c.json({error:'Die Anfrage ist nicht lesbar.'},400);
    console.error('Verwaltungsanfrage fehlgeschlagen. Code:', /^[A-Z0-9_]{1,30}$/.test(error.code || '') ? error.code : 'INTERNAL');
    return c.json({error:'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut laden; falls der Fehler bleibt, den Dienst prüfen.'},500);
  });
  if (staticRoot) {
    app.get('/assets/*',serveStatic({root:staticRoot}));
    app.get('/brand/*',serveStatic({root:staticRoot}));
    app.get('/',serveStatic({path:`${staticRoot}/index.html`}));
  }
  return app;
}
