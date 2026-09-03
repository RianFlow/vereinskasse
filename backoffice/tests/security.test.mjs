import test from 'node:test';
import assert from 'node:assert/strict';
import {money,billingMonth,email,mayWrite,csv} from '../security.mjs';
import {seal,unseal} from '../mailer.mjs';
import {loadConfig} from '../config.mjs';
import {readFileSync} from 'node:fs';

test('deployment requires an explicit HTTPS origin and preserves the opted-in service',()=>{
  assert.throws(()=>loadConfig({}),/ausdrücklich/);
  for(const origin of ['http://verwaltung.clubiq.party','https://verwaltung.clubiq.party/path','https://user:pass@verwaltung.clubiq.party']){
    assert.throws(()=>loadConfig({BACKOFFICE_ORIGIN:origin}),/HTTPS-Adresse/);
  }
  const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const compose=read('../../deploy/docker/backoffice.compose.yaml');
  assert.match(compose,/BACKOFFICE_ORIGIN:\s*\$\{BACKOFFICE_ORIGIN:\?/);
  assert.match(compose,/127\.0\.0\.1:8092:8092/);
  const setup=read('../../deploy/docker/backoffice-setup.sh');
  assert.ok(setup.indexOf('config --quiet')<setup.indexOf('openssl rand'));
  assert.ok(setup.indexOf('http://127.0.0.1:8092/health')<setup.indexOf('touch .backoffice-enabled'));
  const manager=read('../../deploy/docker/clubiq');
  assert.match(manager,/if \[\[ -f "\$base\/\.backoffice-enabled" \]\]; then\s+compose\+=\(-f "\$base\/backoffice.compose.yaml"\)/);
  assert.equal((manager.match(/\n\s+stop_backoffice_for_database_change\n/g)||[]).length,2);
});
test('strict money, month and email validation',()=>{
  assert.equal(money('12,34'),1234);assert.equal(money('-1.05',true),-105);
  for(const v of ['1.001','NaN','1e4','-1',{},Infinity])assert.throws(()=>money(v));
  assert.throws(()=>billingMonth('2026-13'));assert.throws(()=>billingMonth("2026-01';DROP"));
  assert.equal(email('Name@Example.test'),'name@example.test');assert.throws(()=>email('x@example.test\r\nBcc:a@example.test'));
  assert.equal(mayWrite('viewer'),false);assert.equal(mayWrite('admin'),true);
  assert.match(csv([[' =HYPERLINK("bad")']]),/"' =HYPERLINK/);
});
test('queued messages are authenticated encrypted; corruption or other key rejected',()=>{
  const message={to:'officer@example.test',text:'reset=secret-token'},encrypted=seal(message,'secret-one');
  assert.ok(!encrypted.includes('secret-token'));assert.deepEqual(unseal(encrypted,'secret-one'),message);
  assert.throws(()=>unseal(encrypted,'secret-two'));
  const raw=Buffer.from(encrypted,'base64');raw[raw.length-1]^=1;assert.throws(()=>unseal(raw.toString('base64'),'secret-one'));
});
