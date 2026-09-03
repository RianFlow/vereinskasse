import test from 'node:test';
import assert from 'node:assert/strict';
import {startLivePolling,editingForm} from '../app/live-poll.mjs';

function clock(){
  let now=0,id=0;const timers=new Map(),win=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';
  const setTimer=(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimer=id=>timers.delete(id);
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const advance=async ms=>{const end=now+ms;for(;;){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await flush();}now=end;await flush();};
  return {win,doc,setTimer,clearTimer,advance,flush,timers};
}
test('refreshes without overlap, pauses hidden/edited views and resumes immediately',async()=>{
  const c=clock();let calls=0,resolve,allowed=true;const stop=startLivePolling({...c,allowed:()=>allowed,load:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  await c.advance(0);assert.equal(calls,1);c.win.dispatchEvent(new Event('focus'));c.win.dispatchEvent(new Event('online'));assert.equal(calls,1);
  resolve();await c.flush();await c.advance(0);assert.equal(calls,2);resolve();await c.flush();
  c.doc.visibilityState='hidden';await c.advance(6000);assert.equal(calls,2);
  c.doc.visibilityState='visible';c.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,3);resolve();await c.flush();
  allowed=false;await c.advance(6000);assert.equal(calls,3);allowed=true;await c.advance(3000);assert.equal(calls,4);
  stop();resolve();await c.advance(10000);assert.equal(calls,4);assert.equal(c.timers.size,0);
});
test('backs off after failure, reconnects immediately and flags offline state',async()=>{
  const c=clock();let calls=0,errors=0,success=0;const stop=startLivePolling({...c,load:async()=>{if(++calls<3)throw new Error('network');},onError:()=>errors++,onSuccess:()=>success++});
  await c.advance(0);assert.equal(calls,1);await c.advance(5999);assert.equal(calls,1);await c.advance(1);assert.equal(calls,2);
  c.win.dispatchEvent(new Event('online'));await c.flush();assert.equal(calls,3);assert.equal(success,1);
  c.win.dispatchEvent(new Event('offline'));assert.equal(errors,3);stop();
});
test('aborts timed-out reads and unmounted requests without claiming success',async()=>{
  const c=clock();let signal,errors=0,success=0;const stop=startLivePolling({...c,timeout:100,load:s=>{signal=s;return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));},onError:()=>errors++,onSuccess:()=>success++});
  await c.advance(100);assert.ok(signal.aborted);assert.equal(errors,1);assert.equal(success,0);
  c.win.dispatchEvent(new Event('online'));await c.flush();assert.ok(!signal.aborted);stop();await c.flush();assert.ok(signal.aborted);assert.equal(errors,1);assert.equal(c.timers.size,0);
});
test('discarded replies do not update last-success time; focused fields are protected',async()=>{
  const c=clock();let success=0;const stop=startLivePolling({...c,load:async()=>false,onSuccess:()=>success++});await c.advance(0);assert.equal(success,0);stop();
  assert.equal(editingForm({activeElement:{matches:selector=>selector.includes('textarea')}}),true);assert.equal(editingForm({activeElement:null}),false);
  assert.equal(editingForm({activeElement:{matches:()=>true,closest:()=>({})}}),false);
});
