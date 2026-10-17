import test from 'node:test';
import assert from 'node:assert/strict';

test('aktualisierte SMTP-Bibliothek erstellt Rechnungen und Anhänge ohne Versand',async()=>{
  const imported=await import('nodemailer');
  const createTransport=imported.default?.createTransport||imported.createTransport;
  assert.equal(typeof createTransport,'function');
  const transport=createTransport({streamTransport:true,buffer:true,newline:'unix',disableFileAccess:true,disableUrlAccess:true});
  const result=await transport.sendMail({from:'Kasse <kasse@example.invalid>',to:'mitglied@example.invalid',subject:'Kassenabrechnung',text:'Testabrechnung',html:'<p>Testabrechnung</p>',attachments:[{filename:'rechnung.csv',content:'Artikel,Betrag\nWasser,2.00',contentType:'text/csv'}],disableFileAccess:true,disableUrlAccess:true});
  const message=result.message.toString('utf8');
  assert.match(message,/Subject: Kassenabrechnung/);
  assert.match(message,/multipart\/mixed/);
  assert.match(message,/filename=.?rechnung\.csv/);
  assert.match(message,/To: mitglied@example\.invalid/);
});
