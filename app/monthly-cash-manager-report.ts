export type CashManagerPerson={memberId:string;memberName:string;openingBalance:number;charges:number;payments:number;adjustments:number;closingBalance:number;parentName?:string|null;isClubGroup?:boolean;children?:CashManagerPerson[]};
export type CashManagerItem={memberId:string;saleId:string|null;createdAt:string;productName:string;quantity:number;total:number;shared:boolean;allocatedAmount:number};
export type CashManagerSnapshot={month:string;label:string;dueLabel:string;people:CashManagerPerson[];items:CashManagerItem[];summary:{charges:number;payments:number;people:number}};

const eur=(value:number)=>Number(value||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const decimal=(value:number)=>Number(value||0).toFixed(2).replace(".",",");
const htmlEscape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const csvCell=(value:unknown)=>{
  let text=String(value??"");
  const formulaCandidate=text.trimStart();
  if(/^[=+@]/.test(formulaCandidate)||(/^-/.test(formulaCandidate)&&!/^-[0-9]+(?:[.,][0-9]+)?$/.test(formulaCandidate)))text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
};
const csv=(rows:unknown[][])=>"\uFEFF"+rows.map(row=>row.map(csvCell).join(";")).join("\r\n")+"\r\n";
const safeName=(value:string)=>value.replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"Monatsabschluss";

function accounts(snapshot:CashManagerSnapshot){
  return snapshot.people.flatMap(person=>[
    {person,parent:"",type:person.isClubGroup?"Besucherverein":person.memberId.startsWith("GAST-")?"Gast":"Mitglied",included:"Ja"},
    ...(person.children||[]).map(child=>({person:child,parent:person.memberName,type:"Person im Besucherverein",included:"Nein – im Vereinsgesamtbetrag enthalten"}))
  ]);
}

export function buildCashManagerReport(profileName:string,statementNumber:string,snapshot:CashManagerSnapshot){
  const allAccounts=accounts(snapshot),name=safeName(`Monatsabschluss-${snapshot.month}`);
  const overview=csv([
    ["Profil","Monat","Rechnungsnummer","Kontotyp","Konto-ID","Name","Zugeordnet zu","Monatsanfang EUR","Neue Buchungen EUR","Zahlungen EUR","Korrekturen EUR","Monatsende EUR","Fällig bis","In Gesamtsumme"],
    ...allAccounts.map(({person,parent,type,included})=>[profileName,snapshot.label,statementNumber,type,person.memberId,person.memberName,parent,decimal(person.openingBalance),decimal(person.charges),decimal(person.payments),decimal(person.adjustments),decimal(person.closingBalance),snapshot.dueLabel,included])
  ]);
  const accountById=new Map(allAccounts.map(entry=>[entry.person.memberId,entry]));
  const allocatedSales=new Set<string>();
  const sortedItems=[...snapshot.items].sort((left,right)=>{
    const leftName=accountById.get(left.memberId)?.person.memberName||left.memberId;
    const rightName=accountById.get(right.memberId)?.person.memberName||right.memberId;
    return leftName.localeCompare(rightName,"de")||left.createdAt.localeCompare(right.createdAt)||left.productName.localeCompare(right.productName,"de");
  });
  const items=csv([
    ["Profil","Monat","Rechnungsnummer","Datum","Konto-ID","Name","Zugeordnet zu","Buchung-ID","Artikel","Menge","Positionswert EUR","Geteilt","Auf Konto gebucht EUR"],
    ...sortedItems.map(item=>{const account=accountById.get(item.memberId),allocationKey=`${item.memberId}:${item.saleId||item.createdAt}`,firstAllocation=!allocatedSales.has(allocationKey);allocatedSales.add(allocationKey);return[profileName,snapshot.label,statementNumber,new Date(item.createdAt).toLocaleString("de-DE",{timeZone:"Europe/Berlin"}),item.memberId,account?.person.memberName||item.memberId,account?.parent||"",item.saleId||"",item.productName,item.quantity,decimal(item.total),item.shared?"Ja":"Nein",firstAllocation?decimal(item.allocatedAmount):""]})
  ]);
  const rows=snapshot.people.map(person=>`<tr><td>${htmlEscape(person.memberName)}</td><td>${eur(person.openingBalance)}</td><td>${eur(person.charges)}</td><td>− ${eur(person.payments)}</td><td><strong>${eur(person.closingBalance)}</strong></td></tr>`).join("");
  const printable=`<!doctype html><html lang="de"><meta charset="utf-8"><title>${htmlEscape(statementNumber)}</title><style>body{font:14px Arial;color:#172b25;max-width:1000px;margin:30px auto}h1{margin-bottom:4px}.meta{color:#68766f}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid #ddd}th:not(:first-child),td:not(:first-child){text-align:right}.sum{font-size:18px;padding:14px;background:#edf7f1}</style><h1>Monatsabschluss ${htmlEscape(snapshot.label)}</h1><p class="meta">${htmlEscape(profileName)} · ${htmlEscape(statementNumber)} · zahlbar bis ${htmlEscape(snapshot.dueLabel)}</p><table><thead><tr><th>Konto</th><th>Monatsanfang</th><th>Buchungen</th><th>Bezahlt</th><th>Monatsende</th></tr></thead><tbody>${rows}</tbody></table><p class="sum"><strong>Neue Buchungen:</strong> ${eur(snapshot.summary.charges)} · <strong>Zahlungen:</strong> ${eur(snapshot.summary.payments)}</p><p>Die vollständigen Einzelposten befinden sich in der beigefügten CSV-Datei.</p></html>`;
  const open=snapshot.people.filter(person=>person.closingBalance>.005),openTotal=open.reduce((sum,person)=>sum+person.closingBalance,0);
  const html=`<h2>Monatsabschluss ${htmlEscape(snapshot.label)}</h2><p><strong>${htmlEscape(profileName)}</strong><br>Rechnungsnummer ${htmlEscape(statementNumber)}</p><p>${snapshot.people.length} Konten · ${eur(snapshot.summary.charges)} neue Buchungen · ${eur(snapshot.summary.payments)} Zahlungen</p><h3>Offene Monatsendstände</h3><table style="border-collapse:collapse;width:100%"><tbody>${open.map(person=>`<tr><td style="padding:7px;border-bottom:1px solid #ddd">${htmlEscape(person.memberName)}</td><td style="padding:7px;border-bottom:1px solid #ddd;text-align:right"><strong>${eur(person.closingBalance)}</strong></td></tr>`).join("")||"<tr><td>Keine offenen Beträge</td></tr>"}</tbody></table><p><strong>Offen gesamt: ${eur(openTotal)}</strong></p><p>Im Anhang liegen eine Kontenübersicht, sämtliche Einzelposten und eine druckbare Zusammenfassung. Die CSV-Dateien können direkt in Excel oder LibreOffice weiterbearbeitet werden.</p>`;
  const text=[`Monatsabschluss ${snapshot.label}`,profileName,`Rechnungsnummer: ${statementNumber}`,`${snapshot.people.length} Konten`,`Neue Buchungen: ${eur(snapshot.summary.charges)}`,`Zahlungen: ${eur(snapshot.summary.payments)}`,`Offen gesamt: ${eur(openTotal)}`,"","Die bearbeitbaren Konten- und Einzelpostenlisten befinden sich im Anhang."].join("\n");
  return {subject:`Monatsabschluss ${snapshot.label} · ${profileName}`,html,text,attachments:[{filename:`${name}-Uebersicht.csv`,content:overview,contentType:"text/csv; charset=utf-8"},{filename:`${name}-Einzelposten.csv`,content:items,contentType:"text/csv; charset=utf-8"},{filename:`${name}-Druckansicht.html`,content:printable,contentType:"text/html; charset=utf-8"}]};
}
