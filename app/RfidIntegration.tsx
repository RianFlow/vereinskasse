"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconCheck, IconCopy, IconNfc, IconWifi } from "@tabler/icons-react";

type Member={id:string;name:string;role:string;initials:string;active?:boolean};
type Scan={id:string;uid:string;deviceId:string;deviceName:string;cardType?:string|null;blocks?:number|null;createdAt:string};
type ScannerState=
  |{kind:"waiting";deviceCount:number}
  |{kind:"recognized";deviceCount:number;scan:Scan;member:Member}
  |{kind:"unknown";deviceCount:number;scan:Scan}
  |{kind:"error";deviceCount:number;message:string};

export function RfidScanner({members,onSelect}:{members:Member[];onSelect:(member:Member)=>void}){
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
          setState(next);onSelectRef.current(data.member);
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
    poll();const timer=setInterval(poll,500);
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
          :{title:"RFID offline",detail:"Leser, Strom und Vereins-WLAN prüfen."};

  const light=state.kind==="recognized"||state.kind==="waiting"&&state.deviceCount?"green":state.kind==="unknown"?"yellow":"red";
  return <button type="button" className={`rfid-header-status ${state.kind} ${light}`} onClick={dismiss} aria-live="polite" aria-label={`${copy.title}. ${copy.detail}`} title={copy.detail}>
    <span className="rfid-traffic-light" aria-hidden="true"><i/><i/><i/></span>
    <span><strong>{copy.title}</strong><small>{copy.detail}</small></span>
  </button>;
}

export function RfidAdminLogin({expectedMemberId,onVerified}:{expectedMemberId?:string;onVerified:(member:Member)=>void}){
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
        const response=await fetch(`/api/rfid?${query}`,{cache:"no-store"}),data=await response.json();
        if(!response.ok)throw new Error(data.error||"RFID-Anmeldung ist momentan nicht erreichbar");
        if(stopped)return;
        if(data.state==="recognized"&&data.member){
          finished.current=true;setState("success");setMessage(`✓ ${data.member.name} wurde sicher erkannt.`);
          setTimeout(()=>{if(!stopped)onVerifiedRef.current(data.member)},350);
        }else if(data.state==="unknown"){
          holdUntil.current=Date.now()+3500;setState("unknown");setMessage("Diese Karte ist noch keinem Mitglied zugeordnet.");
        }else if(data.state==="forbidden"){
          holdUntil.current=Date.now()+3500;setState("forbidden");setMessage(`${data.member?.name||"Diese Person"} hat keinen Adminzugang.`);
        }else if(data.state==="mismatch"){
          holdUntil.current=Date.now()+3500;setState("mismatch");setMessage(`Die Karte gehört zu ${data.member?.name||"einer anderen Person"}.`);
        }else if(Date.now()>=holdUntil.current){
          const online=Number(data.deviceCount||0)>0;setState("waiting");setMessage(online?"Leser ist online. Admin-Chip jetzt auflegen.":"Kein RFID-Leser online. Strom und Vereins-WLAN prüfen.");
        }
      }catch(reason){
        if(!stopped){setState("error");setMessage(reason instanceof Error?reason.message:"RFID-Anmeldung fehlgeschlagen")}
      }finally{busy=false}
    };
    poll();const timer=setInterval(poll,1000);
    return()=>{stopped=true;clearInterval(timer)};
  },[expectedMemberId]);
  return <div className={`rfid-admin-login ${state}`} aria-live="polite">
    <span>{state==="success"?<IconCheck size={25}/>:state==="error"||state==="forbidden"||state==="mismatch"?<IconAlertCircle size={25}/>:<IconNfc size={25}/>}</span>
    <div><strong>{state==="success"?"Admin-Chip erkannt":state==="checking"?"Leser wird geprüft":state==="waiting"?"Mit Chip anmelden":state==="unknown"?"Unbekannte Karte":state==="forbidden"?"Keine Adminberechtigung":state==="mismatch"?"Falsche Karte":"Lesefehler"}</strong><small>{message}</small></div>
  </div>;
}

