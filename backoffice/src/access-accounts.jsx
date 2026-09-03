import React from 'react';

const roles={admin:'Vorstand',treasurer:'Kassenwart',viewer:'Lesezugang'};

export function AccessAccounts({accounts,user,busy,onAction}) {
  return <section className="card">
    <div className="section-head"><h2>Verwaltungszugänge</h2><button className="primary" disabled={busy} onClick={()=>onAction({type:'invite'})}>Person einladen</button></div>
    <p>Persönliche Zugänge für {user.profileName}. Sperren ist rückgängig zu machen. Löschen entfernt nur den Verwaltungszugang, nicht das Mitglied oder seine Rechnungen.</p>
    <div className="table-wrap"><table><thead><tr><th>Person</th><th>Rechte</th><th>Anmeldung</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>
      {accounts.map(a=><tr key={a.id}>
        <td><b>{a.name}</b><small>{a.email}</small>{a.id===user.userId&&<small>Dein eigener Zugang</small>}</td>
        <td>{roles[a.role]}</td><td>{a.verified?(a.mfa?'2-Faktor aktiv':'2-Faktor fehlt'):'Einladung offen'}</td>
        <td><span className={`badge ${a.active?'':'gold'}`}>{a.active?'Freigegeben':'Gesperrt'}</span></td>
        <td>{a.id===user.userId?<small>Geschützt – ein anderer Vorstand kann deinen Zugang verwalten.</small>:<div className="actions access-actions">
          <button className="secondary" disabled={busy} onClick={()=>onAction({type:'access',item:a})}>Rechte ändern</button>
          <button className="secondary" disabled={busy} onClick={()=>onAction({type:'access-state',item:a})}>{a.active?'Sperren':'Wieder freigeben'}</button>
          <button className="danger" disabled={busy} onClick={()=>onAction({type:'access-delete',item:a})}>Zugang löschen</button>
        </div>}</td>
      </tr>)}
    </tbody></table></div>
    <p className="small">Der eigene und der letzte aktive Vorstandszugang sind geschützt. Die Cloudflare-Zutrittsliste und E-Mail-Verteiler auf der Wartungsseite werden nicht automatisch geändert. Beim Ausscheiden einer Person dort ebenfalls die Freigaben entfernen.</p>
  </section>;
}
