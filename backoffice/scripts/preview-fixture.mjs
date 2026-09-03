// Loopback-only demo. No production config, PostgreSQL connection or SMTP transport.
import {serve} from '@hono/node-server';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fixture} from '../tests/auth-fixture.mjs';
import {assert,money,text} from '../security.mjs';
import {statisticsRange} from '../statistics.mjs';
import {demoData} from './demo-data.mjs';
if(process.env.NODE_ENV==='production')throw new Error('Local test fixture only.');
const directory=new URL('../../outputs/backoffice-preview/',import.meta.url);
mkdirSync(directory,{recursive:true});
const f=await fixture({databasePath:fileURLToPath(new URL('demo-auth.sqlite',directory)),preview:true});
f.db.exec('CREATE TABLE IF NOT EXISTS demo_state (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
function read(id,fallback){const row=f.db.prepare('SELECT value FROM demo_state WHERE id=?').get(id);return row?JSON.parse(row.value):fallback;}
function write(id,value){f.db.prepare('INSERT INTO demo_state(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,JSON.stringify(value));}

// Preserve demo identities by ID when their email changes; never reset the person's MFA.
async function seed(key,address,role,name){
  const saved=read(key,null),existing=saved?f.db.prepare('SELECT email FROM bo_user WHERE id=?').get(saved):null;
  const user=await f.user(existing?.email||address,role);write(key,user.id);
  if(name)f.db.prepare('UPDATE bo_user SET name=? WHERE id=?').run(name,user.id);
}
await seed('officer-id','officer@example.test','admin','Test Vorstand');
await seed('treasurer-id','kassenwart@example.test','treasurer','Lisa Test · Kassenwart');
await f.user('browserqa@example.test');
const demo=demoData({read,write});Object.assign(f.data,demo);

const products=read('products',[
  {id:1,name:'Beispielgetränk',category:'Getränke',price:2.5,member_price:2,updated_at:'demo-1'},
  {id:2,name:'Veterano · Beispiel',category:'Spirituosen',price:2,member_price:1.5,updated_at:'demo-2'},
  {id:3,name:'Kaffee · Beispiel',category:'Heißgetränke',price:1.5,member_price:null,updated_at:'demo-3'}]).filter(product=>!/^QA-Testartikel \d+(?: Live)?$/.test(product.name));
// Only disposable automated-test articles; preserve the person's example edits.
write('products',products);
const mutations=read('mutations',{}),events=read('events',[]),jobs=read('jobs',[]);
f.config.cashManagerRecipients=['kassenwart@example.test','vertretung@example.test'];
f.config.smtp={from:'ClubIQ Test <absender@example.test>'};
f.data.archive=async()=>[];
f.data.products=async()=>products;
f.data.createProduct=async(_actor,input)=>{
  const name=text(input.name,'Artikelname'),category=text(input.category,'Kategorie',60),price=money(input.price)/100,memberPrice=input.memberPrice===''?null:money(input.memberPrice)/100;
  if(mutations[input.idempotencyKey])return {ok:true,duplicate:true};
  assert(!products.some(p=>p.name.toLowerCase()===name.toLowerCase()),409,'Ein Artikel mit diesem Namen ist bereits vorhanden.');
  const product={id:Date.now(),name,category,price,member_price:memberPrice,updated_at:new Date().toISOString()};products.push(product);
  mutations[input.idempotencyKey]={user_id:_actor.userId,fingerprint:'demo-product'};write('products',products);write('mutations',mutations);
  return {ok:true,id:product.id,message:'Testartikel lokal gespeichert. Eure echte Kasse bleibt unverändert.'};
};
f.data.saveProduct=async(_actor,id,input)=>{
  const product=products.find(p=>String(p.id)===String(id));assert(product,404,'Testartikel nicht gefunden.');
  assert(product.updated_at===input.version,409,'Zwischenzeitlich geändert. Bitte neu laden.');
  Object.assign(product,{name:text(input.name,'Artikelname'),category:text(input.category,'Kategorie'),price:money(input.price)/100,member_price:input.memberPrice===''?null:money(input.memberPrice)/100,updated_at:new Date().toISOString()});
  write('products',products);return {ok:true,message:'Testpreis lokal gespeichert.'};
};
f.data.statistics=async(_profile,input)=>{
  const debts=demo.balances();
  const range=statisticsRange(input),months=range.months.map((month,index)=>({month,revenue:Math.round((120+index*36+(index%3)*72)*100)/100,sales:30+index*7,payments:80+index*25}));
  const revenue=months.reduce((s,m)=>s+m.revenue,0),sales=months.reduce((s,m)=>s+m.sales,0),payments=months.reduce((s,m)=>s+m.payments,0);
  const split=(names,weights,key)=>names.map((name,i)=>({name,[key]:Math.round(revenue*weights[i]*100)/100}));
  return {from:range.from,to:range.to,months,products:[{name:'Beispielgetränk',quantity:234},{name:'Veterano · Beispiel',quantity:168},{name:'Wasser · Beispiel',quantity:96},{name:'Kaffee · Beispiel',quantity:42}],
    categories:split(['Getränke','Spirituosen','Heißgetränke'],[.55,.35,.1],'revenue'),
    weekdays:split(['Mo','Di','Mi','Do','Fr','Sa','So'],[.02,.03,.05,.1,.35,.4,.05],'revenue').map((r,i)=>({...r,sales:[2,3,5,10,35,40,5][i]})),
    methods:split(['Vertrauensliste','Bar','Karte'],[.5,.35,.15],'revenue').map((r,i)=>({...r,sales:Math.round(sales*[.5,.35,.15][i])})),
    balances:debts.balances,
    summary:{revenue,sales,averageSale:revenue/sales,quantity:540,payments,outstanding:debts.outstanding,openAccounts:debts.openAccounts,credits:debts.credits},asOf:new Date().toISOString()};
};
// These queries simulate ONLY queue/audit metadata. No message is handed to SMTP.
f.pool.query=async(sql,params=[])=>{
  if(sql.startsWith('SELECT u.id') || sql.startsWith('SELECT u.name')){
    const rows=f.db.prepare('SELECT id,name,email,"twoFactorEnabled" AS mfa,"emailVerified" AS verified FROM bo_user').all()
      .map(user=>({...user,...f.grants.get(user.id)})).filter(user=>user.profileId===params[0]);
    return {rows:sql.startsWith('SELECT u.name')?rows.filter(user=>user.active&&user.verified&&['admin','treasurer'].includes(user.role)):rows};
  }
  if(sql.startsWith('INSERT INTO bo_mutations')){
    if(mutations[params[0]])return {rows:[],rowCount:0};mutations[params[0]]={user_id:params[1],fingerprint:params[2]};write('mutations',mutations);return {rows:[{id:params[0]}],rowCount:1};
  }
  if(sql.startsWith('SELECT user_id,fingerprint'))return {rows:[mutations[params[0]]]};
  if(sql.startsWith('INSERT INTO bo_audit')){const details=JSON.parse(params[5]);events.push({userId:params[1],profileId:params[2],action:params[3],entity:params[4],details,created_at:new Date().toISOString(),name:'Test Vorstand'});write('events',events);return {rows:[],rowCount:1};}
  if(sql.startsWith('SELECT o.id'))return {rows:jobs.filter(job=>events.some(e=>e.entity===job.id&&e.action==='REPORT_MAIL_QUEUED'&&e.profileId===params[0]&&e.userId===params[1])).map(job=>({id:job.id,state:job.state,recipient:job.recipient,created_at:job.created_at,attempts:job.attempts,month:events.find(e=>e.entity===job.id)?.details.month})).reverse()};
  if(sql.startsWith('SELECT a.action'))return {rows:[...events].reverse()};
  return {rows:[]};
};
f.outbox.enqueue=async(message)=>{
  const id=crypto.randomUUID(),match=message.text?.match(/#email-(current|new)=([^\s]+)/);
  let confirmation={};
  if(match){
    const token=decodeURIComponent(match[2]),{internalAdapter}=await f.auth.$context;
    const challenge=await internalAdapter.findVerificationValue(`bo-email-${match[1]}-${token}`);
    confirmation={ownerId:challenge?.value,url:`${f.config.origin}/#email-${match[1]}=${match[2]}`,stage:match[1],token};
  }
  jobs.push({id,state:'simulated',recipient:message.to,subject:message.subject,created_at:new Date().toISOString(),attempts:0,...confirmation});write('jobs',jobs);return id;
};
// Fixture-only mailbox: own MFA account only; never returned by the production server.
f.app.get('/api/demo/mailbox',async c=>{
  const session=await f.auth.api.getSession({headers:c.req.raw.headers});
  assert(session?.user.twoFactorEnabled && session.user.emailVerified && await f.accounts.grant(session.user.id),403,'Bitte mit deinem Testkonto und zweitem Faktor anmelden.');
  const {internalAdapter}=await f.auth.$context, messages=[];
  for(const job of jobs.filter(j=>j.ownerId===session.user.id).slice(-20).reverse()){
    const challenge=await internalAdapter.findVerificationValue(`bo-email-${job.stage}-${job.token}`);
    if(challenge?.value===session.user.id&&new Date(challenge.expiresAt).getTime()>Date.now())messages.push({id:job.id,recipient:job.recipient,subject:job.subject,url:job.url,created_at:job.created_at});
  }
  return c.json({messages});
});
serve({fetch:f.app.fetch,port:8092,hostname:'127.0.0.1'},()=>console.log('Lokaler Verwaltungstest bereit: nur Beispieldaten; kein echter Mailversand.'));
