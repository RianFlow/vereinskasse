// Uses only a disposable local database, or the explicitly named Pi QA database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {randomBytes,randomInt,randomUUID,pbkdf2Sync} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
assert.equal(process.env.CLUBIQ_DEVICE_QA,'20261108','Explicit isolated-test flag required');
const postgres=process.env.CLUBIQ_DEVICE_QA_POSTGRES==='1';
if(postgres)assert.equal(process.env.PGDATABASE,'device_qa_20261108','Production databases are forbidden');
mkdirSync('work',{recursive:true});
const directory=postgres?null:mkdtempSync(resolve('work/device-test-'));
const port=4231,base=process.env.CLUBIQ_DEVICE_QA_URL||`http://127.0.0.1:${port}`;
const server=postgres?null:spawn(process.execPath,['raspberry/start-production.mjs'],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',VEREINSKASSE_RUNTIME:'raspberry',VEREINSKASSE_APP_DIR:process.cwd(),VEREINSKASSE_DATA_DIR:directory,VEREINSKASSE_DATABASE_PATH:join(directory,'qa.sqlite'),VEREINSKASSE_DATABASE_PROVIDER:'sqlite',DATABASE_URL:''}});
let logs='',pool,db,browser,passed=0;
server?.stdout.on('data',c=>logs+=c);server?.stderr.on('data',c=>logs+=c);
const check=(value,label)=>{assert.ok(value,label);passed++;console.log('PASS '+label)};
const query=async(sql,args=[])=>{if(pool){let index=0;return (await pool.query(sql.replace(/\?/g,()=>'$'+(++index)),args)).rows}const statement=db.prepare(sql);return /^SELECT\b/i.test(sql)?statement.all(...args):(statement.run(...args),[])};
const one=async(sql,args=[])=>(await query(sql,args))[0];
async function mirrorStatic(context){
 if(!process.env.CLUBIQ_DEVICE_QA_ASSETS)return;
 const assets=resolve(process.env.CLUBIQ_DEVICE_QA_ASSETS),publicFiles=resolve('public');
 const types={'.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='GET'||url.pathname.startsWith('/api/'))return route.continue();
  const root=url.pathname.startsWith('/_next/static/')?assets:publicFiles;
  let file;try{file=resolve(root,'.'+decodeURIComponent(url.pathname))}catch{return route.continue()}
  if(!file.startsWith(root+sep)||!existsSync(file)||!statSync(file).isFile())return route.continue();
  return route.fulfill({path:file,contentType:types[extname(file)]||'application/octet-stream'});
 });
}
const fresh=()=>({cookies:new Map()});
const cookie=c=>[...c.cookies].map(([k,v])=>k+'='+v).join('; ');
const token=c=>c.cookies.get('vereinskasse_profile_session');
async function request(c,method='GET',body,path='/api/profile-session'){
 const r=await fetch(base+path,{method,signal:AbortSignal.timeout(15000),headers:{origin:base,...(c?{cookie:cookie(c)}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const set=r.headers.getSetCookie();if(c)for(const line of set){const pair=line.split(';')[0],i=pair.indexOf('=');if(/Max-Age=0(?:;|$)/i.test(line))c.cookies.delete(pair.slice(0,i));else c.cookies.set(pair.slice(0,i),pair.slice(i+1))}
 return {status:r.status,data:await r.json(),set};
}
let pin=String(randomInt(100000,1000000));
const profileId='qa-device-a',otherId='qa-device-b',setupId='qa-device-setup',adminId='qa-device-admin';
const login=async(id=profileId,value=pin)=>{const c=fresh(),r=await request(c,'POST',{profileId:id,pin:value});assert.equal(r.status,200,'Fixture PIN login');return c};
try{
 if(server){let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/profiles',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}assert.ok(ready,'Isolated preview must start: '+logs.slice(-1200));db=new DatabaseSync(join(directory,'qa.sqlite'))}
 else{const {default:pg}=await import('pg');pool=new pg.Pool({password:process.env.PGPASSWORD||(process.env.PGPASSWORD_FILE?readFileSync(process.env.PGPASSWORD_FILE,'utf8').trim():undefined)})}
 if(postgres){let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/profiles',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}assert.ok(ready,'PostgreSQL test application must finish migration before fixtures')}
 assert.equal(Number((await one('SELECT COUNT(*) count FROM profiles WHERE id=?',[profileId])).count),0,'Fixture must be fresh');
 const now=new Date().toISOString(),salt=randomBytes(16).toString('hex'),hash=pbkdf2Sync(pin,salt,100000,32,'sha256').toString('hex');
 for(const [id,name,setup] of [[profileId,'QA Kassentablet',0],[otherId,'QA Zweite Sparte',0],[setupId,'QA Ersteinrichtung',1]])await query('INSERT INTO profiles (id,name,short_name,color,pin_salt,pin_hash,must_change_pin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,name,'QA','#21654f',salt,hash,setup,now,now]);
 await query('INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,?,?,?,1)',[adminId,'QA Verwaltung','Vorstand+Systemadmin','NOLOGIN-QA-ONLY','QA']);
 await query("INSERT INTO shifts (id,profile_id,opened_by,opened_by_name,opened_at,opening_cash,status) VALUES (?,?,?,?,?,100,'open')",[randomUUID(),profileId,adminId,'QA Verwaltung',now]);
 check((await request(null,'PUT',{rememberDevice:true})).status===401,'Anonymous browser cannot authorize itself');
 const malformed=fresh();malformed.cookies.set('vereinskasse_profile_session','%Q');check((await request(malformed)).status===401,'Malformed cookie is rejected without a server error');
 check((await request(fresh(),'POST',{profileId,rememberDevice:true})).status===400,'Remembering cannot bypass the PIN');
 const normal=await login(),normalBefore=await one('SELECT expires_at FROM profile_sessions WHERE token=?',[token(normal)]);
 check(Math.abs(Date.parse(normalBefore.expires_at)-Date.now()-43200000)<10000,'Normal login still expires after twelve hours');
 const remembered=await login(),foreign=await login(otherId),foreignBefore=await one('SELECT expires_at FROM profile_sessions WHERE token=?',[token(foreign)]);
 check((await request(remembered,'PUT',{})).status===400,'Remembering requires the explicit selection');
 const memberToken=randomUUID(),memberExpiry=new Date(Date.now()+43200000).toISOString();await query('INSERT INTO auth_sessions (token,member_id,role,expires_at,created_at) VALUES (?,?,?,?,?)',[memberToken,adminId,'Vorstand+Systemadmin',memberExpiry,now]);remembered.cookies.set('vereinskasse_session',memberToken);
 const saved=await request(remembered,'PUT',{rememberDevice:true,profileId:otherId,role:'Systemadmin'}),profileExpiry=await one('SELECT expires_at FROM profile_sessions WHERE token=?',[token(remembered)]);
 check(saved.status===200&&Math.abs(Date.parse(profileExpiry.expires_at)-Date.now()-365*86400000)<10000,'Current tablet receives a one-year profile session');
 check(saved.set.length===1&&/HttpOnly/.test(saved.set[0])&&/Secure/.test(saved.set[0])&&/SameSite=Strict/.test(saved.set[0])&&/Max-Age=31536000/.test(saved.set[0]),'Only the secure profile cookie is extended');
 check((await one('SELECT expires_at FROM auth_sessions WHERE token=?',[memberToken])).expires_at===memberExpiry,'Personal administrative session is not extended');
 check((await one('SELECT expires_at FROM profile_sessions WHERE token=?',[token(foreign)])).expires_at===foreignBefore.expires_at&&(await request(remembered)).data.profile.id===profileId,'Posted foreign profile and role cannot change scope');
 await query('UPDATE auth_sessions SET expires_at=? WHERE token=?',[new Date(Date.now()-1000).toISOString(),memberToken]);
 check((await request(remembered,'POST',{name:'Forbidden',pin:'123456'},'/api/profiles')).status===403,'Remembered tablet does not grant administrative rights');
 check((await request(remembered,'PATCH',{newPin:'123456'})).status===403,'Profile PIN changes still require personal authorization');
 await query('UPDATE profile_sessions SET expires_at=? WHERE token=?',[new Date(Date.now()-1000).toISOString(),token(normal)]);
 check((await request(normal)).status===401&&(await request(remembered)).status===200,'Expired normal login is rejected while remembered access continues');
 await query('UPDATE profiles SET active=0 WHERE id=?',[profileId]);check((await request(remembered)).status===401&&(await request(remembered,'PUT',{rememberDevice:true})).status===401,'Inactive profiles cannot use or renew remembered access');await query('UPDATE profiles SET active=1 WHERE id=?',[profileId]);
 const replay=fresh();replay.cookies=new Map(remembered.cookies);check((await request(remembered,'DELETE')).status===200&&(await request(replay)).status===401,'Signing out also revokes the saved token on the server');
 check((await request(foreign)).status===200,'Signing out one tablet leaves other profiles signed in');
 const current=await login(),oldDevice=await login();await request(oldDevice,'PUT',{rememberDevice:true});
 await query('UPDATE auth_sessions SET expires_at=? WHERE token=?',[memberExpiry,memberToken]);current.cookies.set('vereinskasse_session',memberToken);
 const nextPin=String(randomInt(100000,1000000));check((await request(current,'PATCH',{newPin:nextPin})).status===200,'Authorized profile PIN can be changed');pin=nextPin;
 check((await request(current)).status===200&&(await request(oldDevice)).status===401&&(await request(foreign)).status===200,'PIN change revokes other tablets for this profile, retaining current/foreign access');
 // The setup profile retains the original fixture PIN; give it a fresh known
 // value through the isolated fixture rather than depending on a bootstrap PIN.
 const setupPin=String(randomInt(100000,1000000)),setupSalt=randomBytes(16).toString('hex');await query('UPDATE profiles SET pin_salt=?,pin_hash=?,failed_attempts=0,locked_until=NULL WHERE id=?',[setupSalt,pbkdf2Sync(setupPin,setupSalt,100000,32,'sha256').toString('hex'),setupId]);
 const firstSetup=await login(setupId,setupPin);check((await request(firstSetup,'PUT',{rememberDevice:true})).status===409,'Initial setup must choose its own PIN before remembering');
 check((await request(firstSetup,'PATCH',{newPin:setupPin})).status===200&&(await request(firstSetup,'PUT',{rememberDevice:true})).status===200,'First-setup PIN change can then authorize this tablet');
 check((await request(fresh(),'DELETE')).status===200,'Signing out is safe when no profile is selected');
 if(process.env.CLUBIQ_DEVICE_QA_BROWSER==='1'){
  const browserBase=base.replace('127.0.0.1','localhost');
  const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true,channel:'msedge'});
  let context=await browser.newContext({viewport:{width:1024,height:600},hasTouch:true}),page;await mirrorStatic(context);page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('barver-cash-layout','tablet'));
  await page.goto(browserBase,{waitUntil:'commit',timeout:60000});await page.getByRole('checkbox',{name:/Dieses Tablet merken/}).check();await page.getByRole('button',{name:'Mit Profil-PIN anmelden',exact:true}).click();
  check(await page.getByRole('checkbox',{name:/Dieses Tablet merken/}).isChecked(),'Remember choice survives switching from chip to PIN login');
  await page.locator('.profile-choices>button').filter({hasText:'QA Kassentablet'}).click();await page.getByLabel('6-stellige Profil-PIN',{exact:true}).fill(pin);await page.screenshot({path:resolve('../../outputs/Kasse-Tablet-merken.png'),fullPage:true});await page.getByRole('button',{name:'QA öffnen',exact:true}).click();await Promise.race([page.locator('main.app').waitFor({timeout:30000}),page.locator('.profile-error').waitFor({timeout:30000}).then(async()=>{throw new Error('Browser login: '+await page.locator('.profile-error').textContent())})]);
  const state=await context.storageState();check(state.cookies.some(c=>c.name==='vereinskasse_profile_session'&&c.expires>Date.now()/1000+300*86400),'Browser stores the remembered login beyond twelve hours');await context.close();
  context=await browser.newContext({viewport:{width:1024,height:600},storageState:state});await mirrorStatic(context);page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('barver-cash-layout','tablet'));await page.goto(browserBase,{waitUntil:'commit',timeout:60000});await page.locator('main.app').waitFor({timeout:60000});check(await page.locator('.profile-gate').count()===0,'A restarted browser opens the cash register without a PIN prompt');
  if(await page.locator('.tc-shell').count()){await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.getByRole('button',{name:'Dieses Tablet merken',exact:true}).click();await page.locator('.tc-footer').getByText(/Tablet gemerkt/).waitFor();check(true,'Already signed-in tablet can enable remembering from its menu');await page.getByRole('button',{name:'Menü öffnen',exact:true}).click();await page.getByRole('button',{name:'Tablet abmelden',exact:true}).click()}else{assert.ok(!postgres,'PostgreSQL runtime must expose tablet controls');await page.locator('.profile-switch').click()}await page.getByRole('heading',{name:'Willkommen zurück',exact:true}).waitFor({timeout:60000});check(true,'Tablet sign-out returns to the profile gate');assert.deepEqual(errors,[]);
 }
 console.log('REMEMBERED_TABLET_CHECKS_PASSED='+passed);
}finally{
 if(browser)await browser.close();if(pool)await pool.end();if(db)db.close();if(server){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else server.kill('SIGTERM')}
}
