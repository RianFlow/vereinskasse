#pragma once

const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NFC/RFID-Gerät</title><style>
:root{font-family:system-ui,sans-serif;color-scheme:dark;--a:#31d0aa;--bg:#101522;--card:#1a2233}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#edf4ff}
main{max-width:760px;margin:auto;padding:18px}.hero{display:flex;justify-content:space-between;align-items:center}
h1{font-size:clamp(1.45rem,5vw,2.2rem);margin:.5rem 0}.pill{background:#183b37;color:#8ff5d8;padding:7px 11px;border-radius:99px}
.card{background:var(--card);padding:18px;border-radius:16px;margin:14px 0;box-shadow:0 8px 24px #0004}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}@media(max-width:580px){.grid{grid-template-columns:1fr}}
label{display:block;color:#b9c7dc;font-size:.9rem;margin:8px 0 4px}input,select,button,textarea{width:100%;font:inherit;border-radius:10px;border:1px solid #44516a;padding:12px;background:#101827;color:white}
button{background:var(--a);color:#05251d;border:0;font-weight:700;cursor:pointer;margin-top:10px}
button.secondary{background:#344158;color:white}.danger{border:1px solid #9d4d58}.muted{color:#9dacbf;font-size:.88rem}
pre{white-space:pre-wrap;word-break:break-word;background:#0c111b;padding:12px;border-radius:10px;min-height:48px}
</style></head><body><main>
<div class="hero"><h1>NFC/RFID-Gerät</h1><span class="pill" id="state">bereit</span></div>
<section class="card"><h2>Vereinskasse</h2>
<div class="grid"><div><span class="muted">Vereins-WLAN</span><p id="wifiState">Status wird geladen ...</p></div>
<div><span class="muted">UID-Übertragung</span><p id="pushState">Status wird geladen ...</p></div></div>
<pre id="syncMessage">Noch keine Statusmeldung.</pre>
<p class="muted">Der Wartungszugang bleibt unter 192.168.4.1 erhalten. Kartenscans werden automatisch und verschlüsselt an die Vereinskasse gesendet, sobald WLAN, Geräte-Token und Zertifikat eingerichtet sind.</p>
</section>
<section class="card"><h2>Vereins-WLAN einrichten</h2>
<div class="grid"><div><label>WLAN-Name</label><input id="wifiSsid" list="wifiNetworks" maxlength="32" autocomplete="off"><datalist id="wifiNetworks"></datalist></div>
<div><label>WLAN-Kennwort</label><input id="wifiPassword" type="password" maxlength="63" autocomplete="new-password"></div></div>
<div class="grid"><button class="secondary" onclick="scanWifi()">WLANs suchen</button><button onclick="saveWifi()">WLAN speichern und verbinden</button></div>
<button class="secondary" onclick="deleteWifi()">Gespeichertes WLAN entfernen</button>
<p class="muted">Die Einstellung bleibt bei normalen Firmware-Updates erhalten. Das Kennwort wird nie angezeigt. Der geschützte Wartungszugang bleibt immer unter 192.168.4.1 erreichbar.</p>
<pre id="wifiOut">Noch keine Änderung.</pre></section>
<section class="card"><h2>Karte</h2><button onclick="uid()">UID lesen</button><pre id="uid">Noch keine Karte gelesen.</pre></section>
<section class="card"><h2>MIFARE-Classic-Block</h2><div class="grid">
<div><label>Blocknummer</label><input id="block" type="number" min="0" max="255" value="4"></div>
<div><label>Authentifizierung</label><select id="kt"><option value="A">Key A</option><option value="B">Key B</option></select></div>
</div><label>Schlüssel (6 Byte Hex)</label><input id="key" maxlength="12" value="FFFFFFFFFFFF" autocapitalize="characters">
<button onclick="readBlock()">Block lesen</button>
<label>Schreibformat</label><select id="fmt"><option value="hex">Hex verwenden</option><option value="text">Text verwenden</option></select>
<label>Hex (genau 16 Byte / 32 Zeichen)</label><textarea id="hex" rows="2" placeholder="00112233445566778899AABBCCDDEEFF"></textarea>
<label>Text (alternativ, max. 16 UTF-8-Byte)</label><input id="txt" maxlength="16" placeholder="Hallo">
<label>Sicherheitsbestätigung</label><input id="confirm" placeholder="SCHREIBEN eingeben">
<button class="danger" onclick="writeBlock()">Block schreiben und prüfen</button>
<p class="muted">Block 0 und Sektor-Trailer sind fest schreibgeschützt. Schlüssel werden nicht gespeichert.</p>
<pre id="out">Bereit.</pre></section></main><script>
const $=id=>document.getElementById(id),state=$('state');let csrf='';
async function call(path,data,method){state.textContent='arbeitet…';try{
 let o={method:method||(data?'POST':'GET'),headers:{}};if(data){o.headers['Content-Type']='application/x-www-form-urlencoded';o.body=new URLSearchParams(data)}
 let r=await fetch(path,o),j=await r.json();if(!r.ok)throw Error(j.error||'HTTP '+r.status);state.textContent='bereit';return j
}catch(e){state.textContent='Fehler';$('out').textContent=e.message;throw e}}
function common(){return{block:$('block').value,key:$('key').value,keyType:$('kt').value}}
async function uid(){let j=await call('/api/uid');$('uid').textContent=`UID: ${j.uid}\nTyp: ${j.type}\nGröße: ${j.blocks||'unbekannt'} Blöcke`}
async function readBlock(){let j=await call('/api/read',common());$('hex').value=j.hex;$('txt').value=j.text;$('out').textContent=`Block ${j.block} gelesen.\nUID: ${j.uid}`}
async function writeBlock(){let d=common();d.format=$('fmt').value;d.hex=$('hex').value;d.text=$('txt').value;d.confirm=$('confirm').value;let j=await call('/api/write',d);$('out').textContent=`Block ${j.block} geschrieben und verifiziert.\n${j.hex}`;$('confirm').value=''}
async function scanWifi(){try{let j=await call('/api/wifi/scan'),list=$('wifiNetworks');list.innerHTML='';j.networks.forEach(n=>{let o=document.createElement('option');o.value=n.ssid;o.label=`${n.rssi} dBm${n.secure?' · geschützt':' · offen'}`;list.appendChild(o)});$('wifiOut').textContent=`${j.networks.length} WLANs gefunden. Namen auswählen oder eingeben.`}catch(e){$('wifiOut').textContent=e.message}}
async function saveWifi(){try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten und erneut versuchen.');let ssid=$('wifiSsid').value.trim();if(!ssid)throw Error('Bitte einen WLAN-Namen eingeben.');$('wifiOut').textContent='WLAN wird dauerhaft gespeichert …';let j=await call('/api/wifi',{ssid,password:$('wifiPassword').value,_csrf:csrf,confirm:'SPEICHERN'});$('wifiPassword').value='';$('wifiOut').textContent=`✓ ${j.ssid} wurde gespeichert. Der Leser verbindet sich jetzt; dieser Wartungszugang bleibt geöffnet.`;setTimeout(refreshStatus,2500)}catch(e){$('wifiOut').textContent=`Nicht gespeichert: ${e.message}`}}
async function deleteWifi(){if(!confirm('Gespeichertes Vereins-WLAN wirklich entfernen?'))return;try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten.');$('wifiOut').textContent='WLAN-Einstellung wird entfernt …';await call('/api/wifi',{_csrf:csrf,confirm:'LOESCHEN'},'DELETE');$('wifiSsid').value='';$('wifiPassword').value='';$('wifiOut').textContent='✓ Vereins-WLAN entfernt. Wartungszugang bleibt aktiv.';setTimeout(refreshStatus,2000)}catch(e){$('wifiOut').textContent=`Nicht entfernt: ${e.message}`}}
async function refreshStatus(){try{let r=await fetch('/api/status',{cache:'no-store'}),j=await r.json();
 csrf=j.csrf||csrf;if(document.activeElement!==$('wifiSsid'))$('wifiSsid').value=j.stationSsid||'';
 $('wifiState').textContent=j.stationConnected?`Verbunden mit ${j.stationSsid} · ${j.stationIp}`:(j.stationConfigured?`${j.stationSsid} · nicht verbunden`:'Nicht eingerichtet');
 $('pushState').textContent=j.pushConfigured?(j.clockReady?'Bereit':'Warte auf sichere Uhrzeit'):'Nicht vollständig eingerichtet';
 $('syncMessage').textContent=j.message+(j.lastUid?`\nLetzte UID: ${j.lastUid}`:'');
}catch(e){$('wifiState').textContent='Status nicht erreichbar'}}
refreshStatus();setInterval(refreshStatus,3000);
</script></body></html>
)HTML";
