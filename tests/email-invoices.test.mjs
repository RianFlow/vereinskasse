import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("invoice email is restricted, finalized and audited",async()=>{
  const route=await read("app/api/email/route.ts");
  assert.match(route,/requireRole\(request,\["Kassenwart","Vorstand"\]\)/);
  assert.match(route,/monthly_closures/);
  assert.match(route,/Der Monat muss vor dem E-Mail-Versand festgeschrieben werden/);
  assert.match(route,/confirmation!=="RECHNUNG SENDEN"/);
  assert.match(route,/MONTHLY_INVOICE_EMAIL_SENT/);
  assert.match(route,/MONTHLY_INVOICE_EMAIL_FAILED/);
  assert.match(route,/gerade bereits versendet/);
  assert.doesNotMatch(route,/body\.(to|subject|html)/);
});

test("smtp credentials stay server-side and TLS is enforced",async()=>{
  const [smtp,compose,example,check]=await Promise.all([read("app/email-smtp.ts"),read("deploy/docker/compose.yaml"),read("deploy/docker/.env.example"),read("raspberry/smtp-check.mjs")]);
  assert.match(smtp,/requireTLS:config\.security==="starttls"/);
  assert.match(smtp,/minVersion:"TLSv1\.2"/);
  assert.match(smtp,/disableFileAccess:true/);
  assert.match(smtp,/disableUrlAccess:true/);
  assert.match(compose,/CLUBIQ_SMTP_PASSWORD_FILE: \/run\/secrets\/smtp_password/);
  assert.match(compose,/smtp_password:/);
  assert.doesNotMatch(example,/CLUBIQ_SMTP_PASSWORD=/);
  assert.match(check,/transport\.verify\(\)/);
  assert.doesNotMatch(check,/sendMail/);
});

test("member consent and invoice UI are explicit",async()=>{
  const [members,page,d1,postgres]=await Promise.all([read("app/api/members/route.ts"),read("app/page.tsx"),read("drizzle/0028_member_invoice_email.sql"),read("postgres/migrations/0006_member_invoice_email.sql")]);
  assert.match(members,/invoice_email_consent_at/);
  assert.match(members,/invoiceEmailOptIn/);
  assert.match(page,/Monatsabrechnung per E-Mail erhalten/);
  assert.match(page,/Versand bestätigen/);
  assert.match(page,/Versand nur einzeln nach Bestätigung/);
  assert.match(d1,/invoice_email_consent_at/);
  assert.match(postgres,/invoice_email_consent_at/);
});

test("raspberry CLI configures and verifies SMTP without sending",async()=>{
  const [cli,install]=await Promise.all([read("deploy/docker/clubiq"),read("deploy/docker/install.sh")]);
  assert.match(cli,/email-einrichten\|email-setup/);
  assert.match(cli,/email-pruefen\|email-check/);
  assert.match(cli,/secrets\/smtp_password/);
  assert.match(cli,/node \/app\/raspberry\/smtp-check\.mjs/);
  assert.match(install,/secrets\/smtp_password/);
});
