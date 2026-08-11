"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconCheck, IconNfc, IconRefresh, IconWifi } from "@tabler/icons-react";
import { LATEST_RFID_FIRMWARE } from "./rfid-firmware";

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
    // Manche Browser geben Ton erst nach der ersten Berührung frei.
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
    ?{title:`${state.member.name.split(" ")[0]} erkannt`,detail:`${state.member.name} ist ausgewählt. Anderes Mitglied scannen: nächste Karte auflegen.`}
    :state.kind==="unknown"
      ?{title:"Unbekannte Karte",detail:`UID ${state.scan.uid} kann im Adminbereich beim Mitglied zugeordnet werden.`}
      :state.kind==="error"
        ?{title:"RFID-Fehler",detail:state.message}
        :state.deviceCount
          ?{title:"RFID bereit",detail:`${state.deviceCount===1?"RFID-Leser bereit":`${state.deviceCount} RFID-Leser bereit`} · Karte auflegen.`}
          :{title:"RFID offline",detail:"Der Leser verbindet sich automatisch mit dem ClubIQ-Kassen-WLAN."};

  const light=state.kind==="recognized"||state.kind==="waiting"&&Boolean(state.deviceCount)?"green":state.kind==="unknown"?"yellow":"red";
  return <button type="button" className={`rfid-header-status ${state.kind} ${light}`} onClick={dismiss} aria-live="polite" aria-label={`${copy.title}. ${copy.detail}`} title={copy.detail}>
    <span className="rfid-traffic-light" aria-hidden="true"><i/><i/><i/></span>
    <span className="rfid-status-copy"><strong>{copy.title}</strong><small>{copy.detail}</small></span>
  </button>;
}

export function RfidAdminLogin({expectedMemberId,requiredRole,onVerified}:{expectedMemberId?:string;requiredRole?:string;onVerified:(member:Member)=>void}){
  const [state,setState]=useState<"checking"|"waiting"|"success"|"unknown"|"forbidden"|"mismatch"|"error">("checking");
  const [message,setMessage]=useState("Verbindung zum RFID-Leser wird geprüft.");
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
          finished.current=true;setState("success");setMessage(`✓ ${data.member.name} wurde sicher erkannt.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},350);
        }else if(data.state==="unknown"){
          holdUntil.current=Date.now()+3500;setState("unknown");setMessage("Diese Karte ist noch keinem Mitglied zugeordnet.");
        }else if(data.state==="forbidden"){
          holdUntil.current=Date.now()+3500;setState("forbidden");setMessage(`${data.member?.name||"Diese Person"} hat keinen Adminzugang.`);
        }else if(data.state==="mismatch"){
          holdUntil.current=Date.now()+3500;setState("mismatch");setMessage(`Die Karte gehört zu ${data.member?.name||"einer anderen Person"}.`);
        }else if(Date.now()>=holdUntil.current){
          const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser ist online. Admin-Chip jetzt auflegen.":"Kein RFID-Leser online. Strom und Kassen-WLAN prüfen.");
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
    <div><strong>{state==="success"?"Admin-Chip erkannt":state==="checking"?"Leser wird geprüft":state==="waiting"?"Mit Chip anmelden":state==="unknown"?"Unbekannte Karte":state==="forbidden"?"Keine Adminberechtigung":state==="mismatch"?"Falsche Karte":"Lesefehler"}</strong><small>{message}</small></div>
  </div>;
}

export function RfidShiftLogin({onVerified}:{onVerified:(member:Member)=>void}){
  const [message,setMessage]=useState("Leser wird geprüft. Danach Mitgliedschip auflegen.");
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
          finished.current=true;setState("success");setMessage(`✓ ${data.member.name} öffnet die Kasse.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},300);
        }else if(data.state==="unknown"){setState("unknown");setMessage("Diese Karte ist noch keinem aktiven Mitglied zugeordnet.")}
        else{const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser ist bereit. Mitgliedschip jetzt auflegen.":"Kein RFID-Leser online. Strom und Kassen-WLAN prüfen.")}
      }catch(reason){if(!stopped){setState("error");setMessage(reason instanceof Error?reason.message:"RFID-Anmeldung fehlgeschlagen")}}
      finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);return()=>{stopped=true;clearInterval(timer)};
  },[]);
  return <div className={`rfid-admin-login shift ${state}`} aria-live="polite"><span>{state==="success"?<IconCheck size={25}/>:state==="error"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span><div><strong>{state==="success"?"Mitglied erkannt":state==="checking"?"Leser wird geprüft":state==="waiting"?"Chip auflegen":state==="unknown"?"Unbekannte Karte":"Lesefehler"}</strong><small>{message}</small></div></div>;
}

