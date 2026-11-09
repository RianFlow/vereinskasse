import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
// Exercise the actual pure source on all supported Node 22 versions, including
// versions before native TypeScript stripping was enabled by default.
const compiled=ts.transpileModule(readFileSync(new URL('../app/tablet-cash-model.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {parseEuroCents,euroText,distributeShares,validateShares,personalFavorites,repeatCart,unitsAfterCoverage}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const part=(id,cents=null,fixed=false)=>({id,cents,text:cents===null?'':euroText(cents),fixed});

test('decimal entries preserve cents and reject invalid or excessive precision',()=>{
 for(const [text,expected]of [['0',0],['2,75',275],['2.5',250],['2,',200],[' 001,04 ',104]])assert.equal(parseEuroCents(text),expected);
 for(const text of ['',',','-1','2,001','Infinity','1e3','1,2.3','99999999'])assert.equal(parseEuroCents(text),null);
});
test('equal splitting conserves every cent for two through one hundred accounts',()=>{
 for(let people=2;people<=100;people++)for(const total of [101,550,9999,1000000]){
  const shares=distributeShares(Array.from({length:people},(_,i)=>part(String(i))),total);
  assert.equal(shares.reduce((sum,p)=>sum+p.cents,0),total);
  assert.ok(Math.max(...shares.map(p=>p.cents))-Math.min(...shares.map(p=>p.cents))<=1);
  assert.equal(validateShares(shares,total).valid,true);
 }
 assert.deepEqual(distributeShares([part('a'),part('b'),part('c')],550).map(p=>p.cents),[184,183,183]);
});
test('fixed amounts leave the remainder to automatic shares, without mutating a draft',()=>{
 const draft=[part('a',200,true),part('b'),part('c')],before=structuredClone(draft);
 const shares=distributeShares(draft,550);assert.deepEqual(shares.map(p=>p.cents),[200,175,175]);assert.deepEqual(draft,before);
 assert.deepEqual(distributeShares([shares[0],part('b',150,true),shares[2]],550).map(p=>p.cents),[200,150,200]);
 assert.deepEqual(distributeShares([part('a',600,true),part('b')],550).map(p=>p.cents),[600,0]);
 assert.equal(validateShares(distributeShares([part('a',600,true),part('b')],550),550).valid,false);
});
test('incomplete, duplicate, zero and invalid shares cannot be confirmed',()=>{
 for(const draft of [[part('a',550,true)],[part('a',275,true),part('a',275,true)],[part('a',0,true),part('b',550,true)],[part('a',200,true),part('b',300,true)],[part('a',null,true),part('b',550,true)]])assert.equal(validateShares(draft,550).valid,false);
 assert.equal(validateShares([part('a',200,true),part('b',300,true)],550).remaining,50);
});
test('a drinks fund reduces only eligible article units and preserves the unpaid remainder',()=>{
 const units=[{cents:250,drink:true,id:'drink-1'},{cents:400,drink:false,id:'food'},{cents:250,drink:true,id:'drink-2'}];
 assert.deepEqual(unitsAfterCoverage(units,350).map(u=>u.cents),[0,400,150]);assert.deepEqual(units.map(u=>u.cents),[250,400,250]);
 assert.equal(unitsAfterCoverage(units,350).reduce((sum,u)=>sum+u.cents,0),550);
});
test('personal favorites rank order frequency before quantity, filter missing articles and use ten orders',()=>{
 const orders=[{id:'1',time:'',cart:{1:1,2:8,99:1}},{id:'2',time:'',cart:{1:1,3:1}}];
 assert.deepEqual(personalFavorites(orders,[1,2,3,4],[4]),[1,2,3,4]);
 assert.deepEqual(personalFavorites([...Array.from({length:10},(_,i)=>({id:String(i),time:'',cart:{1:1}})),{id:'old',time:'',cart:{2:99}}],[1,2,3],[3]),[1,3,2]);
 assert.deepEqual(personalFavorites([],[1,2,3],[3,3]),[3,1,2]);
});
test('repeat uses sellable bundle ids and quantities, leaving the stored order untouched',()=>{
 const order={id:'x',time:'',cart:{1:2,7:1,99:4}},before=structuredClone(order);
 assert.deepEqual(repeatCart(order,[1,7]),{1:2,7:1});assert.deepEqual(order,before);
});
