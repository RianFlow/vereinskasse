import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { loadConfig,connectDatabase } from './config.mjs';
import { createAuth } from './auth.mjs';
import { accountService } from './accounts.mjs';
import { dataService } from './data.mjs';
import { createOutbox } from './mailer.mjs';
import { rateStorage } from './security.mjs';
import { createApp } from './app.mjs';

const config=loadConfig(),pool=connectDatabase(config),outbox=createOutbox(pool,config),limiter=rateStorage(pool,config.secret);
let accounts;
const authDependencies={database:pool,config,outbox,limiter,
  activated:user=>accounts.activate(user),emailChanged:user=>accounts.emailChanged(user),canLogin:async id=>Boolean(await accounts.grant(id))};
const auth=createAuth(authDependencies),provisioningAuth=createAuth({...authDependencies,provisioning:true});
accounts=accountService(pool,auth);
await pool.query('SELECT 1 FROM bo_grants LIMIT 1');
const app=createApp({auth,provisioningAuth,accounts,data:dataService(pool),pool,config,limiter,outbox,
  peerAddress:c=>getConnInfo(c).remote.address || 'unknown'});
const server=serve({fetch:app.fetch,port:config.port,hostname:config.host},()=>console.log(`ClubIQ Verwaltung bereit auf Port ${config.port}.`));
let running=false;
const timer=setInterval(async()=>{
  if(running)return;
  running=true;
  try { await outbox.deliver(); await pool.query("DELETE FROM bo_limits WHERE reset_at<now()-interval '1 day'"); }
  catch { console.error('Verwaltungs-Maildienst: Datenbank oder Konfiguration prüfen.'); }
  finally { running=false; }
},3000);
async function shutdown(){clearInterval(timer);server.close();while(running)await new Promise(r=>setTimeout(r,100));await pool.end();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
