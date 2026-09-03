import React,{useEffect,useState} from 'react';

export function ReportMail({api,month,user,busy,onSubmit,onClose}){
  const[state,setState]=useState(null),[selected,setSelected]=useState([]),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
  const[key]=useState(()=>crypto.randomUUID());
  useEffect(()=>{let active=true;api('/api/manage/mail-recipients').then(data=>{if(active){setState(data);setSelected(data.recipients.filter(r=>r.email===user.email).map(r=>r.id));}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api,user.email]);
  if(error)return <p className="notice error" role="alert">{error}</p>;
  if(!state)return <p role="status">Freigegebene Empfänger werden geladen …</p>;
  const submit=e=>{e.preventDefault();onSubmit({recipientIds:selected,confirmed,idempotencyKey:key});};
  return <form onSubmit={submit}>
    <p><b>Abrechnung {month}</b> · Übersicht, Einzelposten und druckbare Abrechnung als Anlagen. Bei einem offenen Monat wird die E-Mail als vorläufig gekennzeichnet.</p>
    <div className="mail-envelope"><span>Absender</span><b>{state.sender||'Noch nicht eingerichtet'}</b></div>
    {state.demo?<p className="notice">Lokales Testsystem: Der Versand wird nur simuliert. Es geht keine echte E-Mail hinaus.</p>:!state.configured&&<p className="notice error">Der Mailversand muss zuerst in der Wartungsseite eingerichtet werden.</p>}
    <fieldset className="recipient-list" disabled={busy}><legend>An wen soll die Abrechnung gehen?</legend>{state.recipients.map(recipient=><label key={recipient.id} className="recipient"><input type="checkbox" name="recipient" value={recipient.id} checked={selected.includes(recipient.id)} onChange={e=>{setSelected(current=>e.target.checked?[...current,recipient.id]:current.filter(id=>id!==recipient.id));setConfirmed(false);}}/><span><b>{recipient.name}</b><span className="recipient-address">{recipient.email}</span><small>{recipient.sources.join(' · ')}</small></span></label>)}</fieldset>
    <p className="small">Weitere Kassenwart-Adressen werden in der Wartungsseite hinterlegt. Persönliche Kassenwarte / Vorstände erscheinen nach Einladung und Bestätigung ihrer E-Mail-Adresse. Reine Lesezugänge werden nicht automatisch als Empfänger angeboten.</p>
    <p className="small">Jede ausgewählte Person erhält eine eigene E-Mail. Mitglieder-Einzelrechnungen und der automatische Monatsversand der Kasse werden dadurch nicht ausgelöst oder geändert.</p>
    <label className="check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Ich habe Monat und {selected.length} ausgewählte Empfänger geprüft. Sie dürfen die vollständige Vereinsabrechnung erhalten.</label>
    <div className="actions form-actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy||!confirmed||!selected.length||selected.length>10||!state.configured}>{busy?'Wird vorgemerkt …':state.demo?'Testversand simulieren':`An ${selected.length} Empfänger senden`}</button></div>
  </form>;
}
