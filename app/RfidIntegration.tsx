"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconCheck, IconCopy, IconNfc, IconRefresh, IconWifi } from "@tabler/icons-react";

type Member={id:string;name:string;role:string;initials:string;active?:boolean};
type LoginProfile={id:string;name:string;shortName:string;color:string;mustChangePin?:boolean};
type Scan={id:string;uid:string;deviceId:string;deviceName:string;cardType?:string|null;blocks?:number|null;createdAt:string};
type ScannerState=
  |{kind:"waiting";deviceCount:number}
  |{kind:"recognized";deviceCount:number;scan:Scan;member:Member}
  |{kind:"unknown";deviceCount:number;scan:Scan}
  |{kind:"error";deviceCount:number;message:string};

let rfidAudioContext:AudioContext|null=null;
async function playRfidRecognitionTone(){
  try{
    rfidAudioContext??=new AudioContext();
    if(rfidAudioContext.state==="suspended")await rfidAudioContext.resume();
    const now=rfidAudioContext.currentTime,oscillator=rfidAudioContext.createOscillator(),gain=rfidAudioContext.createGain();
    oscillator.type="sine";
    oscillator.frequency.setValueAtTime(880,now);
    oscillator.frequency.setValueAtTime(1175,now+0.085);
    gain.gain.setValueAtTime(0.0001,now);
    gain.gain.exponentialRampToValueAtTime(0.075,now+0.012);
    gain.gain.setValueAtTime(0.075,now+0.13);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+0.2);
    oscillator.connect(gain);gain.connect(rfidAudioContext.destination);
    oscillator.start(now);oscillator.stop(now+0.21);
    navigator.vibrate?.(35);
  }catch{
    // Manche Browser geben Ton erst nach der ersten BerÃ¼hrung frei.
  }
}

export function RfidScanner({onSelect}:{members:Member[];onSelect:(member:Member)=>void}){
  const [state,setState]=useState<ScannerState>({kind:"waiting",deviceCount:0});
  const stateRef=useRef(state),onSelectRef=useRef(onSelect),holdUntil=useRef(0);
  useEffect(()=>{stateRef.current=state},[state]);
  useEffect(()=>{onSelectRef.current=onSelect},[onSelect]);

  useEffect(()=>{
    let stopped=false,busy=false;
    const poll=async()=>{
      if(stopped||busy||document.visibilityState!=="visible")return;
      busy=true;
      try{
        const response=await fetch("/api/rfid",{headers:{"cache-control":"no-store"}});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||"RFID-Leser ist momentan nicht erreichbar");
        if(stopped)return;
        if(data.state==="recognized"&&data.member&&data.scan){
          holdUntil.current=Date.now()+3500;
          const next={kind:"recognized",deviceCount:Number(data.deviceCount||0),scan:data.scan,member:data.member} as const;
          setState(next);void playRfidRecognitionTone();onSelectRef.current(data.member);
        }else if(data.state==="unknown"&&data.scan){
          holdUntil.current=Number.POSITIVE_INFINITY;
          setState({kind:"unknown",deviceCount:Number(data.deviceCount||0),scan:data.scan});
        }else if(stateRef.current.kind!=="unknown"&&Date.now()>=holdUntil.current){
          setState({kind:"waiting",deviceCount:Number(data.deviceCount||0)});
        }
      }catch(reason){
        if(!stopped&&stateRef.current.kind!=="unknown")setState({kind:"error",deviceCount:stateRef.current.deviceCount,message:reason instanceof Error?reason.message:"Lesefehler"});
      }finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);
    return()=>{stopped=true;clearInterval(timer)};
  },[]);

  const dismiss=()=>{holdUntil.current=0;setState({kind:"waiting",deviceCount:state.deviceCount})};

  const copy=state.kind==="recognized"
    ?{title:`${state.member.name.split(" ")[0]} erkannt`,detail:`${state.member.name} ist ausgewÃ¤hlt. Anderes Mitglied scannen: nÃ¤chste Karte auflegen.`}
    :state.kind==="unknown"
      ?{title:"Unbekannte Karte",detail:`UID ${state.scan.uid} kann im Adminbereich beim Mitglied zugeordnet werden.`}
      :state.kind==="error"
        ?{title:"RFID-Fehler",detail:state.message}
        :state.deviceCount
          ?{title:"RFID bereit",detail:`${state.deviceCount===1?"RFID-Leser bereit":`${state.deviceCount} RFID-Leser bereit`} Â· Karte auflegen.`}
          :{title:"RFID offline",detail:"Leser, Strom und Vereins-WLAN prÃ¼fen."};

  const light=state.kind==="recognized"||state.kind==="waiting"&&state.deviceCount?"green":state.kind==="unknown"?"yellow":"red";
  return <button type="button" className={`rfid-header-status ${state.kind} ${light}`} onClick={dismiss} aria-live="polite" aria-label={`${copy.title}. ${copy.detail}`} title={copy.detail}>
    <span className="rfid-traffic-light" aria-hidden="true"><i/><i/><i/></span>
    <span><strong>{copy.title}</strong><small>{copy.detail}</small></span>
  </button>;
}

