import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../scripts/demo-data.mjs';
import {currentMonth} from '../security.mjs';
test('fictional members have coherent items, balances, payments and credit; no email is needed',async()=>{
  const state=new Map(),demo=demoData({read:(key,fallback)=>state.get(key)||fallback,write:(key,value)=>state.set(key,value)});
  const month=currentMonth(),report=await demo.report('demo',month);
  assert.equal(report.people.length,8);assert.equal(report.summary.charges,203);assert.equal(report.summary.payments,93);
  for(const person of report.people){
    assert.equal(person.charges,report.items.filter(i=>i.memberId===person.memberId).reduce((s,i)=>s+i.total,0));
    assert.equal(person.closingBalance,person.openingBalance+person.charges-person.payments+person.adjustments);
    assert.equal(person.closingBalance,(await demo.entries('demo',person.memberId)).reduce((s,e)=>s+e.amount,0));
  }
  assert.equal(demo.balances().outstanding,146.5);assert.equal(demo.balances().credits,10);
  assert.ok(report.people.some(p=>p.closingBalance===0));assert.ok(report.people.some(p=>p.closingBalance<0));
  const member=(await demo.members())[0];await demo.saveMember({},member.id,{name:'Alex Umbenannt',version:member.version});
  await demo.createMember({},{name:'Weiteres Testmitglied'});
  const again=demoData({read:(key,fallback)=>state.get(key)||fallback,write:(key,value)=>state.set(key,value)});
  assert.equal((await again.members()).length,9);assert.equal((await again.report('demo',month)).people[0].memberName,'Alex Umbenannt');
});
