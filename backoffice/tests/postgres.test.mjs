import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {getMigrations} from 'better-auth/db/migration';
import {postgresFixture} from './postgres-fixture.mjs';
import {dataService} from '../data.mjs';
import {accountService} from '../accounts.mjs';
import {authOptions,createAuth} from '../auth.mjs';
import {rateStorage,currentMonth} from '../security.mjs';
import {createOutbox,unseal} from '../mailer.mjs';
import {buildCashManagerReport} from '../../app/monthly-cash-manager-report.ts';
import {createApp} from '../app.mjs';
import {configuredRecipients,recipientService} from '../recipients.mjs';
import {statisticsRange} from '../statistics.mjs';
import {configurationClaim,configurationGuard} from '../../app/configuration-state.ts';
import {postgresSql} from '../../raspberry/postgres-sql.mjs';

test('PostgreSQL: migrations, least privilege, auth, snapshots, writes and backup compatibility',async t=>{
  const {pool,close}=await postgresFixture();
  try{
    const month=currentMonth(),stamp=`${month}-01T12:00:00.000Z`;
    for(const id of ['darts','other'])await pool.query("INSERT INTO public.profiles(id,name,short_name,pin_salt,pin_hash,created_at,updated_at) VALUES ($1,$1,$1,'test','test',$2,$2)",[id,stamp]);
    await pool.query("INSERT INTO public.members(id,name,role,code,initials,active) VALUES ('M-TEST','Alex Beispiel','Mitglied','NOLOGIN-TEST','AB',1)");
    await pool.query("INSERT INTO public.products(id,profile_id,name,price,member_price,icon,category,color,updated_at) VALUES (1,'darts','Getränk',2.5,2,'test','Getränke','green',$1),(2,'other','Anderer Verein',3,NULL,'test','Getränke','green',$1)",[stamp]);
    await pool.query("INSERT INTO public.account_transactions(id,profile_id,member_id,member_name,type,amount,note,operator_id,created_at) VALUES ('initial','darts','M-TEST','Alex Beispiel','Monatsabrechnung',12.5,'test','test',$1),('other','other','M-TEST','Alex Beispiel','Monatsabrechnung',999,'test','test',$1)",[stamp]);
    await pool.query("INSERT INTO public.sales(id,total,items,time,member,member_id,method,profile_id,cart_json) VALUES ('fixture-sale',12.5,5,$1,'Alex Beispiel','M-TEST','Vertrauensliste','darts','{}')",[stamp]);
    await pool.query("INSERT INTO public.sale_items(id,sale_id,product_id,product_name,quantity,unit_price,total) VALUES ('fixture-line','fixture-sale',1,'Getränk',5,2.5,12.5)");
    await pool.query("INSERT INTO public.sale_allocations(id,profile_id,sale_id,member_id,member_name,amount,kind) VALUES ('fixture-allocation','darts','fixture-sale','M-TEST','Alex Beispiel',12.5,'anteil')");
    await pool.query("UPDATE public.account_transactions SET sale_id='fixture-sale' WHERE id='initial'");
    const actor={userId:'test-admin',profileId:'darts',role:'admin',name:'Vorstand'},data=dataService(pool);
    await t.test('backup user can read new tables; app role cannot read POS secrets or write sales',async()=>{
      await pool.query('SET ROLE vereinskasse');assert.equal(Number((await pool.query('SELECT COUNT(*) FROM bo_user')).rows[0].count), 0);await pool.query('RESET ROLE');
      await pool.query('SET ROLE clubiq_backoffice');
      assert.equal((await pool.query("SELECT has_table_privilege('public.sales','INSERT') AS allowed")).rows[0].allowed,false);
      assert.equal((await pool.query("SELECT has_column_privilege('public.members','invoice_email','UPDATE') AS allowed")).rows[0].allowed,false);
      for(const sql of ['SELECT pin_hash FROM public.profiles','SELECT code FROM public.members','SELECT * FROM public.auth_sessions'])await assert.rejects(pool.query(sql),/permission denied/);
      await pool.query('RESET ROLE');
    });
    await t.test('generated auth tables match the pinned library',async()=>{
      const options=authOptions({database:pool,config:{origin:'https://clubiq.party',secret:'local-test-only-000000000000000000000000000000000000000000000000'},outbox:{enqueue:async()=>{}},limiter:rateStorage(pool,'test')});
      const pending=await getMigrations(options);assert.deepEqual(pending.toBeCreated,[]);assert.deepEqual(pending.toBeAdded,[]);assert.deepEqual(pending.toBeAddedIndexes,[]);
    });
    await t.test('invitation, activation and login use PostgreSQL; inactive access is revoked',async()=>{
      await pool.query('SET ROLE clubiq_backoffice');
      const config={origin:'http://127.0.0.1:5176',secret:'local-test-only-000000000000000000000000000000000000000000000000',development:true,smtp:{}};
      const outbox=createOutbox(pool,config),limiter=rateStorage(pool,config.secret);let accounts;
      const dependencies={database:pool,config,outbox,limiter,activated:user=>accounts.activate(user),emailChanged:user=>accounts.emailChanged(user),canLogin:async id=>Boolean(await accounts.grant(id))};
      const auth=createAuth(dependencies),provisioning=createAuth({...dependencies,provisioning:true});accounts=accountService(pool,auth);
      await accounts.invite({...actor,userId:null},{name:'Test Admin',email:'admin@example.test',role:'admin'},provisioning);
      const job=(await pool.query('SELECT * FROM bo_outbox LIMIT 1')).rows[0],message=unseal(job.payload,config.secret);
      const token=message.text.match(/#reset=([^\s]+)/)[1];
      await auth.api.resetPassword({body:{token,newPassword:'Test Admin Secret Long Phrase 123'}});
      const result=await auth.api.signInEmail({body:{email:'admin@example.test',password:'Test Admin Secret Long Phrase 123'}});
      assert.ok(result.user.emailVerified);assert.equal((await accounts.grant(result.user.id)).profileId,'darts');
      await pool.query('UPDATE bo_grants SET active=false WHERE user_id=$1',[result.user.id]);assert.equal(await accounts.grant(result.user.id),undefined);
      await pool.query('RESET ROLE');
    });
    await t.test('draft reports do not cross profile boundaries; empty reports and CSV are valid',async()=>{
      const report=await data.report('darts',month);assert.equal(report.summary.charges,12.5);assert.equal(report.people[0].closingBalance,12.5);
      assert.equal(report.items[0].productName,'Getränk');assert.equal(report.items[0].shared,false);
      const stats=await data.statistics('darts');assert.equal(Number(stats.months.find(row=>row.month===month).revenue),12.5);assert.equal(Number(stats.products[0].quantity),5);
      const empty=await data.report('darts','2020-01');assert.equal(empty.people.length,0);assert.ok(buildCashManagerReport('Verein','VORLAEUFIG',empty).attachments.length===3);
      const evil={...report,people:report.people.map(p=>({...p,memberName:'  =HYPERLINK("evil")'}))};
      assert.match(buildCashManagerReport('Verein','Test',evil).attachments[0].content,/"'  =HYPERLINK/);
    });
    await t.test('verified account email change uses PostgreSQL, updates recipients and revokes sessions',async()=>{
      await pool.query('SET ROLE clubiq_backoffice');
      const config={origin:'http://127.0.0.1:5176',secret:'local-test-only-000000000000000000000000000000000000000000000000',development:true,smtp:{}};
      const outbox=createOutbox(pool,config),limiter=rateStorage(pool,config.secret);let accounts;
      const dependencies={database:pool,config,outbox,limiter,emailChanged:user=>accounts.emailChanged(user),canLogin:async id=>Boolean(await accounts.grant(id))};
      const auth=createAuth(dependencies),provisioningAuth=createAuth({...dependencies,provisioning:true});accounts=accountService(pool,auth);
      const {user}=await provisioningAuth.api.signUpEmail({body:{name:'Email Test',email:'before@example.test',password:'Only a test long passphrase 123'}});
      await pool.query('INSERT INTO bo_grants(user_id,profile_id,role) VALUES ($1,$2,$3)',[user.id,'darts','treasurer']);
      await pool.query('UPDATE bo_user SET "emailVerified"=true WHERE id=$1',[user.id]);
      const login=await auth.api.signInEmail({body:{email:user.email,password:'Only a test long passphrase 123'},asResponse:true});
      const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
      await pool.query('UPDATE bo_user SET "twoFactorEnabled"=true WHERE id=$1',[user.id]);
      const app=createApp({auth,provisioningAuth,accounts,data,pool,config,limiter,outbox,staticRoot:null});
      const request=(path,body)=>app.request(new Request(config.origin+path,{method:'POST',headers:{origin:config.origin,'content-type':'application/json',cookie},body:JSON.stringify(body)}));
      assert.equal((await request('/api/account/email',{newEmail:'after@example.test',password:'Only a test long passphrase 123'})).status,202);
      async function token(stage){const jobs=(await pool.query("SELECT payload FROM bo_outbox WHERE payload IS NOT NULL ORDER BY created_at DESC")).rows;return jobs.map(j=>unseal(j.payload,config.secret).text.match(new RegExp(`#email-${stage}=([^\\s]+)`))?.[1]).find(Boolean);}
      assert.equal((await request('/api/account/email/confirm',{stage:'current',token:decodeURIComponent(await token('current'))})).status,200);
      assert.equal((await request('/api/account/email/confirm',{stage:'new',token:decodeURIComponent(await token('new'))})).status,200);
      assert.equal((await pool.query('SELECT email FROM bo_user WHERE id=$1',[user.id])).rows[0].email,'after@example.test');
      assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM bo_session WHERE "userId"=$1',[user.id])).rows[0].n),0);
      const recipients=await recipientService(pool,config).list({...actor,email:'officer@example.test'});
      assert.ok(recipients.some(r=>r.email==='after@example.test'));assert.ok(!recipients.some(r=>r.email==='before@example.test'));
      assert.ok((await pool.query("SELECT id FROM bo_audit WHERE action='EMAIL_CHANGED' AND user_id=$1 AND profile_id='darts'",[user.id])).rows.length);
      await pool.query('UPDATE bo_grants SET active=false WHERE user_id=$1',[user.id]);
      await pool.query('RESET ROLE');
    });
    await t.test('optimistic member and price updates preserve cash roles and unrelated products',async()=>{
      await pool.query("UPDATE public.members SET invoice_email='alex@example.test',invoice_email_consent_at=$1 WHERE id='M-TEST'",[stamp]);
      await pool.query('SET ROLE clubiq_backoffice');
      const member=(await data.members())[0];await data.saveMember(actor,member.id,{name:'Alex Neuername',version:member.version});
      await assert.rejects(data.saveMember(actor,member.id,{name:'Stale update',version:member.version}),/zwischenzeitlich/);
      const saved=(await data.members())[0];assert.equal(saved.invoice_email,'alex@example.test');assert.equal(saved.invoice_email_consent_at,stamp);
      await assert.rejects(data.saveMember(actor,member.id,{name:'Tamper',email:'',consent:false,version:saved.version}),/nicht bearbeitet/);
      const product=(await data.products('darts'))[0];await data.saveProduct(actor,product.id,{name:product.name,category:product.category,price:'3.50',memberPrice:'2.50',version:product.updated_at});
      await assert.rejects(data.saveProduct(actor,2,{name:'tamper',category:'bad',price:'1',memberPrice:'',version:stamp}),/nicht gefunden/);
      assert.equal(Number((await data.products('other'))[0].price),3);
      await pool.query('RESET ROLE');
    });
    await t.test('payments/corrections are atomic and idempotent; stale balances are rejected',async()=>{
      await pool.query('SET ROLE clubiq_backoffice');
      const input={kind:'payment',memberId:'M-TEST',amount:'2.50',reason:'Bankbeleg Test',referenceMonth:month,expectedBalance:12.5,idempotencyKey:randomUUID()};
      await data.addEntry(actor,input);assert.equal((await data.addEntry(actor,input)).duplicate,true);
      assert.equal((await data.report('darts',month)).people[0].closingBalance,10);
      await assert.rejects(data.addEntry(actor,{...input,idempotencyKey:randomUUID()}),/Kontostand hat sich/);
      await assert.rejects(data.addEntry(actor,{...input,amount:'5'}),/bereits anders/);
      await data.addEntry(actor,{...input,kind:'adjustment',amount:'-1.00',reason:'Nachvollziehbare Gutschrift',expectedBalance:10,idempotencyKey:randomUUID()});
      assert.equal((await data.report('darts',month)).people[0].closingBalance,9);
      await pool.query('RESET ROLE');
      assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM public.payments')).rows[0].count),1);
      assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM public.sales')).rows[0].count),1);
    });
    await t.test('create products uses safe IDs, scoped grants, validation and idempotency',async()=>{
      await pool.query('SET ROLE clubiq_backoffice');
      const input={name:'Neuer Testartikel',category:'Snacks',price:'4,00',memberPrice:'3.50',icon:'package',idempotencyKey:randomUUID(),profileId:'other'};
      const result=await data.createProduct(actor,input);
      assert.ok(Number.isSafeInteger(result.id));assert.ok(result.id>2**46);
      assert.equal((await data.createProduct(actor,input)).duplicate,true);
      const created=(await data.products('darts')).find(product=>String(product.id)===String(result.id));
      assert.equal(Number(created.price),4);assert.equal(Number(created.member_price),3.5);
      assert.equal((await data.products('other')).length,1);
      await assert.rejects(data.createProduct(actor,{...input,idempotencyKey:randomUUID()}),/bereits vorhanden/);
      await assert.rejects(data.createProduct(actor,{...input,name:'Andere Daten'}),/bereits anders/);
      for(const price of ['-1','NaN','1.234'])await assert.rejects(data.createProduct(actor,{...input,price,idempotencyKey:randomUUID()}),/Beträge/);
      await assert.rejects(data.createProduct(actor,{...input,icon:'<script>'}),/Artikelsymbol/);
      await pool.query('RESET ROLE');
    });
    await t.test('recipient selection, scoped roles and individually queued mail cannot be bypassed',async()=>{
      const config={origin:'https://clubiq.party',secret:'local-test-only-000000000000000000000000000000000000000000000000',cashManagerRecipients:configuredRecipients('Kasse <cash@example.test>, CASH@example.test'),smtp:{}};
      assert.deepEqual(config.cashManagerRecipients,['cash@example.test']);
      assert.throws(()=>configuredRecipients('cash@example.test\r\nBcc:evil@example.test'));
      for(const [id,profile,role,verified] of [['recipient','darts','treasurer',true],['outsider','other','admin',true],['viewer','darts','viewer',true],['unverified','darts','admin',false]]){
        await pool.query('INSERT INTO bo_user(id,name,email,"emailVerified") VALUES ($1,$1,$2,$3)',[id,`${id}@example.test`,verified]);
        await pool.query('INSERT INTO bo_grants(user_id,profile_id,role) VALUES ($1,$2,$3)',[id,profile,role]);
      }
      await pool.query('SET ROLE clubiq_backoffice');
      let role='admin';
      const identity={...actor,email:'officer@example.test',profileName:'Testverein'};
      const auth={api:{getSession:async()=>({user:{id:actor.userId,name:actor.name,email:identity.email,emailVerified:true,twoFactorEnabled:true},session:{createdAt:new Date().toISOString()}})}};
      const outbox=createOutbox(pool,config),recipients=recipientService(pool,config);
      const app=createApp({auth,accounts:{grant:async()=>({...identity,role})},data,pool,config,limiter:rateStorage(pool,config.secret),outbox,staticRoot:null});
      const request=(path,body)=>app.request(new Request(config.origin+path,{method:body?'POST':'GET',headers:{origin:config.origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
      const listed=await(await request('/api/manage/mail-recipients')).json();
      assert.deepEqual(listed.recipients.map(r=>r.email).sort(),['cash@example.test','officer@example.test','recipient@example.test']);
      const ids=listed.recipients.filter(r=>r.email!=='officer@example.test').map(r=>r.id);
      const payload={recipientIds:ids,idempotencyKey:randomUUID(),confirmed:true};
      const before=Number((await pool.query('SELECT count(*) FROM bo_outbox')).rows[0].count);
      assert.equal((await request(`/api/manage/reports/${month}/send`,{...payload,recipientIds:['someone@example.test']})).status,409);
      assert.equal((await request(`/api/manage/reports/${month}/send`,{...payload,recipientIds:[]})).status,400);
      assert.equal((await request(`/api/manage/reports/${month}/send`,payload)).status,202);
      assert.equal((await(await request(`/api/manage/reports/${month}/send`,payload)).json()).duplicate,true);
      const jobs=(await pool.query("SELECT o.* FROM bo_outbox o JOIN bo_audit a ON a.entity=o.id WHERE a.action='REPORT_MAIL_QUEUED'")).rows;
      assert.equal(jobs.length,2);assert.equal(Number((await pool.query('SELECT count(*) FROM bo_outbox')).rows[0].count),before+2);
      assert.deepEqual(jobs.map(j=>unseal(j.payload,config.secret).to).sort(),['cash@example.test','recipient@example.test']);
      assert.ok(jobs.every(j=>unseal(j.payload,config.secret).attachments.length===3));
      const history=await(await request('/api/manage/mail')).json();assert.ok(history.jobs.every(j=>j.recipient&&j.month===month));
      await pool.query("UPDATE bo_grants SET active=false WHERE user_id='recipient'");
      assert.equal((await request(`/api/manage/reports/${month}/send`,{...payload,idempotencyKey:randomUUID()})).status,409);
      assert.ok(!(await recipients.list(identity)).some(r=>r.email==='recipient@example.test'));
      role='viewer';assert.equal((await request('/api/manage/mail-recipients')).status,403);
      assert.equal((await request(`/api/manage/reports/${month}/send`,payload)).status,403);
      assert.equal((await request('/api/manage/products',{name:'Not allowed'})).status,403);
      role='treasurer';assert.equal((await request('/api/manage/products',{name:'Not allowed'})).status,403);
      await pool.query('RESET ROLE');
    });
    await t.test('frozen invoices stay unchanged; internal notes versioned; corruption rejected',async()=>{
      const snapshot={month:'2020-02',label:'Februar 2020',people:[{memberId:'M-TEST',memberName:'Historischer Name',closingBalance:7}],items:[],summary:{charges:7,payments:0,people:1}};
      const json=JSON.stringify(snapshot),checksum=createHash('sha256').update(json).digest('hex');
      await pool.query("INSERT INTO public.monthly_closures(id,profile_id,month,statement_number,snapshot_json,checksum,closed_by,closed_by_name,closed_at) VALUES ('closed','darts','2020-02','VK-TEST-202002',$1,$2,'test','Test',$3)",[json,checksum,stamp]);
      await pool.query('SET ROLE clubiq_backoffice');
      const before=await data.report('darts','2020-02');assert.equal(before.people[0].closingBalance,7);
      await data.note(actor,'2020-02','M-TEST',{note:'Rückfrage geklärt',version:0});
      await assert.rejects(data.note(actor,'2020-02','M-TEST',{note:'veraltet',version:0}),/zwischenzeitlich/);
      const after=await data.report('darts','2020-02');assert.deepEqual(after.people,before.people);assert.equal(after.notes[0].note,'Rückfrage geklärt');
      await assert.rejects(pool.query("UPDATE public.monthly_closures SET snapshot_json='{}' WHERE id='closed'"),/permission denied/);
      await pool.query('RESET ROLE');await pool.query("UPDATE public.monthly_closures SET snapshot_json='{}' WHERE id='closed'");
      await assert.rejects(data.report('darts','2020-02'),/Prüfsumme/);
    });
    await t.test('persistent rate limits cannot be bypassed by simultaneous requests',async()=>{
      const limiter=rateStorage(pool,'test-key'),key=randomUUID();
      const attempts=await Promise.all(Array.from({length:20},()=>limiter.consume(key,{window:60,max:5})));
      assert.equal(attempts.filter(a=>a.allowed).length,5);assert.ok(attempts.filter(a=>!a.allowed).every(a=>a.retryAfter>0));
    });
    await t.test('charts use bounded periods, zero months, scoped totals and separate debt/credits',async()=>{
      for(const input of [{from:'2026-10',to:'2026-09'},{from:'2020-01',to:'2026-01'},{from:'bad'}])assert.throws(()=>statisticsRange(input));
      const previous=new Date(`${month}-01T12:00:00.000Z`);previous.setUTCMonth(previous.getUTCMonth()-1);
      const priorStamp=previous.toISOString(),priorMonth=priorStamp.slice(0,7);
      for(const [id,profile,when,total] of [['old-sale','darts',priorStamp,5],['reversed-sale','darts',stamp,99],['foreign-sale','other',stamp,500]]){
        await pool.query("INSERT INTO public.sales(id,total,items,time,member,member_id,method,profile_id,cart_json) VALUES ($1,$2,1,$3,'Test','M-TEST','Bar',$4,'{}')",[id,total,when,profile]);
        await pool.query("INSERT INTO public.sale_items(id,sale_id,product_id,product_name,quantity,unit_price,total) VALUES ($1,$2,1,'Getränk',1,$3,$3)",[`${id}-line`,id,total]);
      }
      await pool.query("INSERT INTO public.reversals(id,sale_id,reason,amount,operator_id,operator_name,created_at) VALUES ('rev','reversed-sale','Test',99,'test','Test',$1)",[stamp]);
      await pool.query("INSERT INTO public.account_transactions(id,profile_id,member_id,member_name,type,amount,note,operator_id,created_at) VALUES ('credit','darts','M-CREDIT','Guthaben','Anpassung',-3,'test','test',$1)",[priorStamp]);
      await pool.query('SET ROLE clubiq_backoffice');
      const current=await data.statistics('darts',{from:month,to:month});
      assert.equal(current.months.length,1);assert.equal(current.summary.revenue,12.5);assert.equal(current.summary.sales,1);assert.equal(current.summary.averageSale,12.5);
      assert.equal(current.summary.payments,2.5);assert.equal(current.summary.outstanding,9);assert.equal(current.summary.credits,3);assert.equal(current.summary.openAccounts,1);
      assert.equal(current.summary.quantity,5);assert.equal(current.products[0].quantity,5);assert.equal(current.categories[0].revenue,12.5);
      assert.equal(current.weekdays.reduce((sum,row)=>sum+row.revenue,0),12.5);assert.equal(current.methods[0].revenue,12.5);
      const both=await data.statistics('darts',{from:priorMonth,to:month});assert.equal(both.summary.revenue,17.5);assert.equal(both.months.length,2);
      const empty=await data.statistics('darts',{from:'2020-01',to:'2020-03'});assert.equal(empty.months.length,3);assert.ok(empty.months.every(row=>row.revenue===0));assert.equal(empty.summary.averageSale,0);
      assert.equal(empty.summary.outstanding,9);assert.equal(empty.summary.credits,3);
      await pool.query('RESET ROLE');
    });
    await t.test('shared POS/backoffice catalogue revisions prevent stale replacements; committed entries are visible both ways',async()=>{
      const profile='live-test',liveActor={...actor,profileId:profile};
      await pool.query("INSERT INTO public.profiles(id,name,short_name,pin_salt,pin_hash,created_at,updated_at) VALUES ($1,$1,$1,'test','test',$2,$2)",[profile,stamp]);
      await pool.query("INSERT INTO public.members(id,name,role,code,initials,active) VALUES ('M-LIVE','Live Beispiel','Mitglied','NOLOGIN-LIVE','LB',1)");
      await pool.query('SET ROLE clubiq_backoffice');
      await data.createProduct(liveActor,{name:'Live Artikel',category:'Test',price:'4',memberPrice:'3',idempotencyKey:randomUUID()});
      const product=(await data.products(profile))[0];
      assert.equal(Number((await pool.query('SELECT revision FROM public.configuration_state WHERE profile_id=$1',[profile])).rows[0].revision),1);
      await data.saveProduct(liveActor,product.id,{...product,price:'5',memberPrice:'4',version:product.updated_at});
      await assert.rejects(data.saveProduct(liveActor,product.id,{...product,price:'1',memberPrice:'1',version:product.updated_at}),/zwischenzeitlich/);
      // The failed write must roll its revision back too.
      assert.equal(Number((await pool.query('SELECT revision FROM public.configuration_state WHERE profile_id=$1',[profile])).rows[0].revision),2);
      await pool.query('RESET ROLE');
      const adapter={prepare:sql=>({bind:(...values)=>({sql,values})})};
      async function cashWrite(revision,fail=false){
        const mutation=randomUUID(),claim=configurationClaim(adapter,profile,revision,mutation);
        await pool.query('BEGIN');
        try{
          const first=await pool.query(postgresSql(claim.sql),claim.values);
          await pool.query(postgresSql(`DELETE FROM products WHERE profile_id=? AND ${configurationGuard}`),[profile,profile,mutation]);
          await pool.query(postgresSql(`INSERT INTO products(id,profile_id,name,price,icon,category,color,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${configurationGuard}`),[9001,profile,'POS Artikel',6,'package','Test','green',stamp,profile,mutation]);
          if(fail)throw new Error('simulated batch failure');
          await pool.query('COMMIT');return first.rowCount;
        }catch(error){await pool.query('ROLLBACK');throw error;}
      }
      assert.equal(await cashWrite(1),0);assert.equal(Number((await data.products(profile))[0].price),5);
      await assert.rejects(cashWrite(2,true),/simulated/);assert.equal(Number((await data.products(profile))[0].price),5);
      assert.equal(await cashWrite(2),1);assert.equal((await data.products(profile))[0].name,'POS Artikel');
      assert.equal((await data.products('other'))[0].name,'Anderer Verein');
      await pool.query("INSERT INTO public.account_transactions(id,profile_id,member_id,member_name,type,amount,note,operator_id,created_at) VALUES ('live-charge',$1,'M-LIVE','Live Beispiel','Belastung',6,'POS Test','test',$2)",[profile,stamp]);
      await pool.query('SET ROLE clubiq_backoffice');
      assert.equal((await data.report(profile,month)).people.find(p=>p.memberId==='M-LIVE').closingBalance,6);
      await data.addEntry(liveActor,{kind:'payment',memberId:'M-LIVE',amount:'2',reason:'Nur Testdaten Bankbeleg',referenceMonth:month,expectedBalance:6,idempotencyKey:randomUUID()});
      await pool.query('RESET ROLE');
      assert.equal(Number((await pool.query("SELECT SUM(amount) balance FROM public.account_transactions WHERE profile_id=$1 AND member_id='M-LIVE'",[profile])).rows[0].balance),4);
    });
  }finally{await close();}
});
