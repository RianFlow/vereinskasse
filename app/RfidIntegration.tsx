"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconBluetooth, IconCheck, IconCopy, IconNfc, IconRefresh, IconWifi } from "@tabler/icons-react";
import { getAuthorizedRfidBleReaders, provisionRfidReader, selectRfidBleReader, type RfidBleReader } from "./rfid-ble";
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
type Pairing={id:string;hardwareId:string;name:string;createdAt:string;expiresAt:string};
const compareFirmware=(left:string,right:string)=>{
  const parse=(value:string)=>value.split(/[+-]/,1)[0].split(".").map(part=>Number.parseInt(part,10)||0);
  const a=parse(left),b=parse(right),length=Math.max(a.length,b.length);
  for(let index=0;index<length;index++){const difference=(a[index]||0)-(b[index]||0);if(difference)return difference}
  return 0;
};
const firmwareNeedsUpdate=(value?:string|null)=>value?compareFirmware(value,LATEST_RFID_FIRMWARE)<0:false;

export function RfidDevicePanel(){
  const [devices,setDevices]=useState<Device[]>([]),[cards,setCards]=useState<CardMapping[]>([]),[pairings,setPairings]=useState<Pairing[]>([]),[pairCodes,setPairCodes]=useState<Record<string,string>>({});
  const [name,setName]=useState("RFID-Leser Vereinsheim"),[token,setToken]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[pairingBusy,setPairingBusy]=useState<string|null>(null),[restarting,setRestarting]=useState<string|null>(null),[updating,setUpdating]=useState<string|null>(null),[updatePhase,setUpdatePhase]=useState(""),[copied,setCopied]=useState(false);
  const [bleName,setBleName]=useState("RFID-Leser Vereinsheim"),[kioskSsid,setKioskSsid]=useState("ClubIQ-Kasse"),[kioskPassword,setKioskPassword]=useState(""),[bleBusy,setBleBusy]=useState(false),[bleState,setBleState]=useState("idle"),[bleMessage,setBleMessage]=useState("Leser einschalten und für die einmalige Einrichtung bereithalten.");
  const [setupMode,setSetupMode]=useState<"esp8266"|"esp32">("esp32"),[bleSupport,setBleSupport]=useState<"checking"|"ready"|"unavailable">("checking");
  const [bleReaders,setBleReaders]=useState<RfidBleReader[]>([]),[bleReader,setBleReader]=useState<RfidBleReader|null>(null),[bleSearchBusy,setBleSearchBusy]=useState(false);
  const selectedBleSuffix=bleReader?.name.match(/^ClubIQ-RFID-([0-9A-F]{6})$/i)?.[1]?.toUpperCase()||"";
  const selectedRegisteredDevice=selectedBleSuffix?devices.find(device=>device.hardwareId===`ESP32-${selectedBleSuffix}`):undefined;
  const load=async()=>{try{const [deviceResponse,pairResponse]=await Promise.all([fetch("/api/rfid/devices",{cache:"no-store"}),fetch("/api/rfid/pair",{cache:"no-store"})]),[deviceData,pairData]=await Promise.all([deviceResponse.json(),pairResponse.json()]);if(!deviceResponse.ok)throw new Error(deviceData.error);if(!pairResponse.ok)throw new Error(pairData.error);setDevices(deviceData.devices||[]);setCards(deviceData.cards||[]);setPairings(pairData.pairings||[])}catch(reason){setError(reason instanceof Error?reason.message:"RFID-Leser konnten nicht geladen werden")}};
  useEffect(()=>{let stopped=false;const refresh=()=>{if(!stopped)void load()};refresh();const timer=setInterval(refresh,2000);return()=>{stopped=true;clearInterval(timer)}},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>setBleSupport(window.isSecureContext&&(navigator as Navigator&{bluetooth?:unknown}).bluetooth?"ready":"unavailable"),0);return()=>window.clearTimeout(timer)},[]);
  useEffect(()=>{if(setupMode!=="esp32"||bleSupport!=="ready")return;let stopped=false;void getAuthorizedRfidBleReaders().then(readers=>{if(stopped)return;setBleReaders(readers);if(readers.length===1)setBleReader(current=>current||readers[0])}).catch(()=>undefined);return()=>{stopped=true}},[setupMode,bleSupport]);
  const create=async()=>{if(name.trim().length<3||busy)return;setBusy(true);setError("");try{const response=await fetch("/api/rfid/devices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:name.trim()})}),data=await response.json();if(!response.ok)throw new Error(data.error);setToken(data.token);setCopied(false);setName("RFID-Leser Vereinsheim");await load()}catch(reason){setError(reason instanceof Error?reason.message:"Einrichtung fehlgeschlagen")}finally{setBusy(false)}};
  const searchBleReader=async()=>{if(bleSearchBusy||bleBusy)return;setBleSearchBusy(true);setError("");setBleState("searching");setBleMessage("Android-Geräteauswahl ist geöffnet. Dort einmal ClubIQ-RFID-… antippen.");try{const reader=await selectRfidBleReader();setBleReaders(current=>[reader,...current.filter(item=>item.id!==reader.id)]);setBleReader(reader);setBleState("selected");setBleMessage(`${reader.name} ist für die einmalige WLAN-Einrichtung ausgewählt.`)}catch(reason){const message=reason instanceof DOMException&&reason.name==="NotFoundError"?"Keine Auswahl getroffen. Leser einschalten und Android-Auswahl erneut öffnen.":reason instanceof Error?reason.message:"Bluetooth-Suche fehlgeschlagen";setBleState("error");setBleMessage(message)}finally{setBleSearchBusy(false)}};
  const provisionBle=async()=>{if(!bleReader||bleBusy||bleName.trim().length<3||kioskSsid.trim().length<3||kioskPassword.length<12)return;setBleBusy(true);setError("");setNotice("");try{await provisionRfidReader(bleReader,{name:bleName.trim(),ssid:kioskSsid.trim(),password:kioskPassword},progress=>{setBleState(progress.state);setBleMessage(progress.message)});setKioskPassword("");setNotice(`${bleName.trim()} ist eingerichtet und verbindet sich ab jetzt selbstständig mit ${kioskSsid.trim()}. Bluetooth wird im Kassenbetrieb nicht benötigt.`);await load()}catch(reason){setBleState("error");setBleMessage(reason instanceof Error?reason.message:"WLAN-Einrichtung fehlgeschlagen")}finally{setBleBusy(false)}};
  const approvePairing=async(pairing:Pairing)=>{const code=(pairCodes[pairing.id]||"").replace(/\D/g,"");if(code.length!==6||pairingBusy)return;setPairingBusy(pairing.id);setError("");setNotice("");try{const response=await fetch("/api/rfid/pair",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id:pairing.id,code,name:pairing.name})}),data=await response.json();if(!response.ok)throw new Error(data.error);setPairCodes(current=>{const next={...current};delete next[pairing.id];return next});setNotice(`${pairing.name} wurde sicher freigegeben. Der Leser übernimmt die Anmeldung automatisch.`);await load()}catch(reason){setError(reason instanceof Error?reason.message:"Kopplung fehlgeschlagen")}finally{setPairingBusy(null)}};
  const rejectPairing=async(pairing:Pairing)=>{if(pairingBusy)return;setPairingBusy(pairing.id);setError("");try{const response=await fetch("/api/rfid/pair",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({id:pairing.id})}),data=await response.json();if(!response.ok)throw new Error(data.error);await load()}catch(reason){setError(reason instanceof Error?reason.message:"Kopplung konnte nicht verworfen werden")}finally{setPairingBusy(null)}};
  const toggle=async(device:Device)=>{const response=await fetch("/api/rfid/devices",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:device.id,active:!Boolean(device.active)})}),data=await response.json();if(!response.ok){setError(data.error||"Änderung fehlgeschlagen");return}load()};
  const restart=async(device:Device)=>{if(restarting||!confirm(`${device.name} neu starten? Der Leser ist für etwa 15 Sekunden nicht verfügbar.`))return;setRestarting(device.id);setError("");setNotice("");try{const response=await fetch("/api/rfid/commands",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId:device.id})}),data=await response.json();if(!response.ok)throw new Error(data.error||"Neustart konnte nicht gesendet werden");const started=Date.now();const timer=setInterval(async()=>{try{const statusResponse=await fetch(`/api/rfid/commands?id=${encodeURIComponent(data.id)}`,{cache:"no-store"}),statusData=await statusResponse.json();if(!statusResponse.ok)throw new Error(statusData.error);if(statusData.command?.status==="succeeded"){clearInterval(timer);setRestarting(null);setNotice(`${device.name} startet neu. Die Verbindung sollte in etwa 15 Sekunden wieder bereit sein.`);setTimeout(load,15000)}else if(["failed","expired"].includes(statusData.command?.status)||Date.now()-started>40000){clearInterval(timer);setRestarting(null);setError(statusData.command?.error||"Der Leser hat den Neustartauftrag nicht rechtzeitig abgeholt.")}}catch(reason){clearInterval(timer);setRestarting(null);setError(reason instanceof Error?reason.message:"Neustartstatus konnte nicht geprüft werden")}},1000)}catch(reason){setRestarting(null);setError(reason instanceof Error?reason.message:"Neustart fehlgeschlagen")}};
  const updateFirmware=async(device:Device)=>{
    if(updating||!device.firmwareVersion)return;
    if(!confirm(`${device.name} auf Firmware ${LATEST_RFID_FIRMWARE} aktualisieren? Der Leser startet danach automatisch neu.`))return;
    setUpdating(device.id);setUpdatePhase("Updateauftrag wartet auf den Leser …");setError("");setNotice("");
    try{
      const response=await fetch("/api/rfid/commands",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId:device.id,action:"firmware"})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||"Firmwareupdate konnte nicht gesendet werden");
      const started=Date.now();
      const timer=setInterval(async()=>{try{
        const statusResponse=await fetch(`/api/rfid/commands?id=${encodeURIComponent(data.id)}`,{cache:"no-store"}),statusData=await statusResponse.json();
        if(!statusResponse.ok)throw new Error(statusData.error);
        if(statusData.command?.status==="processing")setUpdatePhase("Firmware wird über das Kassen-WLAN installiert …");
        if(statusData.command?.status==="succeeded"){
          clearInterval(timer);setUpdating(null);setUpdatePhase("");setNotice(`${device.name} hat Firmware ${LATEST_RFID_FIRMWARE} installiert und startet neu. Er meldet sich danach selbstständig im Kassen-WLAN zurück.`);setTimeout(load,15_000);
        }else if(["failed","expired"].includes(statusData.command?.status)||Date.now()-started>14*60_000){
          clearInterval(timer);setUpdating(null);setUpdatePhase("");setError(statusData.command?.error||"Das Firmwareupdate wurde nicht abgeschlossen.");
        }
      }catch(reason){clearInterval(timer);setUpdating(null);setUpdatePhase("");setError(reason instanceof Error?reason.message:"Updatestatus konnte nicht geprüft werden")}},1000);
    }catch(reason){setUpdating(null);setUpdatePhase("");setError(reason instanceof Error?reason.message:"Firmwareupdate fehlgeschlagen")}
  };
  const unassign=async(card:CardMapping)=>{if(!confirm(`Karte ${card.uid} von ${card.memberName} trennen?`))return;const response=await fetch("/api/rfid/devices",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({uid:card.uid})}),data=await response.json();if(!response.ok){setError(data.error||"Zuordnung konnte nicht entfernt werden");return}load()};
  const copyToken=async()=>{try{await navigator.clipboard.writeText(token);setCopied(true)}catch{setError("Gerätekennung konnte nicht kopiert werden")}};
  const endpoint="https://10.42.0.1/api/rfid";
  const enabledDevices=devices.filter(device=>Boolean(device.active)).length;
  const updateCount=devices.filter(device=>firmwareNeedsUpdate(device.firmwareVersion)).length;
  const copyEndpoint=async()=>{try{await navigator.clipboard.writeText(endpoint);setNotice("Serveradresse wurde kopiert.")}catch{setError("Serveradresse konnte nicht kopiert werden")}};

  return <div className="rfid-admin-shell">
    {notice&&<p className="rfid-device-notice" role="status">{notice}</p>}
    {error&&<p className="profile-error" role="alert">{error}</p>}

    <section className="panel rfid-device-panel">
      <div className="panel-head"><div><p className="eyebrow">STATUS</p><h2>Verbundene Leser</h2><small>Hier siehst du sofort, welche Geräte einsatzbereit und aktuell sind.</small></div><span className={enabledDevices?"ready":"empty"}><IconNfc size={19}/>{enabledDevices} aktiv</span></div>
      <div className="rfid-flow-strip"><span>RFID-Leser</span><b>→ 2,4-GHz-WLAN →</b><span>Raspberry</span><b>→ WLAN →</b><span>Tablet-Kasse</span></div>
      <div className="rfid-ble-runtime online"><span><IconWifi size={20}/></span><div><strong>Festes Kassen-WLAN</strong><small>Leser und Tablet verwenden ClubIQ-Kasse. Internet ist für den laufenden Kassenbetrieb nicht erforderlich.</small></div><i/></div>
      <div className="rfid-summary-grid"><article><span>Registriert</span><strong>{devices.length}</strong></article><article><span>Aktiviert</span><strong>{enabledDevices}</strong></article><article className={updateCount?"attention":""}><span>Updates</span><strong>{updateCount}</strong></article><article><span>Karten</span><strong>{cards.length}</strong></article></div>
      <div className="rfid-device-list">{devices.map(device=>{
        const isEsp32=Boolean(device.hardwareId?.startsWith("ESP32-"));
        const lastSeen=device.lastSeenAt?new Date(device.lastSeenAt).getTime():0;
        const isOnline=Boolean(device.active)&&lastSeen>Date.now()-75_000;
        const needsUpdate=firmwareNeedsUpdate(device.firmwareVersion);
        const firmwareState=!device.firmwareVersion
          ?isEsp32?"Firmwarestand unbekannt · WLAN-Einrichtung prüfen":"Firmwarestand unbekannt · USB-Erstinstallation prüfen"
          :compareFirmware(device.firmwareVersion,LATEST_RFID_FIRMWARE)>0
            ?`Firmware ${device.firmwareVersion} · neuer als App`
            :`Firmware ${device.firmwareVersion}${needsUpdate?" · Update verfügbar":" · aktuell"}`;
        return <article key={device.id} className={device.active?"":"inactive"}><span><IconNfc size={22}/></span><div><strong>{device.name}</strong><small>{device.hardwareId?`${device.hardwareId} · `:""}{isOnline?"Im Kassen-WLAN verbunden und einsatzbereit":device.lastSeenAt?`Offline · zuletzt verbunden: ${new Date(device.lastSeenAt).toLocaleString("de-DE")}`:isEsp32?"Noch nicht im Kassen-WLAN angekommen":"Noch kein Scan empfangen"}</small><small className="rfid-firmware-state">{firmwareState}</small></div><div className="rfid-device-actions"><button className="firmware" disabled={!device.active||!needsUpdate||!isOnline||Boolean(updating)||Boolean(restarting)} onClick={()=>updateFirmware(device)}><IconRefresh size={17}/>{updating===device.id?"Update läuft …":"Firmware aktualisieren"}</button><button className="restart" disabled={!device.active||!isOnline||Boolean(restarting)||Boolean(updating)} onClick={()=>restart(device)}><IconRefresh size={17}/>{restarting===device.id?"Wird neu gestartet …":"Neu starten"}</button><button onClick={()=>toggle(device)}>{device.active?"Deaktivieren":"Aktivieren"}</button></div>{updating===device.id&&<div className="rfid-ota-progress" role="status" aria-live="polite"><div><strong>{updatePhase||"Updateauftrag wird vorbereitet"}</strong></div><progress/><small>Der Leser lädt das Update direkt über das Kassen-WLAN. Danach startet er neu und meldet sich selbstständig zurück.</small></div>}</article>;
      })}{!devices.length&&<div className="rfid-empty-state"><IconNfc size={30}/><strong>Noch kein RFID-Leser verbunden</strong><small>Wähle unten deinen vorhandenen ESP8266 oder einen neuen ESP32 aus.</small></div>}</div>
    </section>

    <section className="panel rfid-setup-panel">
      <div className="panel-head"><div><p className="eyebrow">LESER HINZUFÜGEN</p><h2>Wie möchtest du verbinden?</h2><small>Wähle den Gerätetyp. Es wird nur die dafür benötigte Anleitung angezeigt.</small></div></div>
      <div className="rfid-setup-picker" role="tablist" aria-label="RFID-Gerät auswählen">
        <button role="tab" aria-selected={setupMode==="esp32"} className={setupMode==="esp32"?"active":""} onClick={()=>setSetupMode("esp32")}><span><IconWifi size={25}/></span><div><strong>ESP32 ins Kassen-WLAN</strong><small>Einmal per App einrichten, danach läuft er selbstständig</small></div></button>
        <button role="tab" aria-selected={setupMode==="esp8266"} className={setupMode==="esp8266"?"active":""} onClick={()=>setSetupMode("esp8266")}><span><IconWifi size={25}/></span><div><strong>Alter ESP8266</strong><small>Nur für den bisherigen Leser-WLAN-Notfallweg</small></div></button>
      </div>

      {setupMode==="esp8266"&&<div className="rfid-setup-content rfid-esp8266-setup" role="tabpanel">
        <div className="rfid-setup-heading"><span><IconWifi size={26}/></span><div><strong>Vorhandenen ESP8266 verbinden</strong><small>Bluetooth ist dafür nicht nötig. Die Einrichtung erfolgt einmalig über das WLAN des Lesers.</small></div></div>
        <ol className="rfid-setup-steps"><li><span>1</span><div><strong>Zertifikat bereithalten</strong><small>Vor dem WLAN-Wechsel auf das Tablet herunterladen.</small><a href="/rfid-ca.crt" download="clubiq-ledger-ca.crt">ClubIQ-Zertifikat herunterladen</a></div></li><li><span>2</span><div><strong>Mit NFC-Reader-… verbinden</strong><small>Danach im Browser die Wartungsseite des Lesers öffnen.</small><a href="http://192.168.4.1" target="_blank" rel="noreferrer">192.168.4.1 öffnen</a></div></li><li><span>3</span><div><strong>Kassen-WLAN und Server speichern</strong><small>Diese Serveradresse im Leser verwenden:</small><div className="rfid-endpoint"><code>{endpoint}</code><button onClick={copyEndpoint}>Kopieren</button></div></div></li><li><span>4</span><div><strong>Kopplung hier freigeben</strong><small>Nach „Leser verbinden“ erscheint unten der sechsstellige Code.</small></div></li></ol>
        <div className="rfid-pairing-list">{pairings.map(pairing=><article key={pairing.id}><span><IconWifi size={22}/></span><div><strong>{pairing.name}</strong><small>{pairing.hardwareId} · gültig bis {new Date(pairing.expiresAt).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}</small></div><input aria-label={`Kopplungscode für ${pairing.name}`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-stelliger Code" value={pairCodes[pairing.id]||""} onChange={event=>setPairCodes(current=>({...current,[pairing.id]:event.target.value.replace(/\D/g,"").slice(0,6)}))}/><div><button className="secondary" disabled={Boolean(pairingBusy)} onClick={()=>rejectPairing(pairing)}>Verwerfen</button><button disabled={Boolean(pairingBusy)||(pairCodes[pairing.id]||"").length!==6} onClick={()=>approvePairing(pairing)}>{pairingBusy===pairing.id?"Wird gekoppelt …":"Freigeben"}</button></div></article>)}{!pairings.length&&<p className="rfid-pairing-wait"><IconNfc size={20}/> Noch kein Leser wartet auf Freigabe.</p>}</div>
      </div>}

      {setupMode==="esp32"&&<div className="rfid-setup-content" role="tabpanel">
        <div className="rfid-ble-setup">
          <div className="rfid-ble-heading"><span><IconWifi size={24}/></span><div><strong>ESP32 einmal ins Kassen-WLAN aufnehmen</strong><small>Bluetooth überträgt nur die Zugangsdaten. Danach kommuniziert der Leser direkt mit dem Raspberry.</small></div><em className={bleSupport}>{bleSupport==="ready"?"Einrichtung bereit":bleSupport==="checking"?"Wird geprüft":"Browser ungeeignet"}</em></div>
          {bleSupport==="unavailable"&&<p className="rfid-ble-warning">Bitte diese Seite mit Chrome auf einem Android-Tablet über die sichere HTTPS-Adresse öffnen.</p>}
          <section className="rfid-ble-device-step" aria-labelledby="rfid-ble-device-title"><div className="rfid-ble-step-title"><b>1</b><div><strong id="rfid-ble-device-title">Leser einmal auswählen</strong><small>Android zeigt einmal seine geschützte Bluetooth-Gerätefreigabe.</small></div></div>{bleReaders.length>0&&<div className="rfid-ble-reader-list">{bleReaders.map(reader=><button key={reader.id} className={bleReader?.id===reader.id?"selected":""} onClick={()=>{setBleReader(reader);setBleState("selected");setBleMessage(`${reader.name} ist für die WLAN-Einrichtung ausgewählt.`)}}><span><IconBluetooth size={20}/></span><div><strong>{reader.name}</strong><small>{bleReader?.id===reader.id?"Ausgewählt":"Bereits für diese App freigegeben"}</small></div>{bleReader?.id===reader.id&&<IconCheck size={20}/>}</button>)}</div>}<button className="rfid-ble-search" disabled={bleSupport!=="ready"||bleSearchBusy||bleBusy} onClick={searchBleReader}><IconBluetooth size={20}/>{bleSearchBusy?"Android-Auswahl ist geöffnet …":"Leser für die Einrichtung auswählen"}</button><small className="rfid-ble-browser-note">Dort <b>ClubIQ-RFID-…</b> antippen. Bluetooth wird nur für diese Einrichtung verwendet. Bei einer erneuten Einrichtung verlangt der Leser zur Sicherheit eine RFID-Karte direkt am Gerät.</small></section>
          <section className={`rfid-ble-config-step ${bleReader?"ready":"locked"}`} aria-labelledby="rfid-ble-config-title"><div className="rfid-ble-step-title"><b>2</b><div><strong id="rfid-ble-config-title">Kassen-WLAN übertragen</strong><small>{selectedRegisteredDevice?"Registrierter Leser · WLAN kann sicher geändert werden":bleReader?`${bleReader.name} ausgewählt`:"Zuerst oben einen Leser auswählen"}</small></div></div><div className="rfid-ble-fields"><label>Name des Lesers<input value={bleName} maxLength={60} autoComplete="off" disabled={!bleReader} onChange={event=>setBleName(event.target.value)} placeholder="z. B. Leser am Tresen"/></label><label>WLAN-Name<input value={kioskSsid} maxLength={32} autoCapitalize="none" autoComplete="off" disabled={!bleReader} onChange={event=>setKioskSsid(event.target.value)} placeholder="ClubIQ-Kasse"/></label><label>WLAN-Kennwort<input type="password" value={kioskPassword} minLength={12} maxLength={63} autoComplete="new-password" disabled={!bleReader} onChange={event=>setKioskPassword(event.target.value)} placeholder="Kennwort des Kassen-WLANs"/></label></div><div className="rfid-ble-direct-note"><IconCheck size={18}/><span><strong>Danach kein Bluetooth mehr nötig</strong><small>Scans, Display, Chip-Schreiben, Neustarts und Updates laufen direkt über das feste Kassen-WLAN.</small></span></div><button className="rfid-ble-connect" disabled={!bleReader||bleSupport!=="ready"||bleBusy||bleSearchBusy||bleName.trim().length<3||kioskSsid.trim().length<3||kioskPassword.length<12} onClick={provisionBle}><IconCheck size={20}/>{bleBusy?"WLAN wird übertragen …":selectedRegisteredDevice?"WLAN dieses Lesers aktualisieren":"Leser ins Kassen-WLAN aufnehmen"}</button></section>
          <div className={`rfid-ble-progress ${bleState}`} role="status"><span>{bleState==="approved"||bleState==="selected"?<IconCheck size={20}/>:bleState==="error"?<IconAlertCircle size={20}/>:<IconRefresh size={20}/>}</span><p>{bleMessage}</p></div>
        </div>
      </div>}
    </section>

    <details className="panel rfid-collapsible"><summary><span><strong>Zugeordnete Mitgliedskarten</strong><small>Verlorene oder ersetzte Karten trennen</small></span><b>{cards.length}</b></summary>{cards.length>0?<div className="rfid-card-mappings">{cards.map(card=><article key={card.uid}><span>{card.memberName}</span><code>{card.uid}</code><button onClick={()=>unassign(card)}>Trennen</button></article>)}</div>:<p>Noch keine Mitgliedskarte zugeordnet.</p>}</details>

    <details className="panel rfid-collapsible rfid-advanced"><summary><span><strong>Erweiterte Einrichtung</strong><small>Nur für ältere ESP8266-Leser und technische Notfälle</small></span></summary><div className="rfid-security-note"><strong>Die Karte speichert weder Geld noch Berechtigungen.</strong><small>Die UID erkennt nur die Person. Kontostände, Preise und Zugriffsrechte werden ausschließlich in PostgreSQL geprüft.</small></div><div className="rfid-device-create"><label>Bezeichnung<input value={name} maxLength={60} onChange={event=>setName(event.target.value)} placeholder="z. B. alter ESP8266-Leser"/></label><button disabled={busy||name.trim().length<3} onClick={create}>Notfall-Token erzeugen</button></div>{token&&<div className="rfid-token-once"><div><strong>Gerätekennung – nur jetzt sichtbar</strong><small>Ausschließlich für den manuellen WLAN-Rückfallweg.</small></div><div><code>{token}</code><button onClick={copyToken}>{copied?<IconCheck size={18}/>:<IconCopy size={18}/>} {copied?"Kopiert":"Kopieren"}</button></div></div>}<details className="rfid-network-help"><summary>Wie arbeitet der neue Kassen-WLAN-Betrieb?</summary><p>Der Raspberry stellt dauerhaft das 2,4-GHz-WLAN ClubIQ-Kasse bereit. Tablet und Leser bleiben in diesem Netz; der ESP32 überträgt signierte Scans direkt an den Raspberry. Ethernet wird nur für Internet, Fernzugriff, E-Mail, Sicherungen und Updates benötigt.</p></details></details>
  </div>;
}
