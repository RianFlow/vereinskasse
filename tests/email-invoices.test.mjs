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
  const [smtp,compose,example,check,entrypoint]=await Promise.all([read("app/email-smtp.ts"),read("deploy/docker/compose.yaml"),read("deploy/docker/.env.example"),read("raspberry/smtp-check.mjs"),read("deploy/docker/app-entrypoint.sh")]);
  assert.match(smtp,/requireTLS:config\.security==="starttls"/);
  assert.match(smtp,/minVersion:"TLSv1\.2"/);
  assert.match(smtp,/disableFileAccess:true/);
  assert.match(smtp,/disableUrlAccess:true/);
  assert.match(smtp,/validMailboxList/);
  assert.match(smtp,/replyTo&&!validMailboxList\(replyTo\)/);
  assert.match(compose,/CLUBIQ_SMTP_PASSWORD_FILE: \/run\/secrets\/smtp_password/);
  assert.match(compose,/smtp_password:/);
  assert.doesNotMatch(example,/CLUBIQ_SMTP_PASSWORD=/);
  assert.match(check,/transport\.verify\(\)/);
  assert.doesNotMatch(check,/sendMail/);
  assert.match(entrypoint,/stage_runtime_secret CLUBIQ_SMTP_PASSWORD_FILE smtp_password/);
  assert.match(entrypoint,/stage_runtime_secret CLUBIQ_MONTHLY_MAIL_TOKEN_FILE monthly_mail_token/);
  assert.match(entrypoint,/install -d -o root -g node -m 0710/);
  assert.match(entrypoint,/rm -f "\$target"/);
  assert.match(entrypoint,/install -m 0400 "\$source" "\$target"/);
  assert.match(entrypoint,/chown node:node "\$target"/);
});

test("Test-E-Mail wird auch ohne Buchungen wirklich versendet",async()=>{
  const [route,page,maintenance,sender]=await Promise.all([read("app/api/email/route.ts"),read("app/page.tsx"),read("deploy/maintenance/server.py"),read("raspberry/smtp-test-send.mjs")]);
  assert.match(route,/action==="send_test"/);
  assert.match(route,/SMTP_TEST_EMAIL_SENT/);
  assert.match(route,/keine Abrechnungs- oder Mitgliederdaten/);
  assert.match(page,/Test-E-Mail senden/);
  assert.match(page,/action:"send_test"/);
  assert.match(maintenance,/smtp-test-send\.mjs/);
  assert.match(maintenance,/Test-E-Mail senden/);
  assert.match(sender,/sendMail/);
  assert.match(sender,/NO_CASH_MANAGER_RECIPIENTS/);
  assert.match(sender,/keine Abrechnungs- oder Mitgliederdaten/);
  assert.match(sender,/for\(const recipient of recipients\)/);
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
  const [cli,install,ci,container]=await Promise.all([read("deploy/docker/clubiq"),read("deploy/docker/install.sh"),read(".github/workflows/ci.yml"),read(".github/workflows/container.yml")]);
  assert.match(cli,/email-einrichten\|email-setup/);
  assert.match(cli,/email-pruefen\|email-check/);
  assert.match(cli,/secrets\/smtp_password/);
  assert.match(cli,/node \/app\/raspberry\/smtp-check\.mjs/);
  assert.match(install,/secrets\/smtp_password/);
  assert.match(ci,/touch deploy\/docker\/secrets\/smtp_password/);
  assert.match(container,/: > secrets\/smtp_password/);
});

