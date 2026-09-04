import test from 'node:test';
import assert from 'node:assert/strict';
import {apiRequest,isCloudflareAccessResponse} from '../src/api-client.mjs';
import {readFileSync} from 'node:fs';

function reply({status=200,type='application/json',url='https://verwaltung.clubiq.party/api/me',redirected=false,data={ok:true}}={}){
  return {status,ok:status>=200&&status<300,url,redirected,headers:new Headers({'content-type':type}),json:async()=>{
    if(!type.includes('json'))throw new SyntaxError('not json');
    return data;
  }};
}

test('requests identify browser subrequests so Cloudflare Access can return 401',async()=>{
  let options;
  const data=await apiRequest('/api/manage/members',{name:'Test'},'POST',undefined,async(_path,value)=>{options=value;return reply();});
  assert.deepEqual(data,{ok:true});
  assert.equal(options.headers['X-Requested-With'],'XMLHttpRequest');
  assert.equal(options.headers['Content-Type'],'application/json');
  assert.equal(options.credentials,'same-origin');
  const controller=new AbortController();
  await apiRequest('/api/me',undefined,'GET',controller.signal,async(_path,value)=>{options=value;return reply();});
  assert.equal(options.headers['X-ClubIQ-Background'],'1');
});

test('expired Cloudflare Access responses are distinct from the app session',async()=>{
  const expired=reply({status:401,type:'text/html'});
  assert.equal(isCloudflareAccessResponse(expired),true);
  await assert.rejects(()=>apiRequest('/api/me',undefined,'GET',undefined,async()=>expired),error=>error.kind==='cloudflare-access');
  await assert.rejects(()=>apiRequest('/api/me',undefined,'GET',undefined,async()=>reply({status:401,data:{code:'UNAUTHORIZED'}})),error=>error.kind==='session'&&error.status===401);
});

test('redirected Access login and broken origins do not masquerade as stale JSON',async()=>{
  const login=reply({type:'text/html',url:'https://team.cloudflareaccess.com/cdn-cgi/access/login',redirected:true});
  await assert.rejects(()=>apiRequest('/api/me',undefined,'GET',undefined,async()=>login),error=>error.kind==='cloudflare-access');
  await assert.rejects(()=>apiRequest('/api/me',undefined,'GET',undefined,async()=>reply({status:502,type:'text/html'})),error=>error.kind==='connection');
  await assert.rejects(()=>apiRequest('/api/me',undefined,'GET',undefined,async()=>{throw new TypeError('offline');}),error=>error.kind==='connection');
});

test('all live views preserve the dedicated Cloudflare Access state',()=>{
  const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  const statistics=readFileSync(new URL('../src/statistics.jsx',import.meta.url),'utf8');
  for(const source of [main,statistics])assert.match(source,/kind==='cloudflare-access'/);
  assert.match(main,/writeLocked=live\.state!=='online'/);
  assert.match(main,/Cloudflare-Anmeldung erneuern/);
});
