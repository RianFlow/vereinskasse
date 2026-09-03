// Fictional, loopback-only examples. Never imported by the production server.
import {randomUUID} from 'node:crypto';
import {assert,billingMonth,currentMonth,money,text} from '../security.mjs';
const recipes=[
  ['M-TEST','Alex Beispiel',0,0,0,[['Beispielgetränk',5,2.5]]],
  ['M-DEMO-LENA','Lena Muster',8,20,0,[['Bier',8,2.5],['Veterano',6,2]]],
  ['M-DEMO-BEN','Ben Testmann',0,18,0,[['Cola',6,2],['Veterano',3,2]]],
  ['M-DEMO-MIA','Mia Musterfrau',15,10,-1.5,[['Bier',10,2.5],['Veterano',8,2],['Kaffee',3,1.5],['Wasser',1,1]]],
  ['M-DEMO-TOM','Tom Beispiel',5,25,0,[['Bier',20,2.5],['Veterano',10,2],['Cola',4,2]]],
  ['M-DEMO-SARAH','Sarah Test',0,20,0,[['Cola',4,2],['Wasser',2,1]]],
  ['M-DEMO-NILS','Nils Muster',0,0,0,[['Kaffee',4,1.5]]],
  ['M-DEMO-JANA','Jana Beispiel',0,0,0,[]],
];
const round=n=>Math.round(n*100)/100;
export function demoData({read,write}){
  const members=read('members-v2',recipes.map(([id,name])=>({id,name,role:'Mitglied',initials:name.split(' ').map(n=>n[0]).join(''),active:1,version:randomUUID()})));
  const additions=read('entries-v2',[]),notes=read('notes-v2',[]);
  function snapshot(month){
    billingMonth(month);
    const items=[],people=members.map(member=>{
      const recipe=recipes.find(r=>r[0]===member.id)||[member.id,member.name,0,0,0,[]];
      for(const [index,[productName,quantity,price]]of recipe[5].entries())items.push({memberId:member.id,saleId:`demo-${month}-${member.id}-${index}`,createdAt:`${month}-02T18:${String(index*5).padStart(2,'0')}:00Z`,productName,quantity,total:round(quantity*price),shared:false,allocatedAmount:round(quantity*price)});
      const charges=round(recipe[5].reduce((sum,[,quantity,price])=>sum+quantity*price,0)),extra=additions.filter(e=>e.memberId===member.id&&e.referenceMonth===month);
      const payments=round(recipe[3]-extra.filter(e=>e.type==='Zahlung').reduce((sum,e)=>sum+e.amount,0));
      const adjustments=round(recipe[4]+extra.filter(e=>e.type!=='Zahlung').reduce((sum,e)=>sum+e.amount,0));
      return {memberId:member.id,memberName:member.name,openingBalance:recipe[2],charges,payments,adjustments,closingBalance:round(recipe[2]+charges-payments+adjustments)};
    });
    return {month,label:`${month} · Beispieldaten`,dueLabel:'Nur Vorschau',people,items,summary:{charges:round(people.reduce((s,p)=>s+p.charges,0)),payments:round(people.reduce((s,p)=>s+p.payments,0)),people:people.length},closure:{closed:false},balances:people.map(p=>({member_id:p.memberId,balance:p.closingBalance})),notes:notes.filter(n=>n.month===month)};
  }
  return {
    report:async(_profile,month)=>snapshot(month),
    members:async()=>members,
    async createMember(_actor,input){const name=text(input.name,'Vor- und Nachname');assert(name.split(/\s+/).length>=2,400,'Bitte Vor- und Nachname eingeben.');assert(!members.some(m=>m.name.toLowerCase()===name.toLowerCase()),409,'Dieses Testmitglied ist bereits vorhanden.');const id=`M-${randomUUID().slice(0,8).toUpperCase()}`;members.push({id,name,role:'Mitglied',initials:name.split(/\s+/).slice(0,2).map(n=>n[0]).join(''),active:1,version:randomUUID()});write('members-v2',members);return {ok:true,id,message:'Mitglied nur im Testsystem angelegt.'};},
    async saveMember(_actor,id,input){const member=members.find(m=>m.id===id);assert(member,404,'Testmitglied nicht gefunden.');assert(member.version===input.version,409,'Zwischenzeitlich geändert. Bitte neu laden.');member.name=text(input.name,'Name');member.version=randomUUID();write('members-v2',members);return {ok:true};},
    async entries(_profile,id){const month=currentMonth(),report=snapshot(month),person=report.people.find(p=>p.memberId===id);if(!person)return[];const rows=report.items.filter(i=>i.memberId===id).map(i=>({id:i.saleId,created_at:i.createdAt,type:'Monatsabrechnung',amount:i.total,note:`Beispiel: ${i.quantity} × ${i.productName}`}));const recipe=recipes.find(r=>r[0]===id);if(recipe?.[2])rows.push({id:`opening-${id}`,created_at:`${month}-01T00:00:00Z`,type:'Vortrag',amount:recipe[2],note:'Beispiel: offener Betrag aus Vormonat'});if(recipe?.[3])rows.push({id:`payment-${id}`,created_at:`${month}-03T08:00:00Z`,type:'Zahlung',amount:-recipe[3],note:'Beispiel: eingegangene Überweisung'});if(recipe?.[4])rows.push({id:`adjustment-${id}`,created_at:`${month}-03T09:00:00Z`,type:'Korrektur',amount:recipe[4],note:'Beispiel: Gutschrift / Korrektur'});return [...rows,...additions.filter(e=>e.memberId===id)].sort((a,b)=>b.created_at.localeCompare(a.created_at));},
    async addEntry(_actor,input){const report=snapshot(input.referenceMonth),person=report.people.find(p=>p.memberId===input.memberId);assert(person,404,'Testmitglied nicht gefunden.');if(additions.some(e=>e.id===input.idempotencyKey))return {ok:true,duplicate:true};assert(person.closingBalance===Number(input.expectedBalance),409,'Der Kontostand hat sich geändert. Bitte neu laden.');assert(['payment','adjustment'].includes(input.kind),400,'Ungültige Buchungsart.');const amount=money(input.amount,input.kind==='adjustment')/100;additions.push({...input,id:input.idempotencyKey,type:input.kind==='payment'?'Zahlung':'Korrektur',amount:input.kind==='payment'?-amount:amount,note:text(input.reason,'Begründung',500),created_at:new Date().toISOString()});write('entries-v2',additions);return {ok:true,message:'Buchung nur im Testsystem gespeichert.'};},
    async note(_actor,month,id,input){billingMonth(month);const existing=notes.find(n=>n.month===month&&n.member_id===id);assert((existing?.version||0)===input.version,409,'Vermerk wurde geändert. Bitte neu laden.');const row=existing||{month,member_id:id,version:0};row.note=text(input.note,'Vermerk',2000);row.version++;if(!existing)notes.push(row);write('notes-v2',notes);return {ok:true};},
    balances(){const people=snapshot(currentMonth()).people;return {balances:[{name:'Bis 10 €',min:0,max:10},{name:'Über 10 bis 50 €',min:10,max:50},{name:'Über 50 €',min:50,max:Infinity}].map(({name,min,max})=>{const group=people.filter(p=>p.closingBalance>min&&p.closingBalance<=max);return {name,count:group.length,amount:round(group.reduce((s,p)=>s+p.closingBalance,0))};}),outstanding:round(people.reduce((s,p)=>s+Math.max(0,p.closingBalance),0)),openAccounts:people.filter(p=>p.closingBalance>0).length,credits:round(-people.reduce((s,p)=>s+Math.min(0,p.closingBalance),0))};},
  };
}
