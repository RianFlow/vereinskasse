import test from 'node:test';
import assert from 'node:assert/strict';
import {createOTP} from '@better-auth/utils/otp';
import {fixture,testPassword} from './auth-fixture.mjs';

test('background polling does not refresh the session or bypass expiry',async()=>{
  const f=await fixture();try{
    const user=await f.user();await f.request('/api/auth/sign-in/email',{email:user.email,password:testPassword});
    f.db.prepare('UPDATE bo_user SET "twoFactorEnabled"=1 WHERE id=?').run(user.id);
    const expiry=new Date(Date.now()+20*60_000).toISOString();
    f.db.prepare('UPDATE bo_session SET "expiresAt"=? WHERE "userId"=?').run(expiry,user.id);
    assert.equal((await f.request('/api/manage/members',undefined,{headers:{'X-ClubIQ-Background':'1'}})).status,200);
    assert.equal(new Date(f.db.prepare('SELECT "expiresAt" FROM bo_session WHERE "userId"=?').get(user.id).expiresAt).getTime(),new Date(expiry).getTime());
    f.db.prepare('UPDATE bo_session SET "expiresAt"=? WHERE "userId"=?').run(new Date(Date.now()-1000).toISOString(),user.id);
    assert.equal((await f.request('/api/manage/members',undefined,{headers:{'X-ClubIQ-Background':'1'}})).status,401);
  }finally{f.close();}
});