export function RfidMemberCardDialog({member,onClose,onSaved}:{member:Member;onClose:()=>void;onSaved:()=>void}){
  const [scan,setScan]=useState<Scan|null>(null),[phase,setPhase]=useState<"scan"|"ready"|"saving"|"write"|"success"|"error">("scan");
  const [writeChip,setWriteChip]=useState(false),[block,setBlock]=useState(4),[text,setText]=useState(member.id.slice(0,16)),[message,setMessage]=useState("Verbindung zum Leser wird geprüft.");
  const textBytes=new TextEncoder().encode(text).length;
  useEffect(()=>{
    if(phase!=="scan")return;
    let stopped=false,busy=false;
    const poll=async()=>{if(stopped||busy)return;busy=true;try{const response=await fetch("/api/rfid",{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.error);if(data.scan&&!stopped){setScan(data.scan);setPhase("ready");setMessage(`Karte ${data.scan.uid} erkannt.`)}else if(!stopped)setMessage(Number(data.deviceCount||0)>0?"Leser ist online. Karte jetzt auflegen.":"Kein RFID-Leser online. Strom, Vereins-WLAN und Firmware prüfen.")}catch(reason){if(!stopped)setMessage(reason instanceof Error?reason.message:"Lesefehler")}finally{busy=false}};
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

type Device={id:string;name:string;active:boolean|number;lastSeenAt?:string|null;createdAt:string};
type CardMapping={uid:string;memberId:string;memberName:string;updatedAt:string};

export function RfidDevicePanel(){
  const [devices,setDevices]=useState<Device[]>([]),[cards,setCards]=useState<CardMapping[]>([]),[name,setName]=useState("RFID-Leser Vereinsheim"),[token,setToken]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
  const load=()=>fetch("/api/rfid/devices").then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setDevices(data.devices||[]);setCards(data.cards||[])}).catch(reason=>setError(reason instanceof Error?reason.message:"RFID-Leser konnten nicht geladen werden"));
  useEffect(()=>{load()},[]);
  const create=async()=>{if(name.trim().length<3||busy)return;setBusy(true);setError("");try{const response=await fetch("/api/rfid/devices",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:name.trim()})}),data=await response.json();if(!response.ok)throw new Error(data.error);setToken(data.token);setCopied(false);setName("RFID-Leser Vereinsheim");await load()}catch(reason){setError(reason instanceof Error?reason.message:"Einrichtung fehlgeschlagen")}finally{setBusy(false)}};
  const toggle=async(device:Device)=>{const response=await fetch("/api/rfid/devices",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:device.id,active:!Boolean(device.active)})}),data=await response.json();if(!response.ok){setError(data.error||"Änderung fehlgeschlagen");return}load()};
  const unassign=async(card:CardMapping)=>{if(!confirm(`Karte ${card.uid} von ${card.memberName} trennen?`))return;const response=await fetch("/api/rfid/devices",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({uid:card.uid})}),data=await response.json();if(!response.ok){setError(data.error||"Zuordnung konnte nicht entfernt werden");return}load()};
  const copyToken=async()=>{try{await navigator.clipboard.writeText(token);setCopied(true)}catch{setError("Gerätekennung konnte nicht kopiert werden")}};
  const endpoint=typeof location==="undefined"?"/api/rfid":`${location.origin}/api/rfid`;
  return <section className="panel rfid-device-panel"><div className="panel-head"><div><p className="eyebrow">EXTERNER KARTENLESER</p><h2>ESP8266 + MFRC522</h2></div><span><IconWifi size={20}/> UID-Push</span></div>
    <div className="rfid-architecture"><IconNfc size={28}/><div><strong>Empfohlene Verbindung</strong><small>ESP8266 und Tablet nutzen dasselbe Vereins-WLAN. Der Leser sendet nur die UID per HTTPS an die Vereinskasse – der Browser greift nicht auf 192.168.4.1 zu.</small></div></div>
    <div className="rfid-security-note"><strong>Die Karte speichert weder Geld noch Berechtigungen.</strong><small>Die UID erkennt nur die zugeordnete Person. Kontostände, Preise und ein möglicher Adminzugang werden bei jedem Scan ausschließlich in der Datenbank geprüft.</small></div>
    <div className="rfid-device-create"><label>Bezeichnung<input value={name} maxLength={60} onChange={event=>setName(event.target.value)} placeholder="z. B. Leser am Tresen"/></label><button disabled={busy||name.trim().length<3} onClick={create}>Leser verbinden</button></div>
    {token&&<div className="rfid-token-once"><div><strong>Gerätekennung – nur jetzt sichtbar</strong><small>In der ESP8266-Konfiguration als HTTP-Header <code>X-RFID-Token</code> hinterlegen.</small></div><div><code>{token}</code><button onClick={copyToken}>{copied?<IconCheck size={18}/>:<IconCopy size={18}/>} {copied?"Kopiert":"Kopieren"}</button></div><p>Ziel: <code>{endpoint}</code> · JSON: <code>{`{"uid":"12:34:56:78","type":"MIFARE 1KB","blocks":64}`}</code></p></div>}
    <div className="rfid-device-list">{devices.map(device=><article key={device.id} className={device.active?"":"inactive"}><span><IconNfc size={22}/></span><div><strong>{device.name}</strong><small>{device.lastSeenAt?`Zuletzt verbunden: ${new Date(device.lastSeenAt).toLocaleString("de-DE")}`:"Noch kein Scan empfangen"}</small></div><button onClick={()=>toggle(device)}>{device.active?"Deaktivieren":"Aktivieren"}</button></article>)}{!devices.length&&<p>Noch kein externer RFID-Leser eingerichtet.</p>}</div>
    {cards.length>0&&<div className="rfid-card-mappings"><div><strong>Zugeordnete Karten</strong><small>Verlorene oder ersetzte Karten hier sofort trennen.</small></div>{cards.map(card=><article key={card.uid}><span>{card.memberName}</span><code>{card.uid}</code><button onClick={()=>unassign(card)}>Trennen</button></article>)}</div>}
    <details className="rfid-network-help"><summary>Warum nicht direkt über 192.168.4.1?</summary><p>Das Tablet würde beim Wechsel in das Geräte-WLAN seine Serververbindung verlieren. Zusätzlich blockieren moderne Browser HTTP-Zugriffe aus einer HTTPS-App und verlangen CORS-Freigaben. Der ausgehende HTTPS-Scan vermeidet alle drei Probleme.</p></details>
    {error&&<p className="profile-error" role="alert">{error}</p>}
  </section>;
}
