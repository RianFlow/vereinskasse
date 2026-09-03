// Local build only, all API responses are synthetic. No production accounts.
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const directory=resolve('../outputs/access-qa');await mkdir(directory,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let accounts=[{id:'self',name:'Vorstand Beispiel',email:'vorstand@example.test',role:'admin',active:true,mfa:true,verified:true},{id:'other',name:'Kassenwart Beispiel',email:'kasse@example.test',role:'treasurer',active:true,mfa:true,verified:true}];
  let patched=false,deleted=false;
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    let json={};
    if(path==='/api/me')json={userId:'self',name:'Vorstand Beispiel',email:'vorstand@example.test',role:'admin',profileId:'darts',profileName:'Testverein',requiresMfa:false};
    else if(path==='/api/manage/accounts')json={accounts};
    else if(path==='/api/manage/accounts/other'&&request.method()==='PATCH'){
      const body=request.postDataJSON();assert.equal(body.role,undefined);accounts=accounts.map(a=>a.id==='other'?{...a,active:body.active}:a);patched=true;json={ok:true};
    }else if(path==='/api/manage/accounts/other'&&request.method()==='DELETE'){
      const body=request.postDataJSON();assert.equal(body.email,'kasse@example.test');assert.equal(body.confirmed,true);assert.equal(body.password,'Only a fake password');accounts=accounts.filter(a=>a.id!=='other');deleted=true;json={ok:true,message:'Verwaltungszugang gelöscht.'};
    }else if(path.includes('/reports/'))json={summary:{charges:0,payments:0},people:[],items:[],notes:[],balances:[],closure:{closed:false},label:'Testmonat'};
    else if(path.includes('/archive'))json={archive:[]};
    else if(path.includes('/audit'))json={events:[]};
    else if(path.includes('/members'))json={members:[]};
    else if(path.includes('/products'))json={products:[]};
    else if(path.includes('/mail'))json={jobs:[]};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
  });
  await page.goto('http://127.0.0.1:5180/');
  await page.getByRole('navigation').getByRole('button',{name:'Zugänge & Protokoll'}).click();
  await page.getByRole('heading',{name:'Verwaltungszugänge'}).waitFor();
  const self=page.getByRole('row').filter({hasText:'vorstand@example.test'});
  assert.equal(await self.getByRole('button').count(),0);
  await self.getByText(/Geschützt/).waitFor();
  await page.screenshot({path:resolve(directory,'accounts-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Sperren',exact:true}).click();
  await page.getByRole('button',{name:'Jetzt sperren',exact:true}).click();
  await page.getByRole('button',{name:'Wieder freigeben',exact:true}).waitFor();assert.ok(patched);
  await page.getByRole('button',{name:'Zugang löschen',exact:true}).click();
  await page.getByRole('dialog').getByText(/Mitglied, Rechnungen, Buchungen/).waitFor();
  await page.getByLabel('Zur Bestätigung die E-Mail-Adresse der Person eingeben').fill('kasse@example.test');
  await page.getByLabel('Dein eigenes aktuelles Passwort').fill('Only a fake password');
  await page.getByRole('checkbox').check();
  await page.screenshot({path:resolve(directory,'delete-confirmation.png'),fullPage:true});
  await page.getByRole('button',{name:'Zugang endgültig löschen',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Verwaltungszugang gelöscht'}).waitFor();assert.ok(deleted);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(directory,'accounts-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('Access UI: visible actions, own-account protection, block/delete confirmation, desktop/mobile passed.');
}finally {await browser.close();}
