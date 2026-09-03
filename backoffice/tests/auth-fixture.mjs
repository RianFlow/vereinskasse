import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth,authOptions } from '../auth.mjs';
import { createApp } from '../app.mjs';
import { randomUUID } from 'node:crypto';

export const testPassword='Only for local tests! 123456';
export async function fixture({origin='http://127.0.0.1:5176',development=true,databasePath=':memory:',preview=false}={}){
  const db=new DatabaseSync(databasePath),mails=[],grants=new Map(),calls=[];
  const config={origin,secret:'local-test-only-0000000000000000000000000000000000000000000000000',development,preview};
  const outbox={enqueue:async message=>{const id=randomUUID();mails.push({...message,id,createdAt:new Date().toISOString()});return id;}};
  const limiter={consume:async()=>({allowed:true,retryAfter:null})};
  const dependencies={database:db,config,outbox,limiter,emailChanged:async user=>{
    db.prepare('DELETE FROM bo_session WHERE "userId"=?').run(user.id);
    db.prepare('DELETE FROM bo_verification WHERE value=?').run(user.id);
    calls.push('emailChanged');
  },canLogin:async id=>Boolean(grants.get(id)?.active),activated:async user=>{
    db.prepare('UPDATE bo_user SET "emailVerified"=1 WHERE id=?').run(user.id);
    db.prepare('DELETE FROM bo_verification WHERE value=?').run(user.id);
  }};
  const auth=createAuth(dependencies),provisioningAuth=createAuth({...dependencies,provisioning:true});
  await(await getMigrations(authOptions(dependencies))).runMigrations();
  const accounts={grant:async id=>{const g=grants.get(id);return g?.active?g:null;}};
  const data={members:async()=>{calls.push('members');return[];},saveMember:async()=>{calls.push('saveMember');return{ok:true};},products:async()=>[]};
  const pool={query:async()=>({rows:[]}),connect:async()=>({...pool,release(){}})};
  const app=createApp({auth,provisioningAuth,accounts,data,pool,config,limiter,outbox,staticRoot:null});
  const jars=new Map();
  async function request(path,body,{jar='default',method=body?'POST':'GET',headers={}}={}){
    if(!jars.has(jar))jars.set(jar,new Map());
    const cookies=jars.get(jar);
    const response=await app.request(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...headers},body:body?JSON.stringify(body):undefined}));
    for(const cookie of response.headers.getSetCookie()){
      const kv=cookie.split(';')[0],at=kv.indexOf('='),key=kv.slice(0,at),value=kv.slice(at+1);
      if(value)cookies.set(key,value);else cookies.delete(key);
    }
    return response;
  }
  async function user(email='officer@example.test',role='admin'){
    const existing=db.prepare('SELECT id,name,email FROM bo_user WHERE email=?').get(email);
    const result=existing?{user:existing}:await provisioningAuth.api.signUpEmail({body:{name:'Test Vorstand',email,password:testPassword}});
    grants.set(result.user.id,{userId:result.user.id,profileId:'darts',profileName:'Testverein',role,active:true});
    db.prepare('UPDATE bo_user SET "emailVerified"=1 WHERE id=?').run(result.user.id);
    return result.user;
  }
  return {db,auth,app,provisioningAuth,accounts,config,mails,grants,calls,user,request,jars,data,pool,outbox,close:()=>db.close()};
}