export function RfidBalanceLookup({onVerified}:{onVerified:(member:Member)=>void}){
  const [message,setMessage]=useState("Leser wird geprüft. Danach Mitgliedschip auflegen.");
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
          finished.current=true;setState("success");setMessage(`✓ ${data.member.name} erkannt.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},250);
        }else if(data.state==="unknown"){
          holdUntil.current=Date.now()+3500;setState("unknown");setMessage("Diese Karte ist noch keinem aktiven Mitglied zugeordnet.");
        }else if(Date.now()>=holdUntil.current){
          const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser ist bereit. Mitgliedschip jetzt auflegen.":"Kein RFID-Leser online. Name kann weiterhin ausgewählt werden.");
        }
      }catch(reason){
        if(!stopped){setState("error");setMessage(reason instanceof Error?reason.message:"RFID-Abfrage fehlgeschlagen")}
      }finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);return()=>{stopped=true;clearInterval(timer)};
  },[]);
  return <div className={`rfid-admin-login balance ${state}`} aria-live="polite"><span>{state==="success"?<IconCheck size={25}/>:state==="error"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span><div><strong>{state==="success"?"Mitglied erkannt":state==="checking"?"Leser wird geprüft":state==="waiting"?"Chip auflegen":state==="unknown"?"Unbekannte Karte":"Leser nicht erreichbar"}</strong><small>{message}</small></div></div>;
}

export function RfidProfileLogin({profile,onVerified}:{profile:LoginProfile;onVerified:(member:Member)=>void}){
  const [message,setMessage]=useState("Verbindung zum RFID-Leser wird geprüft.");
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
          finished.current=true;setState("success");setMessage(`✓ ${data.member.name} erkannt. ${profile.shortName} wird geöffnet.`);void playRfidRecognitionTone();
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},300);
        }else if(data.state==="unknown"){
          holdUntil.current=Date.now()+3500;setState("unknown");setMessage("Diese Karte ist diesem Profil noch nicht zugeordnet.");
        }else if(data.state==="pin_required"){
          holdUntil.current=Date.now()+3500;setState("pin_required");setMessage("Bei der Ersteinrichtung muss zuerst die neue Profil-PIN festgelegt werden.");
        }else if(Date.now()>=holdUntil.current){
          const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser verbunden · Mitgliedschip jetzt auflegen.":"Leser offline · Profil-PIN als Rückfall verwenden.");
        }
      }catch(reason){
        if(!stopped){setState("error");setMessage(`${reason instanceof Error?reason.message:"Lesefehler"} · PIN funktioniert weiterhin.`)}
      }finally{busy=false}
    };
    poll();const timer=setInterval(poll,350);return()=>{stopped=true;clearInterval(timer)};
  },[profile.id,profile.shortName]);
  return <div className={`rfid-admin-login profile-login ${state}`} aria-live="polite"><span>{state==="success"?<IconCheck size={25}/>:state==="error"||state==="pin_required"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span><div><strong>{state==="success"?"Chip erkannt":state==="checking"?"Leser wird geprüft":state==="waiting"?"Mit Chip öffnen":state==="unknown"?"Unbekannte Karte":state==="pin_required"?"PIN zuerst festlegen":"Leser nicht erreichbar"}</strong><small>{message}</small></div></div>;
}

export function RfidMemberCardDialog({member,onClose,onSaved}:{member:Member;onClose:()=>void;onSaved:()=>void}){
  const [scan,setScan]=useState<Scan|null>(null),[phase,setPhase]=useState<"scan"|"ready"|"saving"|"write"|"success"|"error">("scan");
  const [writeChip,setWriteChip]=useState(false),[block,setBlock]=useState(4),[text,setText]=useState(member.id.slice(0,16)),[message,setMessage]=useState("Verbindung zum Leser wird geprüft.");
  const textBytes=new TextEncoder().encode(text).length;
  useEffect(()=>{
    if(phase!=="scan")return;
    let stopped=false,busy=false;
    const poll=async()=>{if(stopped||busy)return;busy=true;try{const response=await fetch("/api/rfid",{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.error);if(data.scan&&!stopped){setScan(data.scan);setPhase("ready");setMessage(`Karte ${data.scan.uid} erkannt.`);void playRfidRecognitionTone()}else if(!stopped)setMessage(Number(data.deviceCount||0)>0?"Leser ist online. Karte jetzt auflegen.":"Kein RFID-Leser online. Strom, Kassen-WLAN und Firmware prüfen.")}catch(reason){if(!stopped)setMessage(reason instanceof Error?reason.message:"Lesefehler")}finally{busy=false}};
    poll();const timer=setInterval(poll,1000);return()=>{stopped=true;clearInterval(timer)};
  },[phase]);
  const watch=async(id:string)=>{
    setPhase("write");setMessage("Zuordnung gespeichert. Karte kurz abnehmen und erneut auflegen.");
    const started=Date.now();const timer=setInterval(async()=>{try{const response=await fetch(`/api/rfid/commands?id=${encodeURIComponent(id)}`,{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.error);const status=data.command?.status;if(status==="succeeded"){clearInterval(timer);setPhase("success");setMessage("Karte wurde zugeordnet, beschrieben und erfolgreich geprüft.");onSaved()}else if(status==="failed"||status==="expired"){clearInterval(timer);setPhase("error");setMessage(data.command?.error||"Der Chip konnte nicht beschrieben werden.")}else if(Date.now()-started>130000){clearInterval(timer);setPhase("error");setMessage("Zeitfenster abgelaufen. Bitte erneut versuchen.")}}catch(reason){clearInterval(timer);setPhase("error");setMessage(reason instanceof Error?reason.message:"Status konnte nicht geprüft werden")}},1000);
  };
  const save=async()=>{
    if(!scan||textBytes>16)return;setPhase("saving");setMessage("Zuordnung wird gespeichert …");
    try{const response=await fetch("/api/rfid",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({scanId:scan.id,memberId:member.id,...(writeChip?{writeText:text,writeBlock:block}:{})})}),data=await response.json();if(!response.ok)throw new Error(data.error);if(data.command?.id)watch(data.command.id);else{setPhase("success");setMessage("Karte wurde dem Mitglied zugeordnet.");onSaved()}}catch(reason){setPhase("error");setMessage(reason instanceof Error?reason.message:"Zuordnung fehlgeschlagen")}};
  const reset=()=>{setScan(null);setPhase("scan");setMessage("Verbindung zum Leser wird geprüft.")};
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rfid-member-card-title"><div className="identity-card rfid-provision-card">
    <button className="modal-close" aria-label="Fenster schließen" onClick={onClose}>×</button>
    <div className="identity-icon"><IconNfc size={28}/></div><p className="eyebrow">RFID-KARTE</p><h2 id="rfid-member-card-title">{member.name}</h2>
    <div className={`rfid-provision-state ${phase}`}><span>{phase==="success"?"✓":phase==="error"?"!":"◉"}</span><div><strong>{phase==="scan"?"Leser prüfen":phase==="ready"?"Karte erkannt":phase==="write"?"Chip erneut auflegen":phase==="success"?"Fertig":phase==="error"?"Nicht abgeschlossen":"Bitte warten"}</strong><small>{message}</small></div></div>
    {scan&&phase==="ready"&&<><div className="rfid-scan-card"><span>UID</span><code>{scan.uid}</code><small>{scan.deviceName} · {scan.cardType||"RFID-Karte"}</small></div>
      <label className="rfid-write-toggle"><input type="checkbox" checked={writeChip} onChange={event=>setWriteChip(event.target.checked)}/><span><strong>Chip zusätzlich beschriften</strong><small>Optionaler lesbarer Hinweis. Geld, Kontostand und Rechte bleiben in der Datenbank.</small></span></label>
      {writeChip&&<div className="rfid-write-fields"><label>Freier Datenblock<select value={block} onChange={event=>setBlock(Number(event.target.value))}>{[4,5,6,8,9,10].filter(value=>!scan.blocks||value<scan.blocks).map(value=><option key={value} value={value}>Block {value}</option>)}</select></label><label>Text auf dem Chip<input value={text} onChange={event=>setText(event.target.value)} maxLength={16}/><small className={textBytes>16?"invalid":""}>{textBytes}/16 Byte</small></label></div>}
      <button className="confirm-allocation" disabled={textBytes>16} onClick={save}>{writeChip?"Zuordnen und Chip beschreiben":"Karte zuordnen"}</button></>}
    {(phase==="error"||phase==="success")&&<div className="rfid-provision-actions">{phase==="error"&&<button onClick={reset}>Erneut versuchen</button>}<button onClick={onClose}>Schließen</button></div>}
  </div></div>;
}

type Device={id:string;name:string;hardwareId?:string|null;firmwareVersion?:string|null;active:boolean|number;lastSeenAt?:string|null;createdAt:string};
type CardMapping={uid:string;memberId:string;memberName:string;updatedAt:string};
type PairingRequest={id:string;hardwareId:string;name:string;createdAt:string;expiresAt:string};
const compareFirmware=(left:string,right:string)=>{
  const parse=(value:string)=>value.split(/[+-]/,1)[0].split(".").map(part=>Number.parseInt(part,10)||0);
  const a=parse(left),b=parse(right),length=Math.max(a.length,b.length);
  for(let index=0;index<length;index++){const difference=(a[index]||0)-(b[index]||0);if(difference)return difference}
  return 0;
};
const firmwareNeedsUpdate=(value?:string|null)=>value?compareFirmware(value,LATEST_RFID_FIRMWARE)<0:false;

export function RfidDevicePanel(){
  const [devices,setDevices]=useState<Device[]>([]),[cards,setCards]=useState<CardMapping[]>([]);
  const [pairings,setPairings]=useState<PairingRequest[]>([]),[pairingCodes,setPairingCodes]=useState<Record<string,string>>({}),[pairingBusy,setPairingBusy]=useState<string|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[restarting,setRestarting]=useState<string|null>(null),[updating,setUpdating]=useState<string|null>(null),[updatePhase,setUpdatePhase]=useState("");
  const [statusClock,setStatusClock]=useState(0);
  const load=async()=>{try{const [deviceResponse,pairResponse]=await Promise.all([fetch("/api/rfid/devices",{cache:"no-store"}),fetch("/api/rfid/pair",{cache:"no-store"})]),deviceData=await deviceResponse.json(),pairData=await pairResponse.json();if(!deviceResponse.ok)throw new Error(deviceData.error);if(!pairResponse.ok)throw new Error(pairData.error);setDevices(deviceData.devices||[]);setCards(deviceData.cards||[]);setPairings(pairData.pairings||[])}catch(reason){setError(reason instanceof Error?reason.message:"RFID-Leser konnten nicht geladen werden")}};
  useEffect(()=>{let stopped=false;const refresh=()=>{if(!stopped)void load()};refresh();const timer=setInterval(refresh,2000);return()=>{stopped=true;clearInterval(timer)}},[]);
  useEffect(()=>{const refreshClock=()=>setStatusClock(Date.now());refreshClock();const timer=setInterval(refreshClock,15_000);return()=>clearInterval(timer)},[]);
  const toggle=async(device:Device)=>{const response=await fetch("/api/rfid/devices",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:device.id,active:!Boolean(device.active)})}),data=await response.json();if(!response.ok){setError(data.error||"Änderung fehlgeschlagen");return}load()};
  const restart=async(device:Device)=>{if(restarting||!confirm(`${device.name} neu starten? Der Leser ist für etwa 15 Sekunden nicht verfügbar.`))return;setRestarting(device.id);setError("");setNotice("");try{const response=await fetch("/api/rfid/commands",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId:device.id})}),data=await response.json();if(!response.ok)throw new Error(data.error||"Neustart konnte nicht gesendet werden");const started=Date.now();const timer=setInterval(async()=>{try{const statusResponse=await fetch(`/api/rfid/commands?id=${encodeURIComponent(data.id)}`,{cache:"no-store"}),statusData=await statusResponse.json();if(!statusResponse.ok)throw new Error(statusData.error);if(statusData.command?.status==="succeeded"){clearInterval(timer);setRestarting(null);setNotice(`${device.name} startet neu. Die Verbindung sollte in etwa 15 Sekunden wieder bereit sein.`);setTimeout(load,15000)}else if(["failed","expired"].includes(statusData.command?.status)||Date.now()-started>40000){clearInterval(timer);setRestarting(null);setError(statusData.command?.error||"Der Leser hat den Neustartauftrag nicht rechtzeitig abgeholt.")}}catch(reason){clearInterval(timer);setRestarting(null);setError(reason instanceof Error?reason.message:"Neustartstatus konnte nicht geprüft werden")}},1000)}catch(reason){setRestarting(null);setError(reason instanceof Error?reason.message:"Neustart fehlgeschlagen")}};
  const openWifiSetup=async(device:Device)=>{if(!confirm(`${device.name} in den WLAN-Einrichtungsmodus versetzen? Name und Kennwort des geschützten Setup-WLANs erscheinen am Leserdisplay.`))return;setError("");setNotice("");try{const response=await fetch("/api/rfid/commands",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId:device.id,action:"wifi_setup"})}),data=await response.json();if(!response.ok)throw new Error(data.error||"WLAN-Einrichtung konnte nicht gestartet werden");setNotice(`${device.name} öffnet jetzt sein geschütztes Setup-WLAN. Folge den Angaben am Leserdisplay.`)}catch(reason){setError(reason instanceof Error?reason.message:"WLAN-Einrichtung konnte nicht gestartet werden")}};
  const approvePairing=async(pairing:PairingRequest)=>{const code=(pairingCodes[pairing.id]||"").replace(/\D/g,"");if(code.length!==6)return;setPairingBusy(pairing.id);setError("");try{const response=await fetch("/api/rfid/pair",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id:pairing.id,code,name:pairing.name})}),data=await response.json();if(!response.ok)throw new Error(data.error||"Leser konnte nicht freigegeben werden");setNotice(`${pairing.name} wurde sicher mit ClubIQ verknüpft.`);setPairingCodes(current=>{const next={...current};delete next[pairing.id];return next});await load()}catch(reason){setError(reason instanceof Error?reason.message:"Leser konnte nicht freigegeben werden")}finally{setPairingBusy(null)}};
  const rejectPairing=async(pairing:PairingRequest)=>{setPairingBusy(pairing.id);setError("");try{const response=await fetch("/api/rfid/pair",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({id:pairing.id})}),data=await response.json();if(!response.ok)throw new Error(data.error||"Anfrage konnte nicht verworfen werden");await load()}catch(reason){setError(reason instanceof Error?reason.message:"Anfrage konnte nicht verworfen werden")}finally{setPairingBusy(null)}};
  const updateFirmware=async(device:Device)=>{
    if(updating||!device.firmwareVersion)return;
    if(!confirm(`${device.name} auf Firmware ${LATEST_RFID_FIRMWARE} aktualisieren? Der Leser startet danach automatisch neu.`))return;
    setUpdating(device.id);setUpdatePhase("Updateauftrag wartet auf den Leser …");setError("");setNotice("");
    try{
      const response=await fetch("/api/rfid/commands",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId:device.id,action:"firmware"})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||"Firmwareupdate konnte nicht gesendet werden");
      let remainingChecks=14*60;
      const timer=setInterval(async()=>{try{
        remainingChecks-=1;
        const statusResponse=await fetch(`/api/rfid/commands?id=${encodeURIComponent(data.id)}`,{cache:"no-store"}),statusData=await statusResponse.json();
        if(!statusResponse.ok)throw new Error(statusData.error);
        if(statusData.command?.status==="processing")setUpdatePhase("Firmware wird über das Kassen-WLAN installiert …");
        if(statusData.command?.status==="succeeded"){
          clearInterval(timer);setUpdating(null);setUpdatePhase("");setNotice(`${device.name} hat Firmware ${LATEST_RFID_FIRMWARE} installiert und startet neu. Er meldet sich danach selbstständig im Kassen-WLAN zurück.`);setTimeout(load,15_000);
        }else if(["failed","expired"].includes(statusData.command?.status)||remainingChecks<=0){
          clearInterval(timer);setUpdating(null);setUpdatePhase("");setError(statusData.command?.error||"Das Firmwareupdate wurde nicht abgeschlossen.");
        }
      }catch(reason){clearInterval(timer);setUpdating(null);setUpdatePhase("");setError(reason instanceof Error?reason.message:"Updatestatus konnte nicht geprüft werden")}},1000);
    }catch(reason){setUpdating(null);setUpdatePhase("");setError(reason instanceof Error?reason.message:"Firmwareupdate fehlgeschlagen")}
  };
  const unassign=async(card:CardMapping)=>{if(!confirm(`Karte ${card.uid} von ${card.memberName} trennen?`))return;const response=await fetch("/api/rfid/devices",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({uid:card.uid})}),data=await response.json();if(!response.ok){setError(data.error||"Zuordnung konnte nicht entfernt werden");return}load()};
  const enabledDevices=devices.filter(device=>Boolean(device.active)).length;
  const updateCount=devices.filter(device=>firmwareNeedsUpdate(device.firmwareVersion)).length;

  return <div className="rfid-admin-shell">
    {notice&&<p className="rfid-device-notice" role="status">{notice}</p>}
    {error&&<p className="profile-error" role="alert">{error}</p>}

    <section className="panel rfid-device-panel">
      <div className="panel-head"><div><p className="eyebrow">STATUS</p><h2>Verbundene Leser</h2><small>Hier siehst du sofort, welche Geräte einsatzbereit und aktuell sind.</small></div><span className={enabledDevices?"ready":"empty"}><IconNfc size={19}/>{enabledDevices} aktiv</span></div>
      <div className="rfid-flow-strip"><span>RFID-Leser</span><b>→ 2,4-GHz-WLAN →</b><span>Raspberry</span><b>→ WLAN →</b><span>Tablet-Kasse</span></div>
      <div className="rfid-ble-runtime online"><span><IconWifi size={20}/></span><div><strong>Festes Kassen-WLAN</strong><small>Leser und Tablet verwenden BarverKasse. Internet ist für den laufenden Kassenbetrieb nicht erforderlich.</small></div><i/></div>
      <div className="rfid-summary-grid"><article><span>Registriert</span><strong>{devices.length}</strong></article><article><span>Aktiviert</span><strong>{enabledDevices}</strong></article><article className={updateCount?"attention":""}><span>Updates</span><strong>{updateCount}</strong></article><article><span>Karten</span><strong>{cards.length}</strong></article></div>
      <div className="rfid-device-list">{devices.map(device=>{
        const isEsp32=Boolean(device.hardwareId?.startsWith("ESP32-"));
        const lastSeen=device.lastSeenAt?new Date(device.lastSeenAt).getTime():0;
        const isOnline=Boolean(device.active)&&statusClock>0&&lastSeen>statusClock-75_000;
        const needsUpdate=firmwareNeedsUpdate(device.firmwareVersion);
        const firmwareState=!device.firmwareVersion
          ?isEsp32?"Firmwarestand unbekannt · WLAN-Einrichtung prüfen":"Firmwarestand unbekannt · USB-Erstinstallation prüfen"
          :compareFirmware(device.firmwareVersion,LATEST_RFID_FIRMWARE)>0
            ?`Firmware ${device.firmwareVersion} · neuer als App`
            :`Firmware ${device.firmwareVersion}${needsUpdate?" · Update verfügbar":" · aktuell"}`;
        return <article key={device.id} className={device.active?"":"inactive"}><span><IconNfc size={22}/></span><div><strong>{device.name}</strong><small>{device.hardwareId?`${device.hardwareId} · `:""}{isOnline?"Im Kassen-WLAN verbunden und einsatzbereit":device.lastSeenAt?`Offline · zuletzt verbunden: ${new Date(device.lastSeenAt).toLocaleString("de-DE")}`:isEsp32?"Noch nicht im Kassen-WLAN angekommen":"Noch kein Scan empfangen"}</small><small className="rfid-firmware-state">{firmwareState}</small></div><div className="rfid-device-actions"><button className="firmware" disabled={!device.active||!needsUpdate||!isOnline||Boolean(updating)||Boolean(restarting)} onClick={()=>updateFirmware(device)}><IconRefresh size={17}/>{updating===device.id?"Update läuft …":"Firmware aktualisieren"}</button><button className="restart" disabled={!device.active||!isOnline||Boolean(restarting)||Boolean(updating)} onClick={()=>restart(device)}><IconRefresh size={17}/>{restarting===device.id?"Wird neu gestartet …":"Neu starten"}</button><button className="wifi" disabled={!device.active||!isOnline||Boolean(restarting)||Boolean(updating)} onClick={()=>openWifiSetup(device)}><IconWifi size={17}/>WLAN ändern</button><button onClick={()=>toggle(device)}>{device.active?"Deaktivieren":"Aktivieren"}</button></div>{updating===device.id&&<div className="rfid-ota-progress" role="status" aria-live="polite"><div><strong>{updatePhase||"Updateauftrag wird vorbereitet"}</strong></div><progress/><small>Der Leser lädt das Update direkt über das Kassen-WLAN. Danach startet er neu und meldet sich selbstständig zurück.</small></div>}</article>;
      })}{!devices.length&&<div className="rfid-empty-state"><IconNfc size={30}/><strong>Noch kein RFID-Leser verbunden</strong><small>Richte unten einen ESP32 D1 mini über sein geschütztes Setup-WLAN ein.</small></div>}</div>
    </section>

    <section className="panel rfid-setup-panel">
      <div className="panel-head"><div><p className="eyebrow">ESP32 D1 MINI</p><h2>RFID-Leser einrichten</h2><small>Ein geschütztes Setup-WLAN führt dich einmalig durch die Einrichtung. Danach arbeitet der Leser selbstständig.</small></div></div>
      <div className="rfid-portal-steps">
        <article><b>1</b><div><strong>Angaben am Leserdisplay öffnen</strong><small>Nach dem Einschalten zeigt der Leser <b>ClubIQ-Setup-…</b> und ein zufälliges Kennwort. Ist er bereits online, nutze oben „WLAN ändern“.</small></div></article>
        <article><b>2</b><div><strong>Mit dem Setup-WLAN verbinden</strong><small>Wähle es in Android aus. Die WLAN-Auswahlliste öffnet sich automatisch; andernfalls rufe <a href="http://192.168.4.1">192.168.4.1</a> auf. Dort <b>BarverKasse</b> auswählen und dessen Kennwort speichern.</small></div></article>
        <article><b>3</b><div><strong>Sechsstelligen Code freigeben</strong><small>Der Leser verbindet sich mit dem Raspberry und zeigt anschließend seinen Kopplungscode. Nur dieser Code kann den Leser im aktuellen Profil aktivieren.</small></div></article>
      </div>
      <div className="rfid-pairing-list">
        <div className="rfid-pairing-head"><strong>{pairings.length?"Leser wartet auf Freigabe":"Noch keine Freigabe offen"}</strong><small>{pairings.length?"Code direkt vom Leserdisplay eingeben.":"Diese Liste erscheint automatisch, sobald der Leser BarverKasse erreicht."}</small></div>
        {pairings.map(pairing=><article key={pairing.id}><div><strong>{pairing.name}</strong><small>{pairing.hardwareId}</small></div><label>Kopplungscode<input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pairingCodes[pairing.id]||""} onChange={event=>setPairingCodes(current=>({...current,[pairing.id]:event.target.value.replace(/\D/g,"").slice(0,6)}))} placeholder="000000"/></label><button disabled={pairingBusy===pairing.id||(pairingCodes[pairing.id]||"").length!==6} onClick={()=>approvePairing(pairing)}><IconCheck size={18}/>{pairingBusy===pairing.id?"Wird geprüft …":"Leser freigeben"}</button><button className="secondary" disabled={pairingBusy===pairing.id} onClick={()=>rejectPairing(pairing)}>Verwerfen</button></article>)}
      </div>
    </section>

    <details className="panel rfid-collapsible"><summary><span><strong>Zugeordnete Mitgliedskarten</strong><small>Verlorene oder ersetzte Karten trennen</small></span><b>{cards.length}</b></summary>{cards.length>0?<div className="rfid-card-mappings">{cards.map(card=><article key={card.uid}><span>{card.memberName}</span><code>{card.uid}</code><button onClick={()=>unassign(card)}>Trennen</button></article>)}</div>:<p>Noch keine Mitgliedskarte zugeordnet.</p>}</details>

    <details className="panel rfid-collapsible rfid-advanced"><summary><span><strong>Sicherheit und Rückfall</strong><small>Was bei einem WLAN-Ausfall passiert</small></span></summary><div className="rfid-security-note"><strong>Die Karte speichert weder Geld noch Berechtigungen.</strong><small>Die UID erkennt nur die Person. Kontostände, Preise und Zugriffsrechte werden ausschließlich in PostgreSQL geprüft.</small></div><details className="rfid-network-help"><summary>Wie arbeitet der Kassen-WLAN-Betrieb?</summary><p>Der Raspberry stellt dauerhaft das 2,4-GHz-WLAN BarverKasse bereit. Tablet und ESP32 D1 mini bleiben in diesem Netz; der Leser überträgt signierte Scans direkt an den Raspberry. Bleibt das WLAN länger aus, öffnet der Leser ein kennwortgeschütztes Setup-WLAN mit einer WLAN-Auswahlliste.</p></details></details>
  </div>;
}
