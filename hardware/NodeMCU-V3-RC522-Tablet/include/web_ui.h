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
.warning{border-left:4px solid #e8b84d;padding-left:12px}.ok{color:#8ff5d8}
</style></head><body><main>
<div class="hero"><h1>NFC/RFID-Gerät</h1><span class="pill" id="state">bereit</span></div>
<section class="card"><h2>Vereinskasse</h2>
<div class="grid"><div><span class="muted">Vereins-WLAN</span><p id="wifiState">Status wird geladen ...</p></div>
<div><span class="muted">UID-Übertragung</span><p id="pushState">Status wird geladen ...</p></div></div>
<pre id="syncMessage">Noch keine Statusmeldung.</pre>
<p class="muted">Der Wartungszugang bleibt unter 192.168.4.1 erhalten. Kartenscans werden automatisch und verschlüsselt an die Vereinskasse gesendet, sobald WLAN, Zertifikat und die Kopplung eingerichtet sind.</p>
</section>
<section class="card"><h2>LED-Statusstreifen</h2>
<p id="ledHardware">5 LEDs an D8 / GPIO 15</p>
<button onclick="testLeds()">Alle 5 LEDs testen</button>
<p class="muted">Der Test schaltet nacheinander alle fünf LEDs ein und zeigt danach Rot, Grün, Blau und Weiß. Wenn nichts leuchtet: DIN, gemeinsame Masse und 5-V-Versorgung prüfen.</p>
<pre id="ledOut">Beim Einschalten läuft der Test automatisch.</pre></section>
<section class="card"><h2>Vereins-WLAN einrichten</h2>
<div class="grid"><div><label>WLAN-Name</label><input id="wifiSsid" list="wifiNetworks" maxlength="32" autocomplete="off"><datalist id="wifiNetworks"></datalist></div>
<div><label>WLAN-Kennwort</label><input id="wifiPassword" type="password" maxlength="63" autocomplete="new-password"></div></div>
<div class="grid"><button class="secondary" onclick="scanWifi()">WLANs suchen</button><button onclick="saveWifi()">WLAN speichern und verbinden</button></div>
<button class="secondary" onclick="deleteWifi()">Gespeichertes WLAN entfernen</button>
<p class="muted">Die Einstellung bleibt bei normalen Firmware-Updates erhalten. Das Kennwort wird nie angezeigt. Der geschützte Wartungszugang bleibt immer unter 192.168.4.1 erreichbar.</p>
<pre id="wifiOut">Noch keine Änderung.</pre></section>
<section class="card"><h2>Kassenserver einrichten</h2>
<label>Adresse der RFID-Schnittstelle</label>
<input id="serverUrl" maxlength="192" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="https://vereinskasse.local/api/rfid">
<label>Root-CA-Zertifikat (PEM)</label>
<textarea id="rootCa" rows="8" maxlength="2048" spellcheck="false" placeholder="-----BEGIN CERTIFICATE-----"></textarea>
<p class="muted warning">Für den Raspberry das Zertifikat im Vereins-WLAN unter <b>http://vereinskasse.local:8080/vereinskasse-ca.crt</b> öffnen und den gesamten Inhalt hier einfügen. Die Zertifikatsprüfung bleibt immer aktiv.</p>
<div class="grid"><button onclick="saveServer()">Server sicher speichern</button><button class="secondary" onclick="testServer()">Verbindung testen</button></div>
<details><summary>Notfallweg: Geräte-Token von Hand eintragen</summary><label>Geräte-Token</label><input id="deviceToken" type="password" maxlength="160" autocomplete="new-password" placeholder="Gespeicherten Token beibehalten"><p class="muted">Im Normalfall nicht nötig. Die Kopplung per Einmalcode richtet den Token automatisch ein.</p></details>
<p class="muted">Adresse, Anmeldung und Zertifikat bleiben bei normalen Firmware-Updates und WLAN-Wechseln erhalten.</p>
<pre id="serverOut">Servereinstellung wird geladen ...</pre></section>
<section class="card"><h2>Mit Clubiq Ledger koppeln</h2>
<p>Kein Kopieren langer Gerätekennungen: Der Leser erzeugt selbst eine sichere Anmeldung. Du bestätigst nur den sechsstelligen Einmalcode in der App.</p>
<button onclick="startPairing()">Kopplung starten</button>
<p class="muted">Voraussetzung: Vereins-WLAN, Serveradresse und Root-Zertifikat sind oben gespeichert. Danach in Clubiq Ledger unter Admin → Sicherheit → RFID-Leser freigeben.</p>
<pre id="pairOut">Noch keine Kopplung gestartet.</pre></section>
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
async function testLeds(){try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten.');let j=await call('/api/led-test',{_csrf:csrf,confirm:'TESTEN'});$('ledOut').textContent=`Test läuft: ${j.count} LEDs an ${j.pin}.`}catch(e){$('ledOut').textContent=`LED-Test fehlgeschlagen: ${e.message}`}}
async function scanWifi(){try{$('wifiOut').textContent='WLANs werden im Hintergrund gesucht …';let j;for(let i=0;i<24;i++){j=await call('/api/wifi/scan');if(!j.scanning)break;await new Promise(r=>setTimeout(r,250))}if(!j||j.scanning)throw Error('WLAN-Suche dauert ungewöhnlich lange. Bitte erneut versuchen.');let list=$('wifiNetworks');list.innerHTML='';j.networks.forEach(n=>{let o=document.createElement('option');o.value=n.ssid;o.label=`${n.rssi} dBm${n.secure?' · geschützt':' · offen'}`;list.appendChild(o)});$('wifiOut').textContent=`${j.networks.length} WLANs gefunden. Namen auswählen oder eingeben.`}catch(e){$('wifiOut').textContent=`WLAN-Suche fehlgeschlagen: ${e.message}`}}
async function saveWifi(){try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten und erneut versuchen.');let ssid=$('wifiSsid').value.trim();if(!ssid)throw Error('Bitte einen WLAN-Namen eingeben.');$('wifiOut').textContent='WLAN wird dauerhaft gespeichert …';let j=await call('/api/wifi',{ssid,password:$('wifiPassword').value,_csrf:csrf,confirm:'SPEICHERN'});$('wifiPassword').value='';$('wifiOut').textContent=`✓ ${j.ssid} wurde gespeichert. Der Leser verbindet sich jetzt; dieser Wartungszugang bleibt geöffnet.`;setTimeout(refreshStatus,2500)}catch(e){$('wifiOut').textContent=`Nicht gespeichert: ${e.message}`}}
async function deleteWifi(){if(!confirm('Gespeichertes Vereins-WLAN wirklich entfernen?'))return;try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten.');$('wifiOut').textContent='WLAN-Einstellung wird entfernt …';await call('/api/wifi',{_csrf:csrf,confirm:'LOESCHEN'},'DELETE');$('wifiSsid').value='';$('wifiPassword').value='';$('wifiOut').textContent='✓ Vereins-WLAN entfernt. Wartungszugang bleibt aktiv.';setTimeout(refreshStatus,2000)}catch(e){$('wifiOut').textContent=`Nicht entfernt: ${e.message}`}}
async function loadServer(){try{let j=await call('/api/server');$('serverUrl').value=j.apiUrl||'';$('rootCa').value=j.rootCa||'';$('deviceToken').placeholder=j.deviceTokenConfigured?'Token ist gespeichert – leer lassen zum Beibehalten':'Geräte-Token eingeben';$('serverOut').textContent=j.stored?'Serverdaten sind dauerhaft gespeichert.':'Aktuell gelten noch die Werte aus der Firmware.'}catch(e){$('serverOut').textContent=`Servereinstellung konnte nicht geladen werden: ${e.message}`}}
async function saveServer(){try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten.');let apiUrl=$('serverUrl').value.trim();if(!apiUrl)throw Error('Bitte die Serveradresse eingeben.');let rootCa=$('rootCa').value.trim();if(!rootCa)throw Error('Bitte das Root-CA-Zertifikat einfügen.');$('serverOut').textContent='Serverdaten werden dauerhaft und geschützt gespeichert …';let j=await call('/api/server',{apiUrl,deviceToken:$('deviceToken').value,rootCa,_csrf:csrf,confirm:'VERBINDEN'});$('deviceToken').value='';$('deviceToken').placeholder='Gespeicherte Anmeldung beibehalten';$('serverOut').textContent=`✓ ${j.apiUrl} wurde gespeichert. Jetzt Kopplung starten.`;setTimeout(refreshStatus,800)}catch(e){$('serverOut').textContent=`Nicht gespeichert: ${e.message}`}}
async function testServer(){try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten.');$('serverOut').textContent='Sichere Serververbindung wird geprüft …';let j=await call('/api/server/test',{_csrf:csrf,confirm:'TESTEN'});$('serverOut').textContent=`✓ Kassenserver erreichbar (HTTP ${j.status}).`}catch(e){$('serverOut').textContent=`Verbindung fehlgeschlagen: ${e.message}`}}
async function startPairing(){try{if(!csrf)throw Error('Leserstatus wird noch geladen. Bitte kurz warten.');$('pairOut').textContent='Sichere Kopplung wird gestartet …';let j=await call('/api/pair/start',{_csrf:csrf,confirm:'KOPPELN'});$('pairOut').textContent=`Kopplungscode: ${j.code}\nGerät: ${j.hardwareId}\n\nJetzt in Clubiq Ledger freigeben.`}catch(e){$('pairOut').textContent=`Kopplung fehlgeschlagen: ${e.message}`}}
async function refreshStatus(){try{let r=await fetch('/api/status',{cache:'no-store'}),j=await r.json();
 csrf=j.csrf||csrf;if(document.activeElement!==$('wifiSsid'))$('wifiSsid').value=j.stationSsid||'';
 $('wifiState').textContent=j.stationConnected?`Verbunden mit ${j.stationSsid} · ${j.stationIp}`:(j.stationConfigured?`${j.stationSsid} · nicht verbunden`:'Nicht eingerichtet');
 $('pushState').textContent=j.pushConfigured?(j.clockReady?`Bereit · ${j.serverUrl}`:'Warte auf sichere Uhrzeit'):'Nicht vollständig eingerichtet';
 $('ledHardware').textContent=`${j.ledCount||5} LEDs an ${j.ledPin||'D8 / GPIO 15'}${j.ledTestActive?' · Test läuft':''}`;
 $('syncMessage').textContent=j.message+(j.lastUid?`\nLetzte UID: ${j.lastUid}`:'');
 if(j.pairingState==='pending')$('pairOut').textContent=`Kopplungscode: ${j.pairingCode}\nGerät: ${j.hardwareId}\n\n${j.pairingMessage}`;
 else if(j.pairingState==='approved')$('pairOut').textContent=`✓ ${j.pairingMessage}`;
 else if(['error','expired','rejected'].includes(j.pairingState))$('pairOut').textContent=j.pairingMessage;
}catch(e){$('wifiState').textContent='Status nicht erreichbar'}}
refreshStatus();loadServer();setInterval(refreshStatus,3000);
</script></body></html>
)HTML";
