// Starts its own disposable SQLite server, or uses only the named isolated Pi QA database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

assert.equal(process.env.CLUBIQ_LAYOUT_QA,'20261108','Explicit QA flag required');
const postgres=process.env.CLUBIQ_LAYOUT_QA_POSTGRES==='1';
if(postgres)assert.equal(process.env.PGDATABASE,'tablet_layout_qa_20261108','Production databases are forbidden');
mkdirSync('work',{recursive:true});
const directory=postgres?null:mkdtempSync(resolve('work/tablet-layout-qa-'));
const port=4241,base=process.env.CLUBIQ_LAYOUT_QA_URL||`http://127.0.0.1:${port}`;
const server=postgres?null:spawn(process.execPath,['raspberry/start-production.mjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',VEREINSKASSE_RUNTIME:'raspberry',VEREINSKASSE_APP_DIR:process.cwd(),VEREINSKASSE_DATA_DIR:directory,VEREINSKASSE_DATABASE_PATH:join(directory,'qa.sqlite'),VEREINSKASSE_DATABASE_PROVIDER:'sqlite',DATABASE_URL:'',PGHOST:'',PGDATABASE:''}});
let db,pool,logs='',passed=0;
server?.stdout.on('data',chunk=>logs+=chunk);server?.stderr.on('data',chunk=>logs+=chunk);
const query=async(sql,args=[])=>{if(pool){let index=0;return(await pool.query(sql.replace(/\?/g,()=>'$'+(++index)),args)).rows}const statement=db.prepare(sql);return /^SELECT\b/i.test(sql)?statement.all(...args):(statement.run(...args),[])};
const profile='qa-layout',other='qa-layout-other',alice='qa-layout-alice',bob='qa-layout-bob',guest='qa-layout-guest',foreign='qa-layout-foreign-guest',token=randomUUID();
const check=(condition,message)=>{assert.ok(condition,message);passed++;console.log('PASS '+message)};
async function api(id=alice,cookie=token){const response=await fetch(base+'/api/tablet/favorites'+(id===null?'':'?personId='+encodeURIComponent(id)),{headers:cookie?{cookie:'vereinskasse_profile_session='+cookie}:{},signal:AbortSignal.timeout(15000)});return{status:response.status,cache:response.headers.get('cache-control'),data:await response.json()}}
try{
 let ready=false;for(let attempt=0;attempt<100;attempt++){try{if((await fetch(base+'/api/profiles',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,250))}assert.ok(ready,'QA server did not start: '+logs.slice(-1000));
 if(postgres){const{default:pg}=await import('pg');pool=new pg.Pool({password:process.env.PGPASSWORD||(process.env.PGPASSWORD_FILE?readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim():undefined)})}else db=new DatabaseSync(join(directory,'qa.sqlite'));
 assert.equal(Number((await query('SELECT COUNT(*) count FROM profiles WHERE id=?',[profile]))[0].count),0,'QA fixtures must be fresh');
 const now=new Date().toISOString();
 for(const id of [profile,other])await query('INSERT INTO profiles (id,name,short_name,color,pin_salt,pin_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[id,id,'QA','#b99656','qa-only','qa-only',now,now]);
 for(const [id,name]of[[alice,'QA Alice'],[bob,'QA Bob']])await query('INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,?,?,?,1)',[id,name,'Mitglied','NOLOGIN-'+id,name.slice(3,5)]);
 await query('INSERT INTO profile_sessions (token,profile_id,expires_at,created_at) VALUES (?,?,?,?)',[token,profile,new Date(Date.now()+3600000).toISOString(),now]);
 for(const [id,owner]of[[guest,profile],[foreign,other]])await query("INSERT INTO guest_accounts (id,profile_id,name,type,active,created_at,updated_at) VALUES (?,?,?,'visitor',1,?,?)",[id,owner,'QA Gast',now,now]);
 async function fixture(id,{person=alice,profileId=profile,method='Mitgliedskonto',cart={1:1},allocations=[{id:alice,kind:'anteil',amount:3}],reversed=false,time='2026-01-01T12:00:00.000Z'}={}){
  await query('INSERT INTO sales (id,total,items,time,member,member_id,method,profile_id,cart_json) VALUES (?,3,1,?,?,?,?,?,?)',[id,time,'QA',person,method,profileId,JSON.stringify(cart)]);
  for(const[index,allocation]of allocations.entries())await query('INSERT INTO sale_allocations (id,profile_id,sale_id,member_id,member_name,amount,kind) VALUES (?,?,?,?,?,?,?)',[id+'-a'+index,profileId,id,allocation.id,'QA',allocation.amount,allocation.kind]);
  if(reversed)await query('INSERT INTO reversals (id,sale_id,reason,amount,operator_id,operator_name,created_at) VALUES (?,?,?,3,?,?,?)',[id+'-r',id,'QA',alice,'QA',now]);
 }
 await fixture('qa-layout-personal');await fixture('qa-layout-cash',{method:'Bar',cart:{2:2},allocations:[]});
 await fixture('qa-layout-split',{allocations:[{id:alice,kind:'anteil',amount:1.5},{id:bob,kind:'anteil',amount:1.5}]});
 await fixture('qa-layout-round',{allocations:[{id:alice,kind:'runde',amount:3}]});
 await fixture('qa-layout-reversed',{reversed:true});await fixture('qa-layout-other-sale',{profileId:other});
 await fixture('qa-layout-unrelated',{person:bob,allocations:[{id:bob,kind:'anteil',amount:3}]});
 await fixture('qa-layout-guest-sale',{person:'PROFILE-'+profile,allocations:[{id:guest,kind:'anteil',amount:3}]});
 await fixture('qa-layout-bundle',{cart:{7:1},time:'2026-01-02T12:00:00.000Z'});
 check((await api(alice,'')).status===401,'Favorite history requires an unlocked profile');
 check((await api(null)).status===400&&(await api('missing')).status===404,'Missing and unknown persons are rejected');
 check((await api(foreign)).status===404,'Guest accounts from another profile are not exposed');
 const found=await api();assert.equal(found.status,200);check(found.cache==='no-store','Personal purchase history is not cached');
 check(found.data.personId===alice&&found.data.orders.length===3,'Only individual purchases in the current profile are returned');
 check(found.data.orders.every(order=>!['qa-layout-split','qa-layout-round','qa-layout-reversed','qa-layout-other-sale','qa-layout-unrelated'].includes(order.id)),'Split bills, rounds, reversals and foreign purchases do not teach favorites');
 check(found.data.orders[0].id==='qa-layout-bundle'&&found.data.orders[0].cart['7']===1,'History retains the original sellable bundle');
 check((await api(guest)).data.orders.length===1,'An active guest can have an individual history');
 await query('UPDATE members SET active=0 WHERE id=?',[bob]);check((await api(bob)).status===404,'Inactive people have no history endpoint');
 for(let index=0;index<12;index++)await fixture('qa-layout-recent-'+String(index).padStart(2,'0'),{time:`2026-02-${String(index+1).padStart(2,'0')}T12:00:00.000Z`});
 const recent=await api();check(recent.data.orders.length===10&&recent.data.orders[0].id==='qa-layout-recent-11'&&recent.data.orders.at(-1).id==='qa-layout-recent-02','Only the ten most recent valid orders are used');
 await query('INSERT INTO profile_sessions (token,profile_id,expires_at,created_at) VALUES (?,?,?,?)',['qa-layout-expired',profile,'2000-01-01T00:00:00.000Z',now]);check((await api(alice,'qa-layout-expired')).status===401,'Expired sessions cannot read favorites');
 const before=Number((await query('SELECT COUNT(*) count FROM sales'))[0].count);await api();await api();check(Number((await query('SELECT COUNT(*) count FROM sales'))[0].count)===before,'Reading favorites never creates a purchase');
 console.log('TABLET_LAYOUT_API_CHECKS_PASSED='+passed);
}finally{if(pool)await pool.end();if(db)db.close();if(server){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else server.kill('SIGTERM')}}