test('no public registration, no POS endpoints, no CSRF, no unverified data access',async()=>{
  const f=await fixture();try{
    await f.user();
    assert.equal((await f.request('/api/auth/sign-up/email',{email:'evil@example.test',password:testPassword,name:'Evil'})).status,404);
    for(const path of ['/api/data','/api/control','/api/rfid/pair','/api/session'])assert.equal((await f.request(path,{})).status,404);
    assert.equal((await f.request('/api/auth/sign-in/email',{email:'officer@example.test',password:testPassword},{headers:{origin:'https://musik.clubiq.party'}})).status,403);
    assert.equal((await f.request('/api/auth/sign-in/email',{email:'officer@example.test',password:testPassword})).status,200);
    const me=await(await f.request('/api/me')).json();assert.equal(me.requiresMfa,true);
    assert.equal((await f.request('/api/manage/members')).status,403);
    assert.equal((await f.request('/api/manage/products',{name:'Not yet allowed'})).status,403);
    assert.equal((await f.request('/api/manage/mail-recipients')).status,403);
    assert.deepEqual(f.calls,[]);
    const hash=f.db.prepare('SELECT password FROM bo_account').get().password;
    assert.ok(hash&&!hash.includes(testPassword));
  }finally{f.close();}
});
test('MFA enrollment, mandatory second login step, reader denial and immediate revoked access',async()=>{
  const f=await fixture();try{
    const user=await f.user('reader@example.test','viewer');
    await f.request('/api/auth/sign-in/email',{email:user.email,password:testPassword});
    const enabled=await f.request('/api/auth/two-factor/enable',{password:testPassword});
    assert.equal(enabled.status,200);const setup=await enabled.json();
    assert.equal(setup.backupCodes.length,10);
    const secret=new URL(setup.totpURI).searchParams.get('secret');
    // The library's OTP generator takes the raw secret; decode the URI's RFC 4648 base32.
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const ch of secret.replaceAll('=',''))bits+=alphabet.indexOf(ch).toString(2).padStart(5,'0');
    const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
    const code=await createOTP(Buffer.from(bytes).toString()).totp();
    assert.equal((await f.request('/api/auth/two-factor/verify-totp',{code})).status,200);
    assert.equal((await f.request('/api/manage/members')).status,200);
    assert.equal((await f.request('/api/manage/members/m1',{name:'not allowed'},{method:'PATCH'})).status,403);
    assert.ok(!f.calls.includes('saveMember'));
    assert.equal((await f.request('/api/auth/two-factor/disable',{password:testPassword})).status,404);
    await f.request('/api/auth/sign-out',{});
    const login=await(await f.request('/api/auth/sign-in/email',{email:user.email,password:testPassword})).json();
    assert.equal(login.twoFactorRedirect,true);
    assert.equal((await f.request('/api/manage/members')).status,401);
    assert.equal((await f.request('/api/auth/two-factor/verify-backup-code',{code:setup.backupCodes[0]})).status,200);
    assert.equal((await f.request('/api/manage/members')).status,200);
    f.grants.get(user.id).active=false;
    assert.equal((await f.request('/api/manage/members')).status,403);
  }finally{f.close();}
});
test('password reset is generic, single use, hashed, expiring and revokes sessions',async()=>{
  const f=await fixture();try{
    await f.user();await f.request('/api/auth/sign-in/email',{email:'officer@example.test',password:testPassword});
    const known=await f.request('/api/auth/request-password-reset',{email:'officer@example.test'});
    const unknown=await f.request('/api/auth/request-password-reset',{email:'unknown@example.test'});
    assert.equal(known.status,200);assert.deepEqual(await known.json(),await unknown.json());
    assert.equal(f.mails.length,1);
    const token=f.mails[0].text.match(/#reset=([^\s]+)/)[1];
    assert.ok(!f.db.prepare('SELECT identifier FROM bo_verification').all().some(row=>row.identifier.includes(token)));
    const expires=new Date(f.db.prepare('SELECT "expiresAt" FROM bo_verification').get().expiresAt).getTime();
    assert.ok(expires-Date.now()<=900_000&&expires>Date.now());
    const reset=await f.request('/api/auth/reset-password',{token,newPassword:'A completely different passphrase 123'});
    assert.equal(reset.status,200);assert.equal((await f.request('/api/me')).status,401);
    assert.equal((await f.request('/api/auth/reset-password',{token,newPassword:testPassword})).status,400);
    assert.equal((await f.request('/api/auth/sign-in/email',{email:'officer@example.test',password:testPassword})).status,401);
    assert.equal((await f.request('/api/auth/sign-in/email',{email:'officer@example.test',password:'A completely different passphrase 123'})).status,200);
  }finally{f.close();}
});
test('production cookies are Secure, HttpOnly, host-only and strict; security headers on errors',async()=>{
  const f=await fixture({origin:'https://clubiq.party',development:false});try{
    await f.user();const response=await f.request('/api/auth/sign-in/email',{email:'officer@example.test',password:testPassword});
    assert.equal(response.status,200);
    const cookie=response.headers.getSetCookie().join(';');
    assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=Strict/i);assert.doesNotMatch(cookie,/Domain=/i);
    const error=await f.request('/api/manage/members');
    assert.equal(error.headers.get('cache-control'),'no-store');assert.equal(error.headers.get('referrer-policy'),'no-referrer');
    assert.match(error.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  }finally{f.close();}
});

test('email change requires password, MFA and both single-use mailbox confirmations; all sessions end',async()=>{
  const f=await fixture();try{
    const user=await f.user();await f.request('/api/auth/sign-in/email',{email:user.email,password:testPassword});
    assert.equal((await f.request('/api/account/email',{newEmail:'new@example.test',password:testPassword})).status,403);
    // This test focuses on email-change guards; real MFA enrollment/login is covered above.
    f.db.prepare('UPDATE bo_user SET "twoFactorEnabled"=1 WHERE id=?').run(user.id);
    for(const [path,body] of [['/api/auth/change-email',{newEmail:'bypass@example.test'}],['/api/auth/update-user',{email:'bypass@example.test'}]])assert.equal((await f.request(path,body)).status,404);
    assert.equal((await f.request('/api/auth/verify-email?token=untrusted')).status,404);
    assert.equal((await f.request('/api/demo/mailbox')).status,404);
    assert.equal((await f.request('/api/account/email',{newEmail:'new@example.test',password:'wrong'})).status,400);
    assert.equal(f.mails.length,0);
    await f.user('occupied@example.test');
    assert.equal((await f.request('/api/account/email',{newEmail:'occupied@example.test',password:testPassword})).status,202);
    assert.equal(f.mails.length,0,'occupied destination does not send confirmation');
    const response=await f.request('/api/account/email',{newEmail:'new@example.test',password:testPassword});
    assert.equal(response.status,202);assert.equal(f.mails.length,1);assert.equal(f.mails[0].to,user.email);
    const token=decodeURIComponent(f.mails[0].text.match(/#email-current=([^\s]+)/)[1]);
    assert.ok(!f.db.prepare('SELECT identifier FROM bo_verification').all().some(row=>row.identifier.includes(token)));
    const outsider=await f.user('outsider@example.test');await f.request('/api/auth/sign-in/email',{email:outsider.email,password:testPassword},{jar:'outsider'});
    f.db.prepare('UPDATE bo_user SET "twoFactorEnabled"=1 WHERE id=?').run(outsider.id);
    assert.equal((await f.request('/api/account/email/confirm',{stage:'current',token},{jar:'outsider'})).status,400);
    assert.equal((await f.request('/api/account/email/confirm',{stage:'new',token})).status,400,'cannot bypass the current-mailbox step');
    const results=await Promise.all([f.request('/api/account/email/confirm',{stage:'current',token}),f.request('/api/account/email/confirm',{stage:'current',token})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(f.mails.length,2);assert.equal(f.mails[1].to,'new@example.test');
    assert.equal((await(await f.request('/api/me')).json()).email,user.email);
    const finalToken=decodeURIComponent(f.mails[1].text.match(/#email-new=([^\s]+)/)[1]);
    const done=await f.request('/api/account/email/confirm',{stage:'new',token:finalToken});
    assert.equal(done.status,200);assert.equal((await done.json()).signInAgain,true);
    assert.equal((await f.request('/api/me')).status,401);
    const stored=f.db.prepare('SELECT email,"emailVerified","twoFactorEnabled" FROM bo_user WHERE id=?').get(user.id);
    assert.equal(stored.email,'new@example.test');assert.equal(stored.emailVerified,1);assert.equal(stored.twoFactorEnabled,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bo_session WHERE "userId"=?').get(user.id).count,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM bo_verification WHERE value=?').get(user.id).count,0);
    assert.equal((await f.request('/api/auth/sign-in/email',{email:user.email,password:testPassword})).status,401);
    const login=await f.request('/api/auth/sign-in/email',{email:'new@example.test',password:testPassword});
    assert.equal(login.status,200);assert.equal((await login.json()).twoFactorRedirect,true);
    assert.equal((await f.request('/api/me')).status,401,'email verification cannot bypass the next MFA login');
  }finally{f.close();}
});
test('email confirmation refuses expired tokens and revoked accounts',async()=>{
  const f=await fixture();try{
    const user=await f.user();await f.request('/api/auth/sign-in/email',{email:user.email,password:testPassword});
    f.db.prepare('UPDATE bo_user SET "twoFactorEnabled"=1 WHERE id=?').run(user.id);
    await f.request('/api/account/email',{newEmail:'new@example.test',password:testPassword});
    const token=decodeURIComponent(f.mails[0].text.match(/#email-current=([^\s]+)/)[1]);
    f.grants.get(user.id).active=false;
    assert.equal((await f.request('/api/account/email/confirm',{stage:'current',token})).status,403);
    f.grants.get(user.id).active=true;
    f.db.prepare('UPDATE bo_verification SET "expiresAt"=? WHERE value=?').run(new Date(Date.now()-60_000).toISOString(),user.id);
    assert.equal((await f.request('/api/account/email/confirm',{stage:'current',token})).status,400);
    assert.equal(f.mails.length,1);assert.equal((await(await f.request('/api/me')).json()).email,user.email);
  }finally{f.close();}
});