test("Kassenwarte erhalten einen abgeschlossenen, bearbeitbaren Monatsbericht",async()=>{
  const [route,sender,report,smtp]=await Promise.all([
    read("app/api/email/route.ts"),
    read("app/monthly-cash-manager-email.ts"),
    read("app/monthly-cash-manager-report.ts"),
    read("app/email-smtp.ts")
  ]);
  assert.match(route,/send_cash_manager_summary/);
  assert.match(route,/MONATSABSCHLUSS SENDEN/);
  assert.match(sender,/FROM monthly_closures WHERE profile_id=\? AND month=\?/);
  assert.match(sender,/MONTHLY_CASH_MANAGER_EMAIL_SENT/);
  assert.match(sender,/MONTHLY_CASH_MANAGER_EMAIL_FAILED/);
  assert.match(sender,/input\.mode==="automatic"&&lastSentAt/);
  assert.match(sender,/for\(const recipient of recipients\)/,"Kassenwarte müssen aus Datenschutzgründen getrennte Nachrichten erhalten");
  assert.match(report,/Uebersicht\.csv/);
  assert.match(report,/Einzelposten\.csv/);
  assert.match(report,/Druckansicht\.html/);
  assert.match(report,/\\uFEFF/);
  assert.match(report,/join\(";"\)/);
  assert.match(report,/\^\[=\+@\]/,"CSV-Formeleinschleusung muss neutralisiert werden");
  assert.match(report,/allocatedSales/,"Der persönliche Buchungsanteil darf bei mehreren Artikeln nicht mehrfach summierbar sein");
  assert.match(report,/Person im Besucherverein/);
  assert.match(report,/im Vereinsgesamtbetrag enthalten/);
  assert.match(smtp,/smtpCashManagerRecipients/);
  assert.match(smtp,/attachments:message\.attachments/);
  assert.match(sender,/replyTo:recipient/,"Getrennte Kassenwart-Mails dürfen nicht die Adressen aller anderen Empfänger offenlegen");
  assert.match(smtp,/disableFileAccess:true/);
  assert.match(smtp,/disableUrlAccess:true/);
});

test("Abrechnung bleibt bei Fehlern im optionalen Mailstatus bedienbar",async()=>{
  const [page,email,monthly]=await Promise.all([
    read("app/page.tsx"),
    read("app/api/email/route.ts"),
    read("app/api/monthly/route.ts")
  ]);
  assert.match(page,/const apiJson=/,"Leere oder ungültige Serverantworten müssen verständlich behandelt werden");
  assert.match(page,/emailError/);
  assert.match(page,/void loadEmail\(value\)/,"Der Mailstatus darf das Laden der Monatsabrechnung nicht blockieren");
  assert.match(email,/E-Mail-Status konnte nicht geladen werden/);
  assert.match(email,/console\.error\("E-Mail-Status konnte nicht geladen werden"/);
  assert.match(monthly,/AS "month"/,"PostgreSQL benötigt für den Monatsalias eine eindeutige Schreibweise");
  assert.doesNotMatch(monthly,/\) month,/,"Der fehlerhafte ungequotete Monatsalias darf nicht zurückkehren");
});

test("Monatsmail läuft intern am Ersten und bleibt manuell auslösbar",async()=>{
  const [scheduled,compose,manager,installer,runner,timer,ci,container]=await Promise.all([
    read("app/api/email/monthly-close/route.ts"),
    read("deploy/docker/compose.yaml"),
    read("deploy/docker/clubiq"),
    read("deploy/monthly-mail/install.sh"),
    read("deploy/monthly-mail/run.sh"),
    read("deploy/monthly-mail/clubiq-monthly-mail.timer"),
    read(".github/workflows/ci.yml"),
    read(".github/workflows/container.yml")
  ]);
  assert.match(scheduled,/x-clubiq-monthly-token/);
  assert.match(scheduled,/previousBerlinMonth/);
  assert.match(scheduled,/mode:"automatic"/);
  assert.match(scheduled,/MONTH_NOT_CLOSED/);
  assert.match(compose,/CLUBIQ_MONTHLY_MAIL_TOKEN_FILE: \/run\/secrets\/monthly_mail_token/);
  assert.match(compose,/monthly_mail_token:/);
  assert.match(manager,/monatsmail-einrichten\|monthly-mail-setup/);
  assert.match(manager,/monatsmail-senden\|monthly-mail-send/);
  assert.match(installer,/enable --now clubiq-monthly-mail\.timer/);
  assert.match(runner,/api\/email\/monthly-close/);
  assert.match(timer,/OnCalendar=\*-\*-01 08:00:00 Europe\/Berlin/);
  assert.match(timer,/Persistent=true/);
  assert.match(ci,/touch deploy\/docker\/secrets\/monthly_mail_token/);
  assert.match(container,/: > secrets\/monthly_mail_token/);
});
