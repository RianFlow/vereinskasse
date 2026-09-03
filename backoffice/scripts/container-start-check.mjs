import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

assert.equal(process.getuid(), 1000, 'The application must run as node, not root.');
for (const name of ['backoffice_secret', 'backoffice_db_password', 'smtp_password']) {
  const source = `/run/secrets/${name}`, target = `/run/clubiq-backoffice/${name}`;
  assert.equal(statSync(source).uid, 0);
  assert.equal(statSync(source).mode & 0o777, 0o600);
  assert.throws(() => readFileSync(source), { code: 'EACCES' });
  assert.equal(statSync(target).uid, 1000);
  assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.equal(readFileSync(target, 'utf8'), 'disposable-test-fixture\n');
}
assert.equal(statSync('/run/clubiq-backoffice').mode & 0o777, 0o700);
assert.match(readFileSync('/proc/self/status', 'utf8'), /^CapEff:\s+0+$/m);
console.log('Restricted container entrypoint: private readable copies, unchanged source permissions, no root privileges.');
