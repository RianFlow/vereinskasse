// Run only against an isolated, disposable PostgreSQL cash register.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import pg from 'pg';
assert.equal(process.env.CLUBIQ_TABLET_QA,'20261017');
assert.equal(process.env.PGDATABASE,'tablet_qa_20261017');
const pool=new pg.Pool({host:process.env.PGHOST,database:process.env.PGDATABASE,user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||readFileSync('/run/secrets/qa_pgpass','utf8').trim()});
const base=process.env.CLUBIQ_QA_URL||'http://127.0.0.1:3000',profileId='qa-tablet',operatorId='qa-operator';
const query=(sql,args=[])=>pool.query(sql,args),scalar=async(sql,args=[])=>{const value=Object.values((await query(sql,args)).rows[0])[0];return typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)?Number(value):value};
const cents=n=>Math.round(Number(n)*100),balance=async id=>cents(await scalar('SELECT COALESCE(SUM(amount),0) FROM account_transactions WHERE profile_id=$1 AND member_id=$2',[profileId,id]));
const stateFile=process.env.CLUBIQ_QA_STATE||'/data/tablet-qa-state.json';
let cookies='',passed=0;
const check=name=>{passed++;console.log(`PASS ${name}`)};
async function request(path,body,method=body?'POST':'GET',cookie=cookies){const r=await fetch(`${base}${path}`,{method,headers:{host:'vereinskasse.local',cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={html:text}}return {status:r.status,data};}
const op=(action,values={})=>({action,id:randomUUID(),undoToken:randomUUID(),...values});
const perform=async body=>{const r=await request('/api/tablet',body);assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.data};
const getFund=async()=>{const r=await request('/api/tablet');assert.equal(r.status,200,JSON.stringify(r));return r.data.fund};
const undo=async body=>{const r=await request('/api/tablet',{action:'undo',operationId:body.id,undoToken:body.undoToken});assert.equal(r.status,200,JSON.stringify(r));return r};
const sale=(values={})=>op('sale',{total:8.5,cart:{1:2,3:1},priceMode:'non_member',method:'Mitgliedskonto',memberId:'qa-a',allocations:[{memberId:'qa-a',memberName:'QA Alice',amount:8.5,kind:'anteil'}],...values});
const fundSale=async(values={})=>{const f=await getFund();return sale({fundId:f.id,revision:f.revision,coverage:Math.min(8.5,(f.budget_cents-f.spent_cents-f.refunded_cents)/100),method:'Bar',allocations:[],tendered:0,...values})};
try {
 if(process.argv[2]==='old-image') {
   const saved=JSON.parse(readFileSync(stateFile,'utf8'));cookies=saved.cookies;
   assert.equal(Number(await scalar('SELECT COUNT(*) FROM sales WHERE profile_id=$1',[profileId])),saved.sales);
   const r=await request('/api/control',{action:'close',countedCash:saved.expectedCash/100});
   assert.equal(r.status,200,JSON.stringify(r));assert.equal(cents(r.data.expected),saved.expectedCash);assert.equal(cents(r.data.difference),0);
   check('Vorheriges Programm zählt neue Topfeinzahlungen, Verbrauch und Rückzahlungen korrekt');
 } else {
   const now=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString(),profileToken=randomUUID(),operatorToken=randomUUID();
   assert.equal(Number(await scalar("SELECT COUNT(*) FROM profiles WHERE id='qa-tablet'")),0,'Only an empty test fixture is allowed');
   await query('INSERT INTO profiles (id,name,short_name,color,pin_salt,pin_hash,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)',[profileId,'QA Tablet','QA','#21654f','test-only','test-only',now]);
   for(const [id,name,role] of [[operatorId,'QA Kassendienst','Vorstand+Kassenwart+Systemadmin'],['qa-a','QA Alice','Mitglied'],['qa-b','QA Bob','Mitglied'],['qa-c','QA Charlie','Mitglied']])await query('INSERT INTO members (id,name,role,code,initials,active) VALUES ($1,$2,$3,$4,$5,1)',[id,name,role,`NOLOGIN-${id}`,'QA']);
   await query('INSERT INTO profile_sessions (token,profile_id,expires_at,created_at) VALUES ($1,$2,$3,$4)',[profileToken,profileId,expires,now]);
   await query('INSERT INTO auth_sessions (token,member_id,role,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)',[operatorToken,operatorId,'Vorstand+Kassenwart+Systemadmin',expires,now]);
   cookies=`vereinskasse_profile_session=${profileToken}; vereinskasse_session=${operatorToken}`;
   for(const [id,name,price,memberPrice,category] of [[1,'QA Helles',3,2.5,'Getränke'],[3,'QA Cola',2.5,2,'Getränke'],[5,'QA Bratwurst',4,3.5,'Essen']])await query("INSERT INTO products (id,profile_id,name,price,member_price,included_items_json,is_offer,icon,category,color,updated_at) VALUES ($1,$2,$3,$4,$5,'[]',0,'beer',$6,'#21654f',$7)",[id,profileId,name,price,memberPrice,category,now]);
   await query("INSERT INTO guest_accounts (id,profile_id,name,type,active,created_at,updated_at) VALUES ('qa-guest',$1,'QA Gast','visitor',1,$2,$2)",[profileId,now]);
   assert.equal((await request('/api/tablet',sale(),'POST','')).status,401);check('Ohne Profil keine Buchung');
   assert.equal((await request('/api/tablet',sale())).status,409);assert.equal(await scalar('SELECT COUNT(*) FROM sales WHERE profile_id=$1',[profileId]),0);check('Geschlossene Kasse lehnt neue Buchungen ohne Nebenwirkung ab');
   const opened=await request('/api/control',{action:'open',openingCash:100});assert.equal(opened.status,200,JSON.stringify(opened));
   const shiftId=opened.data.shift.id;
   const normal=sale();await perform(normal);assert.equal(await balance('qa-a'),850);await undo(normal);assert.equal(await balance('qa-a'),0);check('Mitgliedsbuchung und Rücknahme');
   const priced=sale({priceMode:'member',total:7,allocations:[{memberId:'qa-a',memberName:'spoofed',amount:7,kind:'anteil'}]});await perform(priced);assert.equal(await balance('qa-a'),700);await undo(priced);check('Verbindliche Mitgliedspreise und Namen vom Server');
   assert.equal((await request('/api/tablet',sale({total:1}))).status,409);check('Veraltete Preise blockiert');
   const mixed=sale({allocations:[{memberId:'qa-a',memberName:'x',amount:4.25,kind:'anteil'},{memberId:'qa-guest',memberName:'x',amount:4.25,kind:'anteil'}]});await perform(mixed);assert.equal(await balance('qa-a'),425);assert.equal(await balance('qa-guest'),425);await undo(mixed);check('Mitglied und Gast teilen centgenau');
   const deposit=op('fund-create',{kind:'cash',sponsorId:'qa-b',label:'QA Geburtstag',amount:50,tendered:60});
   const concurrent=await Promise.all([perform(deposit),perform(deposit),perform(deposit)]);assert.equal(concurrent.filter(r=>!r.duplicate).length,1);assert.equal(cents(concurrent[0].changeDue),1000);
   let f=await getFund();assert.equal(f.budget_cents,5000);assert.equal(await balance(f.id),-5000);assert.equal(await balance('qa-b'),0);check('50 Euro vorbezahlt, 10 Euro Rückgeld, doppelte Klicks ohne Doppelzahlung');
   const foodAndDrinks=await fundSale({cart:{1:2,3:1,5:1},total:12.5,tendered:5});const consumed=await perform(foodAndDrinks);assert.equal(cents(consumed.coverage),850);assert.equal(cents(consumed.changeDue),100);f=await getFund();assert.equal(f.spent_cents,850);assert.equal(await balance(f.id),-4150);assert.equal(await balance('qa-b'),0);check('Nur Getränke aus dem Topf; Essen 4 Euro bar mit 1 Euro Rückgeld');
   const receipt=await request(`/api/receipt?id=${foodAndDrinks.id}`);assert.equal(receipt.status,200);assert.ok(receipt.data.html.includes('✓ Beleg rechnerisch vollständig'));assert.ok(receipt.data.html.includes('Baranteil:'));check('Mischbeleg enthält Getränketopf, Baranteil und Rückgeld');
   await undo(foodAndDrinks);f=await getFund();assert.equal(f.spent_cents,0);assert.equal(await balance(f.id),-5000);check('Rücknahme stellt Getränketopf und Baranteil wieder her');
   const stale=await fundSale();const pause=op('fund-pause',{fundId:f.id,revision:f.revision});await perform(pause);assert.equal((await request('/api/tablet',stale)).status,409);check('Veralteter Topfstand und pausierte Runde abgewiesen');
   await undo(pause);f=await getFund();assert.equal(f.state,'active');
   const close=op('fund-close',{fundId:f.id,revision:f.revision});const refunded=await perform(close);assert.equal(cents(refunded.refund),5000);assert.equal(await balance(f.id),0);assert.equal(await getFund(),null);check('Unverbrauchte 50 Euro zurückgezahlt, kein Mitglied belastet');
   const small=op('fund-create',{kind:'cash',sponsorId:'qa-b',amount:5,tendered:5});await perform(small);
   const partial=await fundSale({coverage:5,tendered:5});const part=await perform(partial);assert.equal(cents(part.changeDue),150);assert.equal(await getFund(),null);check('Restliches 5-Euro-Budget plus 3,50 Euro bar');
   await undo(partial);f=await getFund();assert.equal(f.budget_cents-f.spent_cents,500);check('Ausgeschöpfter Topf wird bei Rücknahme wieder nutzbar');
   const topup=op('fund-topup',{fundId:f.id,revision:f.revision,amount:5,tendered:10});assert.equal(cents((await perform(topup)).changeDue),500);await undo(topup);f=await getFund();assert.equal(f.budget_cents,500);check('Nachzahlung und Rücknahme ohne Doppelbelastung');
   await perform(op('fund-close',{fundId:f.id,revision:f.revision}));
   const once=op('fund-create',{kind:'once',sponsorId:'qa-b'});await perform(once);f=await getFund();
   const one=sale({fundId:f.id,revision:f.revision,coverage:8.5,method:'Bar',tendered:0,allocations:[]});await perform(one);assert.equal(await balance('qa-b'),850);assert.equal(await getFund(),null);await undo(one);assert.equal(await balance('qa-b'),0);check('Nächste gemeinsame Runde einmal auf Sponsor, rücknehmbar');
   f=await getFund();await perform(op('fund-close',{fundId:f.id,revision:f.revision}));
   const debt=sale();await perform(debt);
   const payment=op('payment',{memberId:'qa-a',amount:3,tendered:5});const paid=await perform(payment);assert.equal(cents(paid.changeDue),200);assert.equal(await balance('qa-a'),550);await undo(payment);assert.equal(await balance('qa-a'),850);check('Teilzahlung einer Rechnung und Rücknahme');
   const beforePayments=await scalar('SELECT COUNT(*) FROM payments WHERE profile_id=$1',[profileId]);
   // Force a constraint failure after the legacy payment handler has written its batch.
   const collision=op('payment',{memberId:'qa-a',amount:1,tendered:1});await query("INSERT INTO tablet_operations (id,profile_id,kind,request_hash,undo_hash,payload_json,result_json,created_at) VALUES ($1,'different-profile','test','x','x','{}','{}',$2)",[collision.id,now]);
   assert.equal((await request('/api/tablet',collision)).status,500);assert.equal(await balance('qa-a'),850);assert.equal(await scalar('SELECT COUNT(*) FROM payments WHERE profile_id=$1',[profileId]),beforePayments);check('Gesamter Vorgang wird bei späterem Speicherfehler atomar zurückgerollt');
   const pays=[op('payment',{memberId:'qa-a',amount:8.5,tendered:10}),op('payment',{memberId:'qa-a',amount:8.5,tendered:10})];
   const paidResults=await Promise.all(pays.map(body=>request('/api/tablet',body)));assert.deepEqual(paidResults.map(r=>r.status).sort(),[201,409]);assert.equal(await balance('qa-a'),0);check('Zwei Geräte können dieselbe Rechnung nicht doppelt auszahlen');
   const adminFund=op('fund-create',{kind:'cash',sponsorId:'qa-b',amount:5,tendered:5});await perform(adminFund);f=await getFund();
   const adminSale=sale({cart:{1:1},total:3,fundId:f.id,revision:f.revision,coverage:3,method:'Bar',tendered:0,allocations:[]});await perform(adminSale);f=await getFund();
   await perform(op('fund-close',{fundId:f.id,revision:f.revision}));
   const corrected=await request('/api/control',{action:'reverse',saleId:adminSale.id,reason:'QA nach beendetem Topf'});assert.equal(corrected.status,200,JSON.stringify(corrected));assert.equal(cents(corrected.data.cashRefunds[0].amount),300);assert.equal(await balance(f.id),0);check('Geschützte spätere Korrektur zahlt Guthaben eines beendeten Topfs korrekt aus');
   const expiring=op('fund-create',{kind:'cash',sponsorId:'qa-b',amount:50,tendered:50});await perform(expiring);f=await getFund();
   const racers=await Promise.all([fundSale(),fundSale()]);const raced=await Promise.all(racers.map(body=>request('/api/tablet',body)));assert.deepEqual(raced.map(r=>r.status).sort(),[201,409]);f=await getFund();assert.equal(f.spent_cents,850);check('Gleichzeitige Topfbuchungen verwenden keinen veralteten Restbetrag');
   assert.equal((await request('/api/tablet',{action:'undo',operationId:expiring.id,undoToken:randomUUID()})).status,403);
   await query('UPDATE tablet_operations SET created_at=$1 WHERE id=$2',[new Date(Date.now()-31000).toISOString(),expiring.id]);assert.equal((await request('/api/tablet',{action:'undo',operationId:expiring.id,undoToken:expiring.undoToken})).status,410);check('Rücknahme verlangt Schlüssel und endet nach 30 Sekunden');
   f=await getFund();const split=await fundSale({cart:{1:2,3:1,5:1},total:12.5,coverage:8.5,method:'Mitgliedskonto',allocations:[{memberId:'qa-a',memberName:'x',amount:1,kind:'anteil'},{memberId:'qa-guest',memberName:'x',amount:3,kind:'anteil'}]});await perform(split);assert.equal(await balance('qa-a'),100);assert.equal(await balance('qa-guest'),300);await undo(split);check('Getränketopf plus auf Mitglieder und Gäste verteilter Restbetrag');
   const fundState=await getFund();assert.equal(fundState.spent_cents,850);
   const guest=await request('/api/guests',{action:'create_club',name:'QA Besucherverein'});assert.equal(guest.status,200);const person=await request('/api/guests',{action:'create_person',clubId:guest.data.focusId,name:'QA Besucherin'});assert.equal(person.status,200);check('Verein und zugehörige Person anlegen');
   const monthly=await request(`/api/monthly?month=${now.slice(0,7)}`);assert.equal(monthly.status,200);assert.ok(!JSON.stringify(monthly.data).includes('Getränketopf · QA Geburtstag'));check('Interne Topfguthaben werden nicht als Mitgliedsrechnung ausgegeben');
   // 100 opening + 8.50 account settlement + 50 deposit. All other cash movements reversed.
   const expectedCash=15850;
   const sqlCash=await scalar("SELECT 100 + COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.profile_id=$1 AND s.method='Bar'),0) - COALESCE((SELECT SUM(r.amount) FROM reversals r JOIN sales s ON s.id=r.sale_id WHERE s.profile_id=$1 AND s.method='Bar'),0) + COALESCE((SELECT SUM(amount) FROM payments WHERE profile_id=$1 AND method='Bar' AND sale_id IS NULL),0)",[profileId]);
   assert.equal(cents(sqlCash),expectedCash);check('Barbestand stimmt nach Einzahlungen, Restzahlungen, Erstattungen und Stornos');
   writeFileSync(stateFile,JSON.stringify({cookies,passed,expectedCash,shiftId,sales:Number(await scalar('SELECT COUNT(*) FROM sales WHERE profile_id=$1',[profileId]))}),{mode:0o600});
   console.log(`TABLET_FINANCE_CHECKS_PASSED=${passed}`);
 }
} finally {await pool.end()}
