import { createHash } from 'node:crypto';
import { assert, email } from './security.mjs';

export function configuredRecipients(value = '') {
  assert(typeof value==='string' && value.length<=1600 && !/[\r\n]/.test(value),400,'Die Kassenwart-Adressen in der Wartungsseite prüfen.');
  return [...new Set(value.split(',').map(item=>item.trim()).filter(Boolean).map(item=>email(item.match(/^[^<>]*<([^<>]+)>$/)?.[1] || item)))];
}

export function recipientService(pool, config) {
  return {async list(actor) {
    const recipients = new Map();
    const add = (address,name,source) => {
      const normalized = email(address), existing=recipients.get(normalized);
      if(existing){if(!existing.sources.includes(source))existing.sources.push(source);return;}
      recipients.set(normalized,{id:createHash('sha256').update(normalized).digest('hex'),email:normalized,name,sources:[source]});
    };
    add(actor.email,actor.name,'Dein Verwaltungskonto');
    for(const address of config.cashManagerRecipients || [])add(address,'Kassenwart','Wartungsseite · Kassenwart-Empfänger');
    const {rows} = await pool.query(`SELECT u.name,u.email,g.role FROM bo_user u JOIN bo_grants g ON g.user_id=u.id
      WHERE g.profile_id=$1 AND g.active=true AND u."emailVerified"=true AND g.role IN ('admin','treasurer') ORDER BY u.name`,[actor.profileId]);
    for(const row of rows)add(row.email,row.name,row.role==='admin'?'Freigegebener Vorstand':'Freigegebener Kassenwart');
    return [...recipients.values()];
  }};
}

export function selectRecipients(available, ids) {
  assert(Array.isArray(ids) && ids.length>0 && ids.length<=10 && ids.every(id=>typeof id==='string'),400,'Bitte 1 bis 10 Empfänger auswählen.');
  const selected=[...new Set(ids)].map(id=>available.find(recipient=>recipient.id===id));
  assert(selected.every(Boolean),409,'Ein Empfänger ist nicht mehr freigegeben. Bitte die Empfängerliste neu öffnen.');
  return selected;
}
