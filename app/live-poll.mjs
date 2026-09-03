// A single in-flight request, immediate reconnect/focus refresh, bounded backoff.
// Kept framework-independent so both UIs use and test the same behavior.
/** @param {{load:(signal:AbortSignal)=>Promise<unknown>,allowed?:()=>boolean,onSuccess?:()=>void,onError?:(error:unknown)=>void,interval?:number,maxDelay?:number,timeout?:number,win?:Window,doc?:Document,setTimer?:typeof setTimeout,clearTimer?:typeof clearTimeout}} options */
export function startLivePolling({load,allowed=()=>true,onSuccess=()=>{},onError=()=>{},interval=3000,maxDelay=30000,timeout=20000,
  win=window,doc=document,setTimer=setTimeout,clearTimer=clearTimeout}){
  let stopped=false,running=false,timer,deadline,controller,failures=0,again=false;
  const visible=()=>doc.visibilityState!=='hidden';
  function schedule(delay){clearTimer(timer);if(!stopped)timer=setTimer(tick,delay);}
  async function tick(){
    if(stopped)return;
    if(running){again=true;return;}
    if(!visible()||!allowed()){schedule(interval);return;}
    running=true;controller=new AbortController();
    let timedOut=false;
    deadline=setTimer(()=>{timedOut=true;controller.abort();},timeout);
    try{const applied=await load(controller.signal);if(!stopped&&!timedOut){failures=0;if(applied!==false)onSuccess();}}
    catch(error){controller.abort();if(!stopped&&(timedOut||error?.name!=='AbortError')){failures++;onError(timedOut?new Error('Datenabgleich hat zu lange gedauert'):error);}}
    finally{clearTimer(deadline);running=false;if(!stopped){const immediate=again;again=false;schedule(immediate?0:Math.min(maxDelay,interval*2**Math.min(failures,4)));}}
  }
  const wake=()=>{if(visible()){clearTimer(timer);void tick();}};
  const offline=()=>{if(!stopped)onError(new Error('Verbindung unterbrochen'));};
  win.addEventListener('online',wake);win.addEventListener('focus',wake);win.addEventListener('offline',offline);doc.addEventListener('visibilitychange',wake);
  schedule(0);
  return ()=>{stopped=true;clearTimer(timer);clearTimer(deadline);controller?.abort();win.removeEventListener('online',wake);win.removeEventListener('focus',wake);win.removeEventListener('offline',offline);doc.removeEventListener('visibilitychange',wake);};
}
export function editingForm(doc=document){
  return Boolean(doc.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]')&&!doc.activeElement.closest?.('[data-live-filter]'));
}
