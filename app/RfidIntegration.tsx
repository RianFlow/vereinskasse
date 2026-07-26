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
  const [assigning,setAssigning]=useState(false);
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
    poll();const timer=setInterval(poll,1200);
    return()=>{stopped=true;clearInterval(timer)};
  },[]);

  const assign=async(member:Member)=>{
    if(state.kind!=="unknown")return;
    const response=await fetch("/api/rfid",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({scanId:state.scan.id,memberId:member.id})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Karte konnte nicht zugeordnet werden");
    holdUntil.current=Date.now()+3500;
    setState({kind:"recognized",deviceCount:state.deviceCount,scan:state.scan,member:data.member});
    setAssigning(false);onSelect(data.member);
  };
  const dismiss=()=>{holdUntil.current=0;setAssigning(false);setState({kind:"waiting",deviceCount:state.deviceCount})};

  const copy=state.kind==="recognized"
    ?{title:"Karte erkannt",detail:`${state.member.name} wurde für diese Bestellung ausgewählt.`}
    :state.kind==="unknown"
      ?{title:"Unbekannte Karte",detail:`UID ${state.scan.uid} ist noch keinem Mitglied zugeordnet.`}
      :state.kind==="error"
        ?{title:"Lesefehler",detail:state.message}
        :state.deviceCount
          ?{title:"Karte auflegen",detail:`${state.deviceCount===1?"RFID-Leser bereit":`${state.deviceCount} RFID-Leser bereit`} · die UID genügt.`}
          :{title:"RFID-Leser nicht eingerichtet",detail:"Ein Leser kann im Adminbereich unter Sicherheit verbunden werden."};

  return <><section className={`rfid-scan-status ${state.kind} ${state.kind==="waiting"&&!state.deviceCount?"not-configured":""}`} aria-live="polite">
    <span className="rfid-state-icon">{state.kind==="recognized"?<IconCheck size={23}/>:state.kind==="error"?<IconAlertCircle size={23}/>:<IconNfc size={23}/>}</span>
    <div><strong>{copy.title}</strong><small>{copy.detail}</small></div>
    {state.kind==="unknown"&&<div className="rfid-unknown-actions"><button onClick={()=>setAssigning(true)}>Mitglied zuordnen</button><button onClick={dismiss}>Später</button></div>}
  </section>
  {assigning&&state.kind==="unknown"&&<RfidAssignmentDialog uid={state.scan.uid} members={members} onClose={()=>setAssigning(false)} onAssign={assign}/>}</>;
}

function RfidAssignmentDialog({uid,members,onClose,onAssign}:{uid:string;members:Member[];onClose:()=>void;onAssign:(member:Member)=>Promise<void>}){
  const [query,setQuery]=useState(""),[busyId,setBusyId]=useState<string|null>(null),[error,setError]=useState("");
  const normalized=query.trim().toLocaleLowerCase("de-DE");
  const filtered=members.filter(member=>member.active!==false&&(!normalized||`${member.name} ${member.id}`.toLocaleLowerCase("de-DE").includes(normalized))).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const assign=async(member:Member)=>{setBusyId(member.id);setError("");try{await onAssign(member)}catch(reason){setError(reason instanceof Error?reason.message:"Zuordnung fehlgeschlagen");setBusyId(null)}};
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rfid-assignment-title"><div className="identity-card rfid-assignment-card">
    <button className="modal-close" aria-label="Fenster schließen" onClick={onClose}>×</button>
    <div className="identity-icon"><IconNfc size={28}/></div><p className="eyebrow">UNBEKANNTE KARTE</p>
    <h2 id="rfid-assignment-title">Mitglied zuordnen</h2><p className="identity-sub">Die UID <strong>{uid}</strong> wird nur als Kartenkennung gespeichert. Preise, Zechen und Berechtigungen bleiben in der Vereinskasse.</p>
    <label className="member-search"><span>⌕</span><input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name oder Mitgliedsnummer"/><small>{filtered.length} Treffer</small></label>
    <div className="rfid-member-results">{filtered.map(member=><button key={member.id} disabled={busyId!==null} onClick={()=>assign(member)}><span>{member.initials}</span><div><strong>{member.name}</strong><small>{member.id}</small></div><b>{busyId===member.id?"Wird gespeichert …":"Zuordnen ›"}</b></button>)}</div>
    {error&&<p className="profile-error" role="alert">{error}</p>}
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
    <div className="rfid-security-note"><strong>Die Karte ist kein Geldspeicher und kein Admin-Schlüssel.</strong><small>Kontostände, Preise und Berechtigungen werden ausschließlich serverseitig geprüft. Eine UID wählt nur ein Mitglied für die Kasse aus.</small></div>
    <div className="rfid-device-create"><label>Bezeichnung<input value={name} maxLength={60} onChange={event=>setName(event.target.value)} placeholder="z. B. Leser am Tresen"/></label><button disabled={busy||name.trim().length<3} onClick={create}>Leser verbinden</button></div>
    {token&&<div className="rfid-token-once"><div><strong>Gerätekennung – nur jetzt sichtbar</strong><small>In der ESP8266-Konfiguration als HTTP-Header <code>X-RFID-Token</code> hinterlegen.</small></div><div><code>{token}</code><button onClick={copyToken}>{copied?<IconCheck size={18}/>:<IconCopy size={18}/>} {copied?"Kopiert":"Kopieren"}</button></div><p>Ziel: <code>{endpoint}</code> · JSON: <code>{`{"uid":"12:34:56:78","type":"MIFARE 1KB","blocks":64}`}</code></p></div>}
    <div className="rfid-device-list">{devices.map(device=><article key={device.id} className={device.active?"":"inactive"}><span><IconNfc size={22}/></span><div><strong>{device.name}</strong><small>{device.lastSeenAt?`Zuletzt verbunden: ${new Date(device.lastSeenAt).toLocaleString("de-DE")}`:"Noch kein Scan empfangen"}</small></div><button onClick={()=>toggle(device)}>{device.active?"Deaktivieren":"Aktivieren"}</button></article>)}{!devices.length&&<p>Noch kein externer RFID-Leser eingerichtet.</p>}</div>
    {cards.length>0&&<div className="rfid-card-mappings"><div><strong>Zugeordnete Karten</strong><small>Verlorene oder ersetzte Karten hier sofort trennen.</small></div>{cards.map(card=><article key={card.uid}><span>{card.memberName}</span><code>{card.uid}</code><button onClick={()=>unassign(card)}>Trennen</button></article>)}</div>}
    <details className="rfid-network-help"><summary>Warum nicht direkt über 192.168.4.1?</summary><p>Das Tablet würde beim Wechsel in das Geräte-WLAN seine Serververbindung verlieren. Zusätzlich blockieren moderne Browser HTTP-Zugriffe aus einer HTTPS-App und verlangen CORS-Freigaben. Der ausgehende HTTPS-Scan vermeidet alle drei Probleme.</p></details>
    {error&&<p className="profile-error" role="alert">{error}</p>}
  </section>;
}