export function RfidAdminLogin({expectedMemberId,requiredRole,onVerified}:{expectedMemberId?:string;requiredRole?:string;onVerified:(member:Member)=>void}){
  const [state,setState]=useState<"checking"|"waiting"|"success"|"unknown"|"forbidden"|"mismatch"|"error">("checking");
  const [message,setMessage]=useState("Verbindung zum RFID-Leser wird geprÃ¼ft.");
  const finished=useRef(false),holdUntil=useRef(0),onVerifiedRef=useRef(onVerified);
  useEffect(()=>{onVerifiedRef.current=onVerified},[onVerified]);
  useEffect(()=>{
    let stopped=false,busy=false;
    const poll=async()=>{
      if(stopped||busy||finished.current||document.visibilityState!=="visible")return;
      busy=true;
      try{
        const query=new URLSearchParams({purpose:"admin"});
        if(expectedMemberId)query.set("memberId",expectedMemberId);
        if(requiredRole)query.set("requiredRole",requiredRole);
        const response=await fetch(`/api/rfid?${query}`,{cache:"no-store"}),data=await response.json();
        if(!response.ok)throw new Error(data.error||"RFID-Anmeldung ist momentan nicht erreichbar");
        if(stopped)return;
        if(data.state==="recognized"&&data.member){
          finished.current=true;setState("success");setMessage(`âœ“ ${data.member.name} wurde sicher erkannt.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},350);
        }else if(data.state==="unknown"){
          holdUntil.current=Date.now()+3500;setState("unknown");setMessage("Diese Karte ist noch keinem Mitglied zugeordnet.");
        }else if(data.state==="forbidden"){
          holdUntil.current=Date.now()+3500;setState("forbidden");setMessage(`${data.member?.name||"Diese Person"} hat keinen Adminzugang.`);
        }else if(data.state==="mismatch"){
          holdUntil.current=Date.now()+3500;setState("mismatch");setMessage(`Die Karte gehÃ¶rt zu ${data.member?.name||"einer anderen Person"}.`);
        }else if(Date.now()>=holdUntil.current){
          const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser ist online. Admin-Chip jetzt auflegen.":"Kein RFID-Leser online. Strom und Vereins-WLAN prÃ¼fen.");
        }
      }catch(reason){
        if(!stopped){setState("error");setMessage(reason instanceof Error?reason.message:"RFID-Anmeldung fehlgeschlagen")}
      }finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);
    return()=>{stopped=true;clearInterval(timer)};
  },[expectedMemberId,requiredRole]);
  return <div className={`rfid-admin-login ${state}`} aria-live="polite">
    <span>{state==="success"?<IconCheck size={25}/>:state==="error"||state==="forbidden"||state==="mismatch"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span>
    <div><strong>{state==="success"?"Admin-Chip erkannt":state==="checking"?"Leser wird geprÃ¼ft":state==="waiting"?"Mit Chip anmelden":state==="unknown"?"Unbekannte Karte":state==="forbidden"?"Keine Adminberechtigung":state==="mismatch"?"Falsche Karte":"Lesefehler"}</strong><small>{message}</small></div>
  </div>;
}

export function RfidShiftLogin({onVerified}:{onVerified:(member:Member)=>void}){
  const [message,setMessage]=useState("Leser wird geprÃ¼ft. Danach Mitgliedschip auflegen.");
  const [state,setState]=useState<"checking"|"waiting"|"success"|"unknown"|"error">("checking");
  const finished=useRef(false),onVerifiedRef=useRef(onVerified);
  useEffect(()=>{onVerifiedRef.current=onVerified},[onVerified]);
  useEffect(()=>{
    let stopped=false,busy=false;
    const poll=async()=>{
      if(stopped||busy||finished.current||document.visibilityState!=="visible")return;
      busy=true;
      try{
        const response=await fetch("/api/rfid?purpose=shift",{cache:"no-store"}),data=await response.json();
        if(!response.ok)throw new Error(data.error||"RFID-Anmeldung ist momentan nicht erreichbar");
        if(stopped)return;
        if(data.state==="recognized"&&data.member){
          finished.current=true;setState("success");setMessage(`âœ“ ${data.member.name} Ã¶ffnet die Kasse.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},300);
        }else if(data.state==="unknown"){setState("unknown");setMessage("Diese Karte ist noch keinem aktiven Mitglied zugeordnet.")}
        else{const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser ist bereit. Mitgliedschip jetzt auflegen.":"Kein RFID-Leser online. Strom und Vereins-WLAN prÃ¼fen.")}
      }catch(reason){if(!stopped){setState("error");setMessage(reason instanceof Error?reason.message:"RFID-Anmeldung fehlgeschlagen")}}
      finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);return()=>{stopped=true;clearInterval(timer)};
  },[]);
  return <div className={`rfid-admin-login shift ${state}`} aria-live="polite"><span>{state==="success"?<IconCheck size={25}/>:state==="error"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span><div><strong>{state==="success"?"Mitglied erkannt":state==="checking"?"Leser wird geprÃ¼ft":state==="waiting"?"Chip auflegen":state==="unknown"?"Unbekannte Karte":"Lesefehler"}</strong><small>{message}</small></div></div>;
}

export function RfidBalanceLookup({onVerified}:{onVerified:(member:Member)=>void}){
  const [message,setMessage]=useState("Leser wird geprÃ¼ft. Danach Mitgliedschip auflegen.");
  const [state,setState]=useState<"checking"|"waiting"|"success"|"unknown"|"error">("checking");
  const finished=useRef(false),holdUntil=useRef(0),onVerifiedRef=useRef(onVerified);
  useEffect(()=>{onVerifiedRef.current=onVerified},[onVerified]);
  useEffect(()=>{
    let stopped=false,busy=false;
    const poll=async()=>{
      if(stopped||busy||finished.current||document.visibilityState!=="visible")return;
      busy=true;
      try{
        const response=await fetch("/api/rfid",{cache:"no-store"}),data=await response.json();
        if(!response.ok)throw new Error(data.error||"RFID-Leser ist momentan nicht erreichbar");
        if(stopped)return;
        if(data.state==="recognized"&&data.member){
          finished.current=true;setState("success");setMessage(`âœ“ ${data.member.name} erkannt.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},250);
        }else if(data.state==="unknown"){
          holdUntil.current=Date.now()+3500;setState("unknown");setMessage("Diese Karte ist noch keinem aktiven Mitglied zugeordnet.");
        }else if(Date.now()>=holdUntil.current){
          const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser ist bereit. Mitgliedschip jetzt auflegen.":"Kein RFID-Leser online. Name kann weiterhin ausgewÃ¤hlt werden.");
        }
      }catch(reason){
        if(!stopped){setState("error");setMessage(reason instanceof Error?reason.message:"RFID-Abfrage fehlgeschlagen")}
      }finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);return()=>{stopped=true;clearInterval(timer)};
  },[]);
  return <div className={`rfid-admin-login balance ${state}`} aria-live="polite"><span>{state==="success"?<IconCheck size={25}/>:state==="error"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span><div><strong>{state==="success"?"Mitglied erkannt":state==="checking"?"Leser wird geprÃ¼ft":state==="waiting"?"Chip auflegen":state==="unknown"?"Unbekannte Karte":"Leser nicht erreichbar"}</strong><small>{message}</small></div></div>;
}

export function RfidProfileLogin({profile,onVerified}:{profile:LoginProfile;onVerified:(member:Member)=>void}){
  const [message,setMessage]=useState("Verbindung zum RFID-Leser wird geprÃ¼ft.");
  const [state,setState]=useState<"checking"|"waiting"|"success"|"unknown"|"pin_required"|"error">("checking");
  const finished=useRef(false),holdUntil=useRef(0),onVerifiedRef=useRef(onVerified);
  useEffect(()=>{onVerifiedRef.current=onVerified},[onVerified]);
  useEffect(()=>{
    finished.current=false;holdUntil.current=0;
    let stopped=false,busy=false;
    const poll=async()=>{
      if(stopped||busy||finished.current||document.visibilityState!=="visible")return;
      busy=true;
      try{
        const query=new URLSearchParams({profileId:profile.id});
        const response=await fetch(`/api/rfid/login?${query}`,{cache:"no-store"}),data=await response.json();
        if(!response.ok)throw new Error(data.error||"RFID-Anmeldung ist momentan nicht erreichbar");
        if(stopped)return;
        if(data.state==="recognized"&&data.member){
          finished.current=true;setState("success");setMessage(`âœ“ ${data.member.name} erkannt. ${profile.shortName} wird geÃ¶ffnet.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},300);
        }else if(data.state==="unknown"){
          holdUntil.current=Date.now()+3500;setState("unknown");setMessage("Diese Karte ist diesem Profil noch nicht zugeordnet.");
        }else if(data.state==="pin_required"){
          holdUntil.current=Date.now()+3500;setState("pin_required");setMessage("Bei der Ersteinrichtung muss zuerst die neue Profil-PIN festgelegt werden.");
        }else if(Date.now()>=holdUntil.current){
          const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser verbunden Â· Mitgliedschip jetzt auflegen.":"Leser offline Â· Profil-PIN als RÃ¼ckfall verwenden.");
        }
      }catch(reason){
        if(!stopped){setState("error");setMessage(`${reason instanceof Error?reason.message:"Lesefehler"} Â· PIN funktioniert weiterhin.`)}
      }finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);return()=>{stopped=true;clearInterval(timer)};
  },[profile.id,profile.shortName]);
  return <div className={`rfid-admin-login profile-login ${state}`} aria-live="polite"><span>{state==="success"?<IconCheck size={25}/>:state==="error"||state==="pin_required"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span><div><strong>{state==="success"?"Chip erkannt":state==="checking"?"Leser wird geprÃ¼ft":state==="waiting"?"Mit Chip Ã¶ffnen":state==="unknown"?"Unbekannte Karte":state==="pin_required"?"PIN zuerst festlegen":"Leser nicht erreichbar"}</strong><small>{message}</small></div></di×O<¶‰ËkºwµçTô‰µ½‘…°µ±½Í”ˆ…É¥„µ±…‰•°ô‰•¹ÍÑ•ÈÍ¡±¥—}•¸ˆ½¹±¥¬õí½¹±½Í•ôû\ğ½‰ÕÑÑ½¸ø(€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰¥‘•¹Ñ¥Ñäµ¥½¸ˆøñ%½¹9™ŒÍ¥é”õìÈáô¼øğ½‘¥ØøñÀ±…ÍÍ9…µ”ô‰•å•‰É½ÜˆùI%µ-IQğ½Àøñ È¥ô‰É™¥µµ•µ‰•Èµ…ÉµÑ¥Ñ±”ˆùíµ•µ‰•È¹¹…µ•ôğ½ Èø(€€€€ñ‘¥Ø±…ÍÍ9…µ”õíÉ™¥µÁÉ½Ù¥Í¥½¸µÍÑ…Ñ”€‘íÁ¡…Í•õôøñÍÁ…¸ùíÁ¡…Í”ôôô‰ÍÕ•ÍÌˆü‹ŠrLˆéÁ¡…Í”ôôô‰•ÉÉ½Èˆüˆ„ˆè‹Š^$‰ôğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œùíÁ¡…Í”ôôô‰Í…¸ˆü‰1•Í•ÈÁËñ™•¸ˆéÁ¡…Í”ôôô‰É•…‘äˆü‰-…ÉÑ”•É­…¹¹ĞˆéÁ¡…Í”ôôô‰İÉ¥Ñ”ˆü‰¡¥À•É¹•ÕĞ…Õ™±••¸ˆéÁ¡…Í”ôôô‰ÍÕ•ÍÌˆü‰•ÉÑ¥œˆéÁ¡…Í”ôôô‰•ÉÉ½Èˆü‰9¥¡Ğ…‰•Í¡±½ÍÍ•¸ˆè‰	¥ÑÑ”İ…ÉÑ•¸‰ôğ½ÍÑÉ½¹œøñÍµ…±°ùíµ•ÍÍ…•ôğ½Íµ…±°øğ½‘¥Øøğ½‘¥Øø(€€€íÍ…¸˜™Á¡…Í”ôôô‰É•…‘äˆ˜˜ğøñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µÍ…¸µ…ÉˆøñÍÁ…¸ùU%ğ½ÍÁ…¸øñ½‘”ùíÍ…¸¹Õ¥‘ôğ½½‘”øñÍµ…±°ùíÍ…¸¹‘•Ù¥•9…µ•ôƒ
ÜíÍ…¸¹…É‘QåÁ•ñğ‰I%µ-…ÉÑ”‰ôğ½Íµ…±°øğ½‘¥Øø(€€€€€€ñ±…‰•°±…ÍÍ9…µ”ô‰É™¥µİÉ¥Ñ”µÑ½±”ˆøñ¥¹ÁÕĞÑåÁ”ô‰¡•­‰½àˆ¡•­•õíİÉ¥Ñ•¡¥Áô½¹¡…¹”õí•Ù•¹ĞôùÍ•Ñ]É¥Ñ•¡¥À¡•Ù•¹Ğ¹Ñ…É•Ğ¹¡•­•¥ô¼øñÍÁ…¸øñÍÑÉ½¹œù¡¥ÀéÕÏ‘Ñé±¥ ‰•Í¡É¥™Ñ•¸ğ½ÍÑÉ½¹œøñÍµ…±°ù=ÁÑ¥½¹…±•È±•Í‰…É•È!¥¹İ•¥Ì¸•±°-½¹Ñ½ÍÑ…¹Õ¹I•¡Ñ”‰±•¥‰•¸¥¸‘•È…Ñ•¹‰…¹¬¸ğ½Íµ…±°øğ½ÍÁ…¸øğ½±…‰•°ø(€€€€€íİÉ¥Ñ•¡¥À˜˜ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µİÉ¥Ñ”µ™¥•±‘Ìˆøñ±…‰•°ùÉ•¥•È…Ñ•¹‰±½¬ñÍ•±•ĞÙ…±Õ”õí‰±½­ô½¹¡…¹”õí•Ù•¹ĞôùÍ•Ñ	±½¬¡9Õµ‰•È¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¤¥ôùílĞ°Ô°Ø°à°ä°ÄÁt¹™¥±Ñ•È¡Ù…±Õ”ôø…Í…¸¹‰±½­ÍññÙ…±Õ”ñÍ…¸¹‰±½­Ì¤¹µ…À¡Ù…±Õ”ôøñ½ÁÑ¥½¸­•äõíÙ…±Õ•ôÙ…±Õ”õíÙ…±Õ•ôù	±½¬íÙ…±Õ•ôğ½½ÁÑ¥½¸ø¥ôğ½Í•±•Ğøğ½±…‰•°øñ±…‰•°ùQ•áĞ…Õ˜‘•´¡¥Àñ¥¹ÁÕĞÙ…±Õ”õíÑ•áÑô½¹¡…¹”õí•Ù•¹ĞôùÍ•ÑQ•áĞ¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ôµ…á1•¹Ñ õìÄÙô¼øñÍµ…±°±…ÍÍ9…µ”õíÑ•áÑ	åÑ•ÌøÄØü‰¥¹Ù…±¥ˆèˆ‰ôùíÑ•áÑ	åÑ•Íô¼ÄØ	åÑ”ğ½Íµ…±°øğ½±…‰•°øğ½‘¥Øùô(€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰½¹™¥É´µ…±±½…Ñ¥½¸ˆ‘¥Í…‰±•õíÑ•áÑ	åÑ•ÌøÄÙô½¹±¥¬õíÍ…Ù•ôùíİÉ¥Ñ•¡¥Àü‰iÕ½É‘¹•¸Õ¹¡¥À‰•Í¡É•¥‰•¸ˆè‰-…ÉÑ”éÕ½É‘¹•¸‰ôğ½‰ÕÑÑ½¸øğ¼ùô(€€€ì¡Á¡…Í”ôôô‰•ÉÉ½È‰ññÁ¡…Í”ôôô‰ÍÕ•ÍÌˆ¤˜˜ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µÁÉ½Ù¥Í¥½¸µ…Ñ¥½¹ÌˆùíÁ¡…Í”ôôô‰•ÉÉ½Èˆ˜˜ñ‰ÕÑÑ½¸½¹±¥¬õíÉ•Í•ÑôùÉ¹•ÕĞÙ•ÉÍÕ¡•¸ğ½‰ÕÑÑ½¸ùôñ‰ÕÑÑ½¸½¹±¥¬õí½¹±½Í•ôùM¡±¥—}•¸ğ½‰ÕÑÑ½¸øğ½‘¥Øùô(€€ğ½‘¥Øøğ½‘¥Øøì)ô()ÑåÁ”•Ù¥”õí¥éÍÑÉ¥¹œí¹…µ”éÍÑÉ¥¹œí¡…É‘İ…É•%üéÍÑÉ¥¹ñ¹Õ±°í™¥Éµİ…É•Y•ÉÍ¥½¸üéÍÑÉ¥¹ñ¹Õ±°í…Ñ¥Ù”é‰½½±•…¹ñ¹Õµ‰•Èí±…ÍÑM••¹ĞüéÍÑÉ¥¹ñ¹Õ±°íÉ•…Ñ•‘ĞéÍÑÉ¥¹ôì)ÑåÁ”…É‘5…ÁÁ¥¹œõíÕ¥éÍÑÉ¥¹œíµ•µ‰•É%éÍÑÉ¥¹œíµ•µ‰•É9…µ”éÍÑÉ¥¹œíÕÁ‘…Ñ•‘ĞéÍÑÉ¥¹ôì)ÑåÁ”A…¥É¥¹œõí¥éÍÑÉ¥¹œí¡…É‘İ…É•%éÍÑÉ¥¹œí¹…µ”éÍÑÉ¥¹œíÉ•…Ñ•‘ĞéÍÑÉ¥¹œí•áÁ¥É•ÍĞéÍÑÉ¥¹ôì)½¹ÍĞ±…Ñ•ÍÑI™¥‘¥Éµİ…É”ôˆÄ¸Ø¸Àˆì()•áÁ½ÉĞ™Õ¹Ñ¥½¸I™¥‘•Ù¥•A…¹•° ¥ì(€½¹ÍĞm‘•Ù¥•Ì±Í•Ñ•Ù¥•ÍtõÕÍ•MÑ…Ñ”ñ•Ù¥•mtø¡mt¤±m…É‘Ì±Í•Ñ…É‘ÍtõÕÍ•MÑ…Ñ”ñ…É‘5…ÁÁ¥¹mtø¡mt¤±mÁ…¥É¥¹Ì±Í•ÑA…¥É¥¹ÍtõÕÍ•MÑ…Ñ”ñA…¥É¥¹mtø¡mt¤±mÁ…¥É½‘•Ì±Í•ÑA…¥É½‘•ÍtõÕÍ•MÑ…Ñ”ñI•½ÉñÍÑÉ¥¹œ±ÍÑÉ¥¹œøø¡íô¤ì(€½¹ÍĞm¹…µ”±Í•Ñ9…µ•tõÕÍ•MÑ…Ñ” ‰I%µ1•Í•ÈY•É•¥¹Í¡•¥´ˆ¤±mÑ½­•¸±Í•ÑQ½­•¹tõÕÍ•MÑ…Ñ” ˆˆ¤±m•ÉÉ½È±Í•ÑÉÉ½ÉtõÕÍ•MÑ…Ñ” ˆˆ¤±m¹½Ñ¥”±Í•Ñ9½Ñ¥•tõÕÍ•MÑ…Ñ” ˆˆ¤±m‰ÕÍä±Í•Ñ	ÕÍåtõÕÍ•MÑ…Ñ”¡™…±Í”¤±mÁ…¥É¥¹	ÕÍä±Í•ÑA…¥É¥¹	ÕÍåtõÕÍ•MÑ…Ñ”ñÍÑÉ¥¹ñ¹Õ±°ø¡¹Õ±°¤±mÉ•ÍÑ…ÉÑ¥¹œ±Í•ÑI•ÍÑ…ÉÑ¥¹tõÕÍ•MÑ…Ñ”ñÍÑÉ¥¹ñ¹Õ±°ø¡¹Õ±°¤±mÕÁ‘…Ñ¥¹œ±Í•ÑUÁ‘…Ñ¥¹tõÕÍ•MÑ…Ñ”ñÍÑÉ¥¹ñ¹Õ±°ø¡¹Õ±°¤±m½Á¥•±Í•Ñ½Á¥•‘tõÕÍ•MÑ…Ñ”¡™…±Í”¤ì(€½¹ÍĞ±½…õ…Íå¹Œ ¤ôùíÑÉåí½¹ÍĞm‘•Ù¥•I•ÍÁ½¹Í”±Á…¥ÉI•ÍÁ½¹Í•tõ…İ…¥ĞAÉ½µ¥Í”¹…±°¡m™•Ñ  ˆ½…Á¤½É™¥½‘•Ù¥•Ìˆ±í…¡”è‰¹¼µÍÑ½É”‰ô¤±™•Ñ  ˆ½…Á¤½É™¥½Á…¥Èˆ±í…¡”è‰¹¼µÍÑ½É”‰ô¥t¤±m‘•Ù¥•…Ñ„±Á…¥É…Ñ…tõ…İ…¥ĞAÉ½µ¥Í”¹…±°¡m‘•Ù¥•I•ÍÁ½¹Í”¹©Í½¸ ¤±Á…¥ÉI•ÍÁ½¹Í”¹©Í½¸ ¥t¤í¥˜ …‘•Ù¥•I•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡‘•Ù¥•…Ñ„¹•ÉÉ½È¤í¥˜ …Á…¥ÉI•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡Á…¥É…Ñ„¹•ÉÉ½È¤íÍ•Ñ•Ù¥•Ì¡‘•Ù¥•…Ñ„¹‘•Ù¥•Íññmt¤íÍ•Ñ…É‘Ì¡‘•Ù¥•…Ñ„¹…É‘Íññmt¤íÍ•ÑA…¥É¥¹Ì¡Á…¥É…Ñ„¹Á…¥É¥¹Íññmt¥õ…Ñ ¡É•…Í½¸¥íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰I%µ1•Í•È­½¹¹Ñ•¸¹¥¡Ğ•±…‘•¸İ•É‘•¸ˆ¥õôì(€ÕÍ•™™•Ğ  ¤ôùí±•ĞÍÑ½ÁÁ•õ™…±Í”í½¹ÍĞÉ•™É•Í ô ¤ôùí¥˜ …ÍÑ½ÁÁ•¥Ù½¥±½… ¥ôíÉ•™É•Í  ¤í½¹ÍĞÑ¥µ•ÈõÍ•Ñ%¹Ñ•ÉÙ…°¡É•™É•Í °ÈÀÀÀ¤íÉ•ÑÕÉ¸ ¤ôùíÍÑ½ÁÁ•õÑÉÕ”í±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¥õô±mt¤ì(€½¹ÍĞÉ•…Ñ”õ…Íå¹Œ ¤ôùí¥˜¡¹…µ”¹ÑÉ¥´ ¤¹±•¹Ñ ğÍññ‰ÕÍä¥É•ÑÕÉ¸íÍ•Ñ	ÕÍä¡ÑÉÕ”¤íÍ•ÑÉÉ½È ˆˆ¤íÑÉåí½¹ÍĞÉ•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ  ˆ½…Á¤½É™¥½‘•Ù¥•Ìˆ±íµ•Ñ¡½è‰A=MPˆ±¡•…‘•ÉÌéì‰½¹Ñ•¹ĞµÑåÁ”ˆè‰…ÁÁ±¥…Ñ¥½¸½©Í½¸‰ô±‰½‘äé)M=8¹ÍÑÉ¥¹¥™ä¡í¹…µ”é¹…µ”¹ÑÉ¥´ ¥ô¥ô¤±‘…Ñ„õ…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …É•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡‘…Ñ„¹•ÉÉ½È¤íÍ•ÑQ½­•¸¡‘…Ñ„¹Ñ½­•¸¤íÍ•Ñ½Á¥•¡™…±Í”¤íÍ•Ñ9…µ” ‰I%µ1•Í•ÈY•É•¥¹Í¡•¥´ˆ¤í…İ…¥Ğ±½… ¥õ…Ñ ¡É•…Í½¸¥íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰¥¹É¥¡ÑÕ¹œ™•¡±•Í¡±…•¸ˆ¥õ™¥¹…±±åíÍ•Ñ	ÕÍä¡™…±Í”¥õôì(€½¹ÍĞ…ÁÁÉ½Ù•A…¥É¥¹œõ…Íå¹Œ¡Á…¥É¥¹œéA…¥É¥¹œ¤ôùí½¹ÍĞ½‘”ô¡Á…¥É½‘•ÍmÁ…¥É¥¹œ¹¥‘uñğˆˆ¤¹É•Á±…” ½q½œ°ˆˆ¤í¥˜¡½‘”¹±•¹Ñ „ôôÙññÁ…¥É¥¹	ÕÍä¥É•ÑÕÉ¸íÍ•ÑA…¥É¥¹	ÕÍä¡Á…¥É¥¹œ¹¥¤íÍ•ÑÉÉ½È ˆˆ¤íÍ•Ñ9½Ñ¥” ˆˆ¤íÑÉåí½¹ÍĞÉ•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ  ˆ½…Á¤½É™¥½Á…¥Èˆ±íµ•Ñ¡½è‰AUPˆ±¡•…‘•ÉÌéì‰½¹Ñ•¹ĞµÑåÁ”ˆè‰…ÁÁ±¥…Ñ¥½¸½©Í½¸‰ô±‰½‘äé)M=8¹ÍÑÉ¥¹¥™ä¡í¥éÁ…¥É¥¹œ¹¥±½‘”±¹…µ”éÁ…¥É¥¹œ¹¹…µ•ô¥ô¤±‘…Ñ„õ…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …É•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡‘…Ñ„¹•ÉÉ½È¤íÍ•ÑA…¥É½‘•Ì¡ÕÉÉ•¹Ğôùí½¹ÍĞ¹•áĞõì¸¸¹ÕÉÉ•¹Ñôí‘•±•Ñ”¹•áÑmÁ…¥É¥¹œ¹¥‘tíÉ•ÑÕÉ¸¹•áÑô¤íÍ•Ñ9½Ñ¥”¡€‘íÁ…¥É¥¹œ¹¹…µ•ôİÕÉ‘”Í¥¡•È™É•¥••‰•¸¸•È1•Í•Èƒñ‰•É¹¥µµĞ‘¥”¹µ•±‘Õ¹œ…ÕÑ½µ…Ñ¥Í ¹€¤í…İ…¥Ğ±½… ¥õ…Ñ ¡É•…Í½¸¥íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰-½ÁÁ±Õ¹œ™•¡±•Í¡±…•¸ˆ¥õ™¥¹…±±åíÍ•ÑA…¥É¥¹	ÕÍä¡¹Õ±°¥õôì(€½¹ÍĞÉ•©•ÑA…¥É¥¹œõ…Íå¹Œ¡Á…¥É¥¹œéA…¥É¥¹œ¤ôùí¥˜¡Á…¥É¥¹	ÕÍä¥É•ÑÕÉ¸íÍ•ÑA…¥É¥¹	ÕÍä¡Á…¥É¥¹œ¹¥¤íÍ•ÑÉÉ½È ˆˆ¤íÑÉåí½¹ÍĞÉ•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ  ˆ½…Á¤½É™¥½Á…¥Èˆ±íµ•Ñ¡½è‰1Qˆ±¡•…‘•ÉÌéì‰½¹Ñ•¹ĞµÑåÁ”ˆè‰…ÁÁ±¥…Ñ¥½¸½©Í½¸‰ô±‰½‘äé)M=8¹ÍÑÉ¥¹¥™ä¡í¥éÁ…¥É¥¹œ¹¥‘ô¥ô¤±‘…Ñ„õ…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …É•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡‘…Ñ„¹•ÉÉ½È¤í…İ…¥Ğ±½… ¥õ…Ñ ¡É•…Í½¸¥íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰-½ÁÁ±Õ¹œ­½¹¹Ñ”¹¥¡ĞÙ•Éİ½É™•¸İ•É‘•¸ˆ¥õ™¥¹…±±åíÍ•ÑA…¥É¥¹	ÕÍä¡¹Õ±°¥õôì(€½¹ÍĞÑ½±”õ…Íå¹Œ¡‘•Ù¥”é•Ù¥”¤ôùí½¹ÍĞÉ•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ  ˆ½…Á¤½É™¥½‘•Ù¥•Ìˆ±íµ•Ñ¡½è‰AQ ˆ±¡•…‘•ÉÌéì‰½¹Ñ•¹ĞµÑåÁ”ˆè‰…ÁÁ±¥…Ñ¥½¸½©Í½¸‰ô±‰½‘äé)M=8¹ÍÑÉ¥¹¥™ä¡í¥é‘•Ù¥”¹¥±…Ñ¥Ù”è…	½½±•…¸¡‘•Ù¥”¹…Ñ¥Ù”¥ô¥ô¤±‘…Ñ„õ…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …É•ÍÁ½¹Í”¹½¬¥íÍ•ÑÉÉ½È¡‘…Ñ„¹•ÉÉ½Éñğ‹¹‘•ÉÕ¹œ™•¡±•Í¡±…•¸ˆ¤íÉ•ÑÕÉ¹õ±½… ¥ôì(€€¼¼•Í±¥¹Ğµ‘¥Í…‰±”µ¹•áĞµ±¥¹”É•…Ğµ¡½½­Ì½ÁÕÉ¥Ñä€´´i•¥Ñµ•ÍÍÕ¹œÍÑ…ÉÑ•Ğ…ÕÍÍ¡±¥—}±¥ ¹… ‘•´-±¥¬…Õ˜ƒŠy9•ÔÍÑ…ÉÑ•»Šp¸(€½¹ÍĞÉ•ÍÑ…ÉĞõ…Íå¹Œ¡‘•Ù¥”é•Ù¥”¤ôùí¥˜¡É•ÍÑ…ÉÑ¥¹ñğ…½¹™¥É´¡€‘í‘•Ù¥”¹¹…µ•ô¹•ÔÍÑ…ÉÑ•¸ü•È1•Í•È¥ÍĞ›ñÈ•Ñİ„€ÄÔM•­Õ¹‘•¸¹¥¡ĞÙ•É›ñ‰…È¹€¤¥É•ÑÕÉ¸íÍ•ÑI•ÍÑ…ÉÑ¥¹œ¡‘•Ù¥”¹¥¤íÍ•ÑÉÉ½È ˆˆ¤íÍ•Ñ9½Ñ¥” ˆˆ¤íÑÉåí½¹ÍĞÉ•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ  ˆ½…Á¤½É™¥½½µµ…¹‘Ìˆ±íµ•Ñ¡½è‰AUPˆ±¡•…‘•ÉÌéì‰½¹Ñ•¹ĞµÑåÁ”ˆè‰…ÁÁ±¥…Ñ¥½¸½©Í½¸‰ô±‰½‘äé)M=8¹ÍÑÉ¥¹¥™ä¡í‘•Ù¥•%é‘•Ù¥”¹¥‘ô¥ô¤±‘…Ñ„õ…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …É•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡‘…Ñ„¹•ÉÉ½Éñğ‰9•ÕÍÑ…ÉĞ­½¹¹Ñ”¹¥¡Ğ•Í•¹‘•Ğİ•É‘•¸ˆ¤í½¹ÍĞÍÑ…ÉÑ•õ…Ñ”¹¹½Ü ¤í½¹ÍĞÑ¥µ•ÈõÍ•Ñ%¹Ñ•ÉÙ…°¡…Íå¹Œ ¤ôùíÑÉåí½¹ÍĞÍÑ…ÑÕÍI•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ ¡€½…Á¤½É™¥½½µµ…¹‘Ìı¥ô‘í•¹½‘•UI%½µÁ½¹•¹Ğ¡‘…Ñ„¹¥¥õ€±í…¡”è‰¹¼µÍÑ½É”‰ô¤±ÍÑ…ÑÕÍ…Ñ„õ…İ…¥ĞÍÑ…ÑÕÍI•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …ÍÑ…ÑÕÍI•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡ÍÑ…ÑÕÍ…Ñ„¹•ÉÉ½È¤í¥˜¡ÍÑ…ÑÕÍ…Ñ„¹½µµ…¹ü¹ÍÑ…ÑÕÌôôô‰ÍÕ••‘•ˆ¥í±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤íÍ•ÑI•ÍÑ…ÉÑ¥¹œ¡¹Õ±°¤íÍ•Ñ9½Ñ¥”¡€‘í‘•Ù¥”¹¹…µ•ôÍÑ…ÉÑ•Ğ¹•Ô¸¥”Y•É‰¥¹‘Õ¹œÍ½±±Ñ”¥¸•Ñİ„€ÄÔM•­Õ¹‘•¸İ¥•‘•È‰•É•¥ĞÍ•¥¸¹€¤íÍ•ÑQ¥µ•½ÕĞ¡±½…°ÄÔÀÀÀ¥õ•±Í”¥˜¡l‰™…¥±•ˆ°‰•áÁ¥É•‰t¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÍ…Ñ„¹½µµ…¹ü¹ÍÑ…ÑÕÌ¥ññ…Ñ”¹¹½Ü ¤µÍÑ…ÉÑ•øĞÀÀÀÀ¥í±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤íÍ•ÑI•ÍÑ…ÉÑ¥¹œ¡¹Õ±°¤íÍ•ÑÉÉ½È¡ÍÑ…ÑÕÍ…Ñ„¹½µµ…¹ü¹•ÉÉ½Éñğ‰•È1•Í•È¡…Ğ‘•¸9•ÕÍÑ…ÉÑ…Õ™ÑÉ…œ¹¥¡ĞÉ•¡Ñé•¥Ñ¥œ…‰•¡½±Ğ¸ˆ¥õõ…Ñ ¡É•…Í½¸¥í±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤íÍ•ÑI•ÍÑ…ÉÑ¥¹œ¡¹Õ±°¤íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰9•ÕÍÑ…ÉÑÍÑ…ÑÕÌ­½¹¹Ñ”¹¥¡Ğ•ÁËñ™Ğİ•É‘•¸ˆ¥õô°ÄÀÀÀ¥õ…Ñ ¡É•…Í½¸¥íÍ•ÑI•ÍÑ…ÉÑ¥¹œ¡¹Õ±°¤íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰9•ÕÍÑ…ÉĞ™•¡±•Í¡±…•¸ˆ¥õôì(€€¼¼•Í±¥¹Ğµ‘¥Í…‰±”µ¹•áĞµ±¥¹”É•…Ğµ¡½½­Ì½ÁÕÉ¥Ñä€´´i•¥Ñµ•ÍÍÕ¹œÍÑ…ÉÑ•Ğ…ÕÍÍ¡±¥—}±¥ ¹… ‘•´‰•ÍÓ‘Ñ¥Ñ•¸UÁ‘…Ñ”µ-±¥¬¸(€½¹ÍĞÕÁ‘…Ñ•¥Éµİ…É”õ…Íå¹Œ¡‘•Ù¥”é•Ù¥”¤ôùí¥˜¡ÕÁ‘…Ñ¥¹ñğ…‘•Ù¥”¹™¥Éµİ…É•Y•ÉÍ¥½¹ñğ…½¹™¥É´¡€‘í‘•Ù¥”¹¹…µ•ô…Õ˜¥Éµİ…É”€‘í±…Ñ•ÍÑI™¥‘¥Éµİ…É•ô…­ÑÕ…±¥Í¥•É•¸ü•È1•Í•ÈÍÑ…ÉÑ•Ğ‘…¹… …ÕÑ½µ…Ñ¥Í ¹•Ô¹€¤¥É•ÑÕÉ¸íÍ•ÑUÁ‘…Ñ¥¹œ¡‘•Ù¥”¹¥¤íÍ•ÑÉÉ½È ˆˆ¤íÍ•Ñ9½Ñ¥” ˆˆ¤íÑÉåí½¹ÍĞÉ•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ  ˆ½…Á¤½É™¥½½µµ…¹‘Ìˆ±íµ•Ñ¡½è‰AUPˆ±¡•…‘•ÉÌéì‰½¹Ñ•¹ĞµÑåÁ”ˆè‰…ÁÁ±¥…Ñ¥½¸½©Í½¸‰ô±‰½‘äé)M=8¹ÍÑÉ¥¹¥™ä¡í‘•Ù¥•%é‘•Ù¥”¹¥±…Ñ¥½¸è‰™¥Éµİ…É”‰ô¥ô¤±‘…Ñ„õ…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …É•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡‘…Ñ„¹•ÉÉ½Éñğ‰¥Éµİ…É•ÕÁ‘…Ñ”­½¹¹Ñ”¹¥¡Ğ•Í•¹‘•Ğİ•É‘•¸ˆ¤í½¹ÍĞÍÑ…ÉÑ•õ…Ñ”¹¹½Ü ¤í½¹ÍĞÑ¥µ•ÈõÍ•Ñ%¹Ñ•ÉÙ…°¡…Íå¹Œ ¤ôùíÑÉåí½¹ÍĞÍÑ…ÑÕÍI•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ ¡€½…Á¤½É™¥½½µµ…¹‘Ìı¥ô‘í•¹½‘•UI%½µÁ½¹•¹Ğ¡‘…Ñ„¹¥¥õ€±í…¡”è‰¹¼µÍÑ½É”‰ô¤±ÍÑ…ÑÕÍ…Ñ„õ…İ…¥ĞÍÑ…ÑÕÍI•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …ÍÑ…ÑÕÍI•ÍÁ½¹Í”¹½¬¥Ñ¡É½Ü¹•ÜÉÉ½È¡ÍÑ…ÑÕÍ…Ñ„¹•ÉÉ½È¤í¥˜¡ÍÑ…ÑÕÍ…Ñ„¹½µµ…¹ü¹ÍÑ…ÑÕÌôôô‰ÍÕ••‘•ˆ¥í±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤íÍ•ÑUÁ‘…Ñ¥¹œ¡¹Õ±°¤íÍ•Ñ9½Ñ¥”¡€‘í‘•Ù¥”¹¹…µ•ô¡…Ğ¥Éµİ…É”€‘í±…Ñ•ÍÑI™¥‘¥Éµİ…É•ô¥¹ÍÑ…±±¥•ÉĞÕ¹ÍÑ…ÉÑ•Ğ¹•Ô¹€¤íÍ•ÑQ¥µ•½ÕĞ¡±½…°ÄàÀÀÀ¥õ•±Í”¥˜¡l‰™…¥±•ˆ°‰•áÁ¥É•‰t¹¥¹±Õ‘•Ì¡ÍÑ…ÑÕÍ…Ñ„¹½µµ…¹ü¹ÍÑ…ÑÕÌ¥ññ…Ñ”¹¹½Ü ¤µÍÑ…ÉÑ•øÈÌÀÀÀÀ¥í±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤íÍ•ÑUÁ‘…Ñ¥¹œ¡¹Õ±°¤íÍ•ÑÉÉ½È¡ÍÑ…ÑÕÍ…Ñ„¹½µµ…¹ü¹•ÉÉ½Éñğ‰…Ì¥Éµİ…É•ÕÁ‘…Ñ”İÕÉ‘”¹¥¡Ğ…‰•Í¡±½ÍÍ•¸¸ˆ¥õõ…Ñ ¡É•…Í½¸¥í±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤íÍ•ÑUÁ‘…Ñ¥¹œ¡¹Õ±°¤íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰UÁ‘…Ñ•ÍÑ…ÑÕÌ­½¹¹Ñ”¹¥¡Ğ•ÁËñ™Ğİ•É‘•¸ˆ¥õô°ÄÔÀÀ¥õ…Ñ ¡É•…Í½¸¥íÍ•ÑUÁ‘…Ñ¥¹œ¡¹Õ±°¤íÍ•ÑÉÉ½È¡É•…Í½¸¥¹ÍÑ…¹•½˜ÉÉ½ÈıÉ•…Í½¸¹µ•ÍÍ…”è‰¥Éµİ…É•ÕÁ‘…Ñ”™•¡±•Í¡±…•¸ˆ¥õôì(€½¹ÍĞÕ¹…ÍÍ¥¸õ…Íå¹Œ¡…Éé…É‘5…ÁÁ¥¹œ¤ôùí¥˜ …½¹™¥É´¡-…ÉÑ”€‘í…É¹Õ¥‘ôÙ½¸€‘í…É¹µ•µ‰•É9…µ•ôÑÉ•¹¹•¸ı€¤¥É•ÑÕÉ¸í½¹ÍĞÉ•ÍÁ½¹Í”õ…İ…¥Ğ™•Ñ  ˆ½…Á¤½É™¥½‘•Ù¥•Ìˆ±íµ•Ñ¡½è‰1Qˆ±¡•…‘•ÉÌéì‰½¹Ñ•¹ĞµÑåÁ”ˆè‰…ÁÁ±¥…Ñ¥½¸½©Í½¸‰ô±‰½‘äé)M=8¹ÍÑÉ¥¹¥™ä¡íÕ¥é…É¹Õ¥‘ô¥ô¤±‘…Ñ„õ…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤í¥˜ …É•ÍÁ½¹Í”¹½¬¥íÍ•ÑÉÉ½È¡‘…Ñ„¹•ÉÉ½Éñğ‰iÕ½É‘¹Õ¹œ­½¹¹Ñ”¹¥¡Ğ•¹Ñ™•É¹Ğİ•É‘•¸ˆ¤íÉ•ÑÕÉ¹õ±½… ¥ôì(€½¹ÍĞ½ÁåQ½­•¸õ…Íå¹Œ ¤ôùíÑÉåí…İ…¥Ğ¹…Ù¥…Ñ½È¹±¥Á‰½…É¹İÉ¥Ñ•Q•áĞ¡Ñ½­•¸¤íÍ•Ñ½Á¥•¡ÑÉÕ”¥õ…Ñ¡íÍ•ÑÉÉ½È ‰•Ë‘Ñ•­•¹¹Õ¹œ­½¹¹Ñ”¹¥¡Ğ­½Á¥•ÉĞİ•É‘•¸ˆ¥õôì(€½¹ÍĞ•¹‘Á½¥¹ĞõÑåÁ•½˜±½…Ñ¥½¸ôôô‰Õ¹‘•™¥¹•ˆüˆ½…Á¤½É™¥ˆé€‘í±½…Ñ¥½¸¹½É¥¥¹ô½…Á¤½É™¥‘€ì(€É•ÑÕÉ¸€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰Á…¹•°É™¥µ‘•Ù¥”µÁ…¹•°ˆøñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µ¡•…ˆøñ‘¥ØøñÀ±…ÍÍ9…µ”ô‰•å•‰É½ÜˆùaQI9H-IQ91MHğ½Àøñ ÈùM@àÈØØ€¬5IÔÈÈğ½ Èøğ½‘¥ØøñÍÁ…¸øñ%½¹]¥™¤Í¥é”õìÈÁô¼ø=¡¹”A­½ÁÁ•±¸ğ½ÍÁ…¸øğ½‘¥Øø(€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µ…É¡¥Ñ•ÑÕÉ”ˆøñ%½¹9™ŒÍ¥é”õìÈáô¼øñ‘¥ØøñÍÑÉ½¹œùµÁ™½¡±•¹”Y•É‰¥¹‘Õ¹œğ½ÍÑÉ½¹œøñÍµ…±°ùM@àÈØØÕ¹Q…‰±•Ğ¹ÕÑé•¸‘…ÍÍ•±‰”Y•É•¥¹Ìµ]18¸•È1•Í•ÈÍ•¹‘•Ğ¹ÕÈ‘¥”U%Á•È!QQAL…¸‘¥”Y•É•¥¹Í­…ÍÍ”ƒŠL‘•È	É½İÍ•ÈÉ•¥™Ğ¹¥¡Ğ…Õ˜€ÄäÈ¸ÄØà¸Ğ¸ÄéÔ¸ğ½Íµ…±°øğ½‘¥Øøğ½‘¥Øø(€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µÍ•ÕÉ¥Ñäµ¹½Ñ”ˆøñÍÑÉ½¹œù¥”-…ÉÑ”ÍÁ•¥¡•ÉĞİ•‘•È•±¹½ 	•É•¡Ñ¥Õ¹•¸¸ğ½ÍÑÉ½¹œøñÍµ…±°ù¥”U%•É­•¹¹Ğ¹ÕÈ‘¥”éÕ•½É‘¹•Ñ”A•ÉÍ½¸¸-½¹Ñ½ÍÓ‘¹‘”°AÉ•¥Í”Õ¹•¥¸·Ù±¥¡•È‘µ¥¹éÕ…¹œİ•É‘•¸‰•¤©•‘•´M…¸…ÕÍÍ¡±¥—}±¥ ¥¸‘•È…Ñ•¹‰…¹¬•ÁËñ™Ğ¸ğ½Íµ…±°øğ½‘¥Øø(€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µÁ…¥É¥¹œµÕ¥‘”ˆøñÍÑÉ½¹œù1•Í•È¥¸‘É•¤M¡É¥ÑÑ•¸Ù•É‰¥¹‘•¸ğ½ÍÑÉ½¹œøñ½°øñ±¤ù±Õ‰%Dµi•ÉÑ¥™¥­…Ğ•¥¹µ…°Õ¹Ñ•È€ñ½‘”ù¡ÑÑÀè¼½Ù•É•¥¹Í­…ÍÍ”¹±½…°èàÀàÀ½Ù•É•¥¹Í­…ÍÍ”µ„¹ÉĞğ½½‘”ø¡•ÉÕ¹Ñ•É±…‘•¸¸ğ½±¤øñ±¤ù5¥Ğ€ñˆù9µI•…‘•È·Š˜ğ½ˆøÙ•É‰¥¹‘•¸°€ñ½‘”ù¡ÑÑÀè¼¼ÄäÈ¸ÄØà¸Ğ¸Äğ½½‘”øƒÙ™™¹•¸Õ¹‘½ÉĞ]18°-•¹¹İ½ÉĞÕ¹i•ÉÑ¥™¥­…ÑÍ‘…Ñ•¤…ÕÍß‘¡±•¸¸ğ½±¤øñ±¤øñˆù1•Í•ÈÙ•É‰¥¹‘•¸ğ½ˆø‘Ëñ­•¸Õ¹‘•¸…¹•é•¥Ñ•¸½‘”¡¥•È‰•ÍÓ‘Ñ¥•¸¸ğ½±¤øğ½½°øñÍµ…±°ùi¥•±…‘É•ÍÍ”è€ñ½‘”ùí•¹‘Á½¥¹Ñôğ½½‘”ø¸Q½­•¸Õ¹i•ÉÑ¥™¥­…ÑÍÑ•áĞİ•É‘•¸…ÕÑ½µ…Ñ¥Í •¥¹•É¥¡Ñ•Ğ¸ğ½Íµ…±°øğ½‘¥Øø(€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µÁ…¥É¥¹œµ±¥ÍĞˆùíÁ…¥É¥¹Ì¹µ…À¡Á…¥É¥¹œôøñ…ÉÑ¥±”­•äõíÁ…¥É¥¹œ¹¥‘ôøñÍÁ…¸øñ%½¹]¥™¤Í¥é”õìÈÉô¼øğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œùíÁ…¥É¥¹œ¹¹…µ•ôğ½ÍÑÉ½¹œøñÍµ…±°ùíÁ…¥É¥¹œ¹¡…É‘İ…É•%‘ôƒ
Ü½‘”…´1•Í•ÈÁËñ™•¸ƒ
ÜŸñ±Ñ¥œ‰¥Ìí¹•Ü…Ñ”¡Á…¥É¥¹œ¹•áÁ¥É•ÍĞ¤¹Ñ½1½…±•Q¥µ•MÑÉ¥¹œ ‰‘”µˆ±í¡½ÕÈèˆÈµ‘¥¥Ğˆ±µ¥¹ÕÑ”èˆÈµ‘¥¥Ğ‰ô¥ôğ½Íµ…±°øğ½‘¥Øøñ¥¹ÁÕĞ…É¥„µ±…‰•°õí-½ÁÁ±Õ¹Í½‘”›ñÈ€‘íÁ…¥É¥¹œ¹¹…µ•õô¥¹ÁÕÑ5½‘”ô‰¹Õµ•É¥Œˆ…ÕÑ½½µÁ±•Ñ”ô‰½¹”µÑ¥µ”µ½‘”ˆµ…á1•¹Ñ õìÙôÁ±…•¡½±‘•ÈôˆØµÍÑ•±±¥•È½‘”ˆÙ…±Õ”õíÁ…¥É½‘•ÍmÁ…¥É¥¹œ¹¥‘uñğˆ‰ô½¹¡…¹”õí•Ù•¹ĞôùÍ•ÑA…¥É½‘•Ì¡ÕÉÉ•¹Ğôø¡ì¸¸¹ÕÉÉ•¹Ğ±mÁ…¥É¥¹œ¹¥‘té•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¹É•Á±…” ½q½œ°ˆˆ¤¹Í±¥” À°Ø¥ô¤¥ô¼øñ‘¥Øøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰Í•½¹‘…Éäˆ‘¥Í…‰±•õí	½½±•…¸¡Á…¥É¥¹	ÕÍä¥ô½¹±¥¬õì ¤ôùÉ•©•ÑA…¥É¥¹œ¡Á…¥É¥¹œ¥ôùY•Éİ•É™•¸ğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸‘¥Í…‰±•õí	½½±•…¸¡Á…¥É¥¹	ÕÍä¥ñğ¡Á…¥É½‘•ÍmÁ…¥É¥¹œ¹¥‘uñğˆˆ¤¹±•¹Ñ „ôôÙô½¹±¥¬õì ¤ôù…ÁÁÉ½Ù•A…¥É¥¹œ¡Á…¥É¥¹œ¥ôùíÁ…¥É¥¹	ÕÍäôôõÁ…¥É¥¹œ¹¥ü‰]¥É•­½ÁÁ•±ĞƒŠ˜ˆè‰É•¥•‰•¸‰ôğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½…ÉÑ¥±”ø¥õì…Á…¥É¥¹Ì¹±•¹Ñ ˜˜ñÀù-•¥¸¹•Õ•È1•Í•Èİ…ÉÑ•Ğ…Õ˜É•¥…‰”¸MÑ…ÉÑ”‘¥”-½ÁÁ±Õ¹œéÕ•ÉÍĞ…Õ˜‘•È]…ÉÑÕ¹ÍÍ•¥Ñ”‘•Ì1•Í•ÉÌ¸ğ½Àùôğ½‘¥Øø(€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µ‘•Ù¥”µ±¥ÍĞˆùí‘•Ù¥•Ì¹µ…À¡‘•Ù¥”ôøñ…ÉÑ¥±”­•äõí‘•Ù¥”¹¥‘ô±…ÍÍ9…µ”õí‘•Ù¥”¹…Ñ¥Ù”üˆˆè‰¥¹…Ñ¥Ù”‰ôøñÍÁ…¸øñ%½¹9™ŒÍ¥é”õìÈÉô¼øğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œùí‘•Ù¥”¹¹…µ•ôğ½ÍÑÉ½¹œøñÍµ…±°ùí‘•Ù¥”¹¡…É‘İ…É•%ı€‘í‘•Ù¥”¹¡…É‘İ…É•%‘ôƒ
Ü€èˆ‰õí‘•Ù¥”¹±…ÍÑM••¹ĞıiÕ±•ÑéĞÙ•É‰Õ¹‘•¸è€‘í¹•Ü…Ñ”¡‘•Ù¥”¹±…ÍÑM••¹Ğ¤¹Ñ½1½…±•MÑÉ¥¹œ ‰‘”µˆ¥õ€è‰9½ ­•¥¸M…¸•µÁ™…¹•¸‰ôğ½Íµ…±°øñÍµ…±°±…ÍÍ9…µ”ô‰É™¥µ™¥Éµİ…É”µÍÑ…Ñ”ˆùí‘•Ù¥”¹™¥Éµİ…É•Y•ÉÍ¥½¸ı¥Éµİ…É”€‘í‘•Ù¥”¹™¥Éµİ…É•Y•ÉÍ¥½¹ô‘í‘•Ù¥”¹™¥Éµİ…É•Y•ÉÍ¥½¸ôôõ±…Ñ•ÍÑI™¥‘¥Éµİ…É”üˆƒ
Ü…­ÑÕ•±°ˆèˆƒ
ÜUÁ‘…Ñ”Ù•É›ñ‰…È‰õ€è‰±Ñ”¥Éµİ…É”ƒ
Ü•¥¹µ…±¥•ÌUMµUÁ‘…Ñ”•É™½É‘•É±¥ ‰ôğ½Íµ…±°øğ½‘¥Øøñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µ‘•Ù¥”µ…Ñ¥½¹Ìˆøñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰™¥Éµİ…É”ˆ‘¥Í…‰±•õì…‘•Ù¥”¹…Ñ¥Ù•ñğ…‘•Ù¥”¹™¥Éµİ…É•Y•ÉÍ¥½¹ññ‘•Ù¥”¹™¥Éµİ…É•Y•ÉÍ¥½¸ôôõ±…Ñ•ÍÑI™¥‘¥Éµİ…É•ññ	½½±•…¸¡ÕÁ‘…Ñ¥¹œ¥ññ	½½±•…¸¡É•ÍÑ…ÉÑ¥¹œ¥ô½¹±¥¬õì ¤ôùÕÁ‘…Ñ•¥Éµİ…É”¡‘•Ù¥”¥ôøñ%½¹I•™É•Í Í¥é”õìÄİô¼ùíÕÁ‘…Ñ¥¹œôôõ‘•Ù¥”¹¥ü‰UÁ‘…Ñ”³‘Õ™ĞƒŠ˜ˆè‰¥Éµİ…É”…­ÑÕ…±¥Í¥•É•¸‰ôğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰É•ÍÑ…ÉĞˆ‘¥Í…‰±•õì…‘•Ù¥”¹…Ñ¥Ù•ññ	½½±•…¸¡É•ÍÑ…ÉÑ¥¹œ¥ññ	½½±•…¸¡ÕÁ‘…Ñ¥¹œ¥ô½¹±¥¬õì ¤ôùÉ•ÍÑ…ÉĞ¡‘•Ù¥”¥ôøñ%½¹I•™É•Í Í¥é”õìÄİô¼ùíÉ•ÍÑ…ÉÑ¥¹œôôõ‘•Ù¥”¹¥ü‰]¥É¹•Ô•ÍÑ…ÉÑ•ĞƒŠ˜ˆè‰9•ÔÍÑ…ÉÑ•¸‰ôğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸½¹±¥¬õì ¤ôùÑ½±”¡‘•Ù¥”¥ôùí‘•Ù¥”¹…Ñ¥Ù”ü‰•…­Ñ¥Ù¥•É•¸ˆè‰­Ñ¥Ù¥•É•¸‰ôğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½…ÉÑ¥±”ø¥õì…‘•Ù¥•Ì¹±•¹Ñ ˜˜ñÀù9½ ­•¥¸•áÑ•É¹•ÈI%µ1•Í•È•¥¹•É¥¡Ñ•Ğ¸ğ½Àùôğ½‘¥Øø(€€€€ñ‘•Ñ…¥±Ì±…ÍÍ9…µ”ô‰É™¥µ¹•Ñİ½É¬µ¡•±ÀˆøñÍÕµµ…Éäù9½Ñ™…±±İ•œµ¥Ğµ…¹Õ•±±•´•Ë‘Ñ”µQ½­•¸ğ½ÍÕµµ…Éäøñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µ‘•Ù¥”µÉ•…Ñ”ˆøñ±…‰•°ù	•é•¥¡¹Õ¹œñ¥¹ÁÕĞÙ…±Õ”õí¹…µ•ôµ…á1•¹Ñ õìØÁô½¹¡…¹”õí•Ù•¹ĞôùÍ•Ñ9…µ”¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ôÁ±…•¡½±‘•Èô‰è¸¸1•Í•È…´QÉ•Í•¸ˆ¼øğ½±…‰•°øñ‰ÕÑÑ½¸‘¥Í…‰±•õí‰ÕÍåññ¹…µ”¹ÑÉ¥´ ¤¹±•¹Ñ ğÍô½¹±¥¬õíÉ•…Ñ•ôùQ½­•¸•Éé•Õ•¸ğ½‰ÕÑÑ½¸øğ½‘¥ØùíÑ½­•¸˜˜ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µÑ½­•¸µ½¹”ˆøñ‘¥ØøñÍÑÉ½¹œù•Ë‘Ñ•­•¹¹Õ¹œƒŠL¹ÕÈ©•ÑéĞÍ¥¡Ñ‰…Èğ½ÍÑÉ½¹œøñÍµ…±°ù9ÕÈÙ•Éİ•¹‘•¸°™…±±Ì‘¥”-½ÁÁ±Õ¹œÁ•È¥¹µ…±½‘”¹¥¡Ğ·Ù±¥ ¥ÍĞ¸ğ½Íµ…±°øğ½‘¥Øøñ‘¥Øøñ½‘”ùíÑ½­•¹ôğ½½‘”øñ‰ÕÑÑ½¸½¹±¥¬õí½ÁåQ½­•¹ôùí½Á¥•üñ%½¹¡•¬Í¥é”õìÄáô¼øèñ%½¹½ÁäÍ¥é”õìÄáô¼ùôí½Á¥•ü‰-½Á¥•ÉĞˆè‰-½Á¥•É•¸‰ôğ½‰ÕÑÑ½¸øğ½‘¥Øøğ½‘¥Øùôğ½‘•Ñ…¥±Ìø(€€€í…É‘Ì¹±•¹Ñ øÀ˜˜ñ‘¥Ø±…ÍÍ9…µ”ô‰É™¥µ…Éµµ…ÁÁ¥¹Ìˆøñ‘¥ØøñÍÑÉ½¹œùiÕ•½É‘¹•Ñ”-…ÉÑ•¸ğ½ÍÑÉ½¹œøñÍµ…±°ùY•É±½É•¹”½‘•È•ÉÍ•ÑéÑ”-…ÉÑ•¸¡¥•ÈÍ½™½ÉĞÑÉ•¹¹•¸¸ğ½Íµ…±°øğ½‘¥Øùí…É‘Ì¹µ…À¡…Éôøñ…ÉÑ¥±”­•äõí…É¹Õ¥‘ôøñÍÁ…¸ùí…É¹µ•µ‰•É9…µ•ôğ½ÍÁ…¸øñ½‘”ùí…É¹Õ¥‘ôğ½½‘”øñ‰ÕÑÑ½¸½¹±¥¬õì ¤ôùÕ¹…ÍÍ¥¸¡…É¥ôùQÉ•¹¹•¸ğ½‰ÕÑÑ½¸øğ½…ÉÑ¥±”ø¥ôğ½‘¥Øùô(€€€€ñ‘•Ñ…¥±Ì±…ÍÍ9…µ”ô‰É™¥µ¹•Ñİ½É¬µ¡•±ÀˆøñÍÕµµ…Éäù]…ÉÕ´¹¥¡Ğ‘¥É•­Ğƒñ‰•È€ÄäÈ¸ÄØà¸Ğ¸Äüğ½ÍÕµµ…ÉäøñÀù…ÌQ…‰±•ĞßñÉ‘”‰•¥´]•¡Í•°¥¸‘…Ì•Ë‘Ñ”µ]18Í•¥¹”M•ÉÙ•ÉÙ•É‰¥¹‘Õ¹œÙ•É±¥•É•¸¸iÕÏ‘Ñé±¥ ‰±½­¥•É•¸µ½‘•É¹”	É½İÍ•È!QQ@µiÕÉ¥™™”…ÕÌ•¥¹•È!QQALµÁÀÕ¹Ù•É±…¹•¸=ILµÉ•¥…‰•¸¸•È…ÕÍ•¡•¹‘”!QQALµM…¸Ù•Éµ•¥‘•Ğ…±±”‘É•¤AÉ½‰±•µ”¸ğ½Àøğ½‘•Ñ…¥±Ìø(€€€í¹½Ñ¥”˜˜ñÀ±…ÍÍ9…µ”ô‰É™¥µ‘•Ù¥”µ¹½Ñ¥”ˆÉ½±”ô‰ÍÑ…ÑÕÌˆùí¹½Ñ¥•ôğ½Àùô(€€€í•ÉÉ½È˜˜ñÀ±…ÍÍ9…µ”ô‰ÁÉ½™¥±”µ•ÉÉ½ÈˆÉ½±”ô‰…±•ÉĞˆùí•ÉÉ½Éôğ½Àùô(€€ğ½Í•Ñ¥½¸øì)ô(