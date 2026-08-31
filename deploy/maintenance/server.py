#!/usr/bin/env python3
"""Kleines, von Docker unabhaengiges ClubIQ-Wartungsportal."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import ipaddress
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request

HOST = os.environ.get("CLUBIQ_MAINTENANCE_HOST", "0.0.0.0")
PORT = int(os.environ.get("CLUBIQ_MAINTENANCE_PORT", "8091"))
PROJECT = os.environ.get("CLUBIQ_PROJECT_DIR", "/opt/clubiq-ledger/deploy/docker")
PIN_FILE = os.environ.get("CLUBIQ_MAINTENANCE_PIN_FILE", os.path.join(PROJECT, "secrets/maintenance_pin"))
COMPOSE = ["docker", "compose", "--env-file", ".env", "-f", "compose.yaml"]
KIOSK_CONNECTION = "clubiq-kassen-wlan"
UPLINK_CONNECTION = "clubiq-internet-wlan"
UPLINK_NEXT_CONNECTION = "clubiq-internet-wlan-next"
WIFI_COUNTRY = os.environ.get("CLUBIQ_WIFI_COUNTRY", "DE").strip().upper()
if not re.fullmatch(r"[A-Z]{2}", WIFI_COUNTRY):
    WIFI_COUNTRY = "DE"
ENV_FILE = os.path.join(PROJECT, ".env")
SMTP_PASSWORD_FILE = os.path.join(PROJECT, "secrets/smtp_password")
failures = {}
config_lock = threading.Lock()

HTML = r'''<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClubIQ Wartung</title><style>
:root{font-family:system-ui,sans-serif;color:#19231f;background:#edf1ee}*{box-sizing:border-box}body{margin:0}.top{background:#162a24;color:white;padding:18px 20px}.top small{color:#c6d6cf}.wrap{max-width:920px;margin:auto;padding:18px}.card{background:white;border:1px solid #d5ddd9;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 5px 18px #16342812}h1{font-size:22px;margin:0 0 3px}h2{font-size:18px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.state{padding:13px;border-radius:12px;background:#f3f5f4}.dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:8px;background:#8b9691}.ok .dot{background:#16835f}.bad .dot{background:#bd4138}.warn .dot{background:#d39418}.value{font-weight:750;margin-top:5px;overflow-wrap:anywhere}.actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}button,input,select{font:inherit;border-radius:10px;padding:13px;border:1px solid #aab6b0}input,select{background:#fff;color:#19231f;width:100%}button{font-weight:700;background:#1e5949;color:#fff;cursor:pointer}button.danger{background:#752e2e}button.secondary{background:#34443f}button:disabled{opacity:.5;cursor:not-allowed}.msg{min-height:24px;margin-top:12px;font-weight:650}.muted{color:#65726c;font-size:14px}.login{max-width:430px;margin:50px auto}.hidden{display:none}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field label{display:block;font-weight:700;margin:0 0 6px}.wifihead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.badge{background:#e4eee9;color:#1e5949;border-radius:999px;padding:7px 10px;font-size:13px;font-weight:750;white-space:nowrap}.hint{padding:12px;border-radius:11px;background:#eef6f2;margin:12px 0}.wifi-actions{display:grid;grid-template-columns:minmax(180px,.7fr) minmax(220px,1fr);gap:10px;margin-top:12px}.contact-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px}.contact-row button{padding:10px 14px;background:#752e2e}.section-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.section-actions button{min-width:220px}.password-note{display:block;margin-top:5px;color:#65726c;font-size:12px}@media(max-width:620px){.formgrid,.wifi-actions{grid-template-columns:1fr}.wifihead{display:block}.badge{display:inline-block;margin-top:8px}.login button{margin:8px 0 0!important;width:100%}.section-actions button{width:100%}}
</style></head>
<body><header class="top"><h1>ClubIQ Ledger · Wartung</h1><small>Lokale Hilfe – funktioniert auch ohne Internet</small></header><main class="wrap">
<section id="login" class="card login"><h2>Wartungs-PIN</h2><p class="muted">Die PIN liegt sicher auf dem Raspberry und ist unabhängig von den Mitgliederdaten.</p><input id="pin" inputmode="numeric" maxlength="6" placeholder="6-stellige PIN"><button style="margin-left:8px" onclick="login()">Öffnen</button><div id="loginMsg" class="msg"></div></section>
<div id="portal" class="hidden"><section class="card"><h2>Systemzustand</h2><div id="states" class="grid"></div><div class="muted" id="updated"></div></section>
<section class="card"><div class="wifihead"><div><h2>Internet-WLAN</h2><div class="muted">Der USB-WLAN-Stick verbindet den Raspberry mit dem Internet. BarverKasse bleibt dabei immer aktiv.</div></div><span id="wifiBadge" class="badge">wird geprüft</span></div>
<div id="wifiUnavailable" class="hint hidden"><b>USB-WLAN-Stick nicht erkannt.</b><br><span class="muted">Den FRITZ!WLAN AC 860 einstecken und „Erneut suchen“ wählen. Das interne Kassen-WLAN wird hier niemals verändert.</span></div>
<div class="formgrid"><div class="field"><label for="wifiNetwork">Gefundene WLAN-Netze</label><select id="wifiNetwork" disabled><option>Zuerst nach WLAN suchen</option></select></div><div class="field"><label for="wifiPassword">WLAN-Kennwort</label><input id="wifiPassword" type="password" autocomplete="new-password" placeholder="Kennwort des Vereins-WLANs"></div></div>
<div class="hint"><b>Empfehlung:</b> Wenn verfügbar, das 5-GHz-Netz auswählen. LAN bleibt automatisch der bevorzugte Internetweg; der WLAN-Stick übernimmt, sobald kein LAN angeschlossen ist.</div>
<div class="wifi-actions"><button class="secondary" id="scanButton" onclick="scanWifi()">WLAN-Netze suchen</button><button id="connectButton" onclick="connectWifi()" disabled>Ausgewähltes WLAN verbinden</button></div><div id="wifiMsg" class="msg"></div></section>
<section id="emailCard" class="card"><div class="wifihead"><div><h2>Rechnungs-E-Mail</h2><div class="muted">Mailkonto und zuständige Kassenwarte getrennt verwalten. Das Passwort bleibt ausschließlich auf dem Raspberry.</div></div><span id="emailBadge" class="badge">wird geprüft</span></div>
<div id="emailInsecure" class="hint hidden"><b>E-Mail-Einstellungen nur über HTTPS.</b><br><span class="muted">Öffne <a href="https://10.42.0.1/wartung/">https://10.42.0.1/wartung/</a>. Die HTTP-Notfallseite über Port 8091 überträgt bewusst keine Zugangsdaten.</span></div>
<div class="formgrid"><div class="field"><label for="smtpHost">SMTP-Server</label><input id="smtpHost" autocomplete="off" placeholder="smtp.gmail.com"></div><div class="field"><label for="smtpPort">Port und Sicherheit</label><div class="formgrid"><input id="smtpPort" inputmode="numeric" value="587"><select id="smtpSecurity"><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></div></div><div class="field"><label for="smtpUser">SMTP-Benutzername</label><input id="smtpUser" autocomplete="username" placeholder="kasse@example.de"></div><div class="field"><label for="smtpPassword">SMTP- oder App-Passwort</label><input id="smtpPassword" type="password" autocomplete="new-password" placeholder="Nur zum Ändern eingeben"><small class="password-note" id="smtpPasswordNote">Noch kein Passwort gespeichert</small></div><div class="field"><label for="smtpSender">Absender-E-Mail</label><input id="smtpSender" inputmode="email" autocomplete="email" placeholder="kasse@example.de"></div></div>
<div class="hint"><b>Kassenwarte / Antwortadressen</b><br><span class="muted">Antworten von Mitgliedern gehen an alle hier eingetragenen Adressen. Mehrere Personen mit der Rolle Kassenwart können weiterhin im Mitgliederbereich angelegt werden.</span><div id="cashManagers"></div><button type="button" class="secondary" style="margin-top:9px" onclick="addCashManager()">+ Kassenwart hinzufügen</button></div>
<div class="section-actions"><button id="saveEmailButton" onclick="saveEmail()">Speichern und Verbindung prüfen</button><button class="secondary" id="testEmailButton" onclick="testEmail()">Nur Verbindung prüfen</button></div><div id="emailMsg" class="msg"></div></section>
<section class="card"><h2>Sichere Schnellaktionen</h2><div class="actions"><button onclick="act('restart_stack')">Kasse neu starten</button><button class="secondary" onclick="act('restart_wifi')">Reader & Tablet neu verbinden</button><button class="secondary" onclick="act('backup')">Sicherung jetzt erstellen</button><button class="danger" onclick="act('reboot')">Raspberry neu starten</button></div><div id="msg" class="msg"></div></section>
<section class="card"><h2>Adressen</h2><p><b>Kasse:</b> <a href="https://10.42.0.1">https://10.42.0.1</a><br><b>Zertifikat:</b> <a href="http://10.42.0.1:8080/vereinskasse-ca.crt">herunterladen</a></p><p class="muted">„Kassen-WLAN neu verbinden“ trennt Tablet und Reader kurz. Danach verbinden sich beide selbstständig wieder.</p></section></div></main>
<script>let pin=sessionStorage.getItem('clubiq-maintenance-pin')||'',networks=[],emailLoaded=false;const secureMaintenance=location.protocol==='https:',maintenancePrefix=location.pathname.startsWith('/wartung')?'/wartung':'';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,opt={}){opt.headers={...(opt.headers||{}),'X-ClubIQ-Maintenance-Pin':pin};let r=await fetch(maintenancePrefix+path,opt);let j=await r.json().catch(()=>({error:'Ungültige Antwort'}));if(!r.ok)throw Error(j.error||'Fehler');return j}
async function login(){pin=document.getElementById('pin').value.trim();try{await load();sessionStorage.setItem('clubiq-maintenance-pin',pin);document.getElementById('login').classList.add('hidden');document.getElementById('portal').classList.remove('hidden')}catch(e){document.getElementById('loginMsg').textContent=e.message}}
function box(name,value,state){return `<div class="state ${state}"><span class="dot"></span>${esc(name)}<div class="value">${esc(value)}</div></div>`}
function setWifiState(w){let detected=!!w?.detected,connected=!!w?.connected,badge=document.getElementById('wifiBadge');badge.textContent=!detected?'Stick fehlt':connected?'verbunden':'Stick bereit';document.getElementById('wifiUnavailable').classList.toggle('hidden',detected);document.getElementById('scanButton').disabled=!detected;let text=!detected?'nicht erkannt':connected?`${w.ssid||w.connection} · ${w.ip||'Adresse wird bezogen'}`:`${w.interface} · bereit`;return {text,state:connected?'ok':detected?'warn':'bad'}}
async function load(){let s=await api('/api/status'),w=setWifiState(s.internetWifi);document.getElementById('states').innerHTML=box('Kassen-App',s.app?'bereit':'nicht erreichbar',s.app?'ok':'bad')+box('Docker',s.docker?'aktiv':'gestoppt',s.docker?'ok':'bad')+box('Kassen-WLAN',s.wifi?'aktiv':'nicht aktiv',s.wifi?'ok':'bad')+box('Geräte im WLAN',s.neighbors,s.neighbors>0?'ok':'warn')+box('Internet-WLAN',w.text,w.state)+box('Rechnungs-E-Mail',s.email.configured?'eingerichtet':'nicht eingerichtet',s.email.configured?'ok':'warn')+box('Letzte Sicherung',s.backup?'erfolgreich':'prüfen',s.backup?'ok':'warn')+box('USB-Sicherung',s.usb?'eingehängt':'nicht bereit',s.usb?'ok':'warn')+box('Freier Speicher',s.diskFree,s.diskPercent>15?'ok':'warn')+box('Internetweg',s.uplink,s.uplink==='offline'?'warn':'ok');document.getElementById('updated').textContent='Aktualisiert: '+new Date().toLocaleTimeString();setEmailState(s.email)}
function setEmailState(e){let badge=document.getElementById('emailBadge');badge.textContent=!secureMaintenance?'HTTPS nötig':e.configured?'eingerichtet':'nicht eingerichtet';document.getElementById('emailInsecure').classList.toggle('hidden',secureMaintenance);document.querySelectorAll('#emailCard input,#emailCard select,#emailCard button').forEach(control=>control.disabled=!secureMaintenance);if(emailLoaded)return;emailLoaded=true;document.getElementById('smtpHost').value=e.host||'';document.getElementById('smtpPort').value=e.port||587;document.getElementById('smtpSecurity').value=e.security||'starttls';document.getElementById('smtpUser').value=e.user||'';document.getElementById('smtpSender').value=e.sender||'';document.getElementById('smtpPasswordNote').textContent=e.passwordSet?'Passwort ist gespeichert · leer lassen, um es beizubehalten':'Noch kein Passwort gespeichert';renderCashManagers(e.cashManagers?.length?e.cashManagers:['']);if(!secureMaintenance)document.querySelectorAll('#emailCard input,#emailCard select,#emailCard button').forEach(control=>control.disabled=true)}
function cashManagerValues(){return [...document.querySelectorAll('.cash-manager-email')].map(input=>input.value.trim()).filter(Boolean)}
function renderCashManagers(values){let root=document.getElementById('cashManagers');root.innerHTML=values.map((value,index)=>`<div class="contact-row"><input class="cash-manager-email" inputmode="email" autocomplete="email" aria-label="E-Mail Kassenwart ${index+1}" value="${esc(value)}" placeholder="kassenwart@example.de"><button type="button" aria-label="Kassenwart entfernen" onclick="removeCashManager(${index})">Entfernen</button></div>`).join('')}
function addCashManager(){renderCashManagers([...cashManagerValues(),''])}
function removeCashManager(index){let values=[...document.querySelectorAll('.cash-manager-email')].map(input=>input.value.trim());values.splice(index,1);renderCashManagers(values.length?values:[''])}
async function saveEmail(){let b=document.getElementById('saveEmailButton'),m=document.getElementById('emailMsg');b.disabled=true;m.textContent='Einstellungen werden sicher gespeichert und geprüft …';try{let payload={host:document.getElementById('smtpHost').value.trim(),port:Number(document.getElementById('smtpPort').value),security:document.getElementById('smtpSecurity').value,user:document.getElementById('smtpUser').value.trim(),password:document.getElementById('smtpPassword').value,sender:document.getElementById('smtpSender').value.trim(),cashManagers:cashManagerValues()};let r=await api('/api/email-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});m.textContent=r.message;document.getElementById('smtpPassword').value='';emailLoaded=false;await load()}catch(e){m.textContent=e.message}finally{b.disabled=false}}
async function testEmail(){let b=document.getElementById('testEmailButton'),m=document.getElementById('emailMsg');b.disabled=true;m.textContent='Mailserver wird geprüft; es wird keine E-Mail versendet …';try{let r=await api('/api/email-test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});m.textContent=r.message}catch(e){m.textContent=e.message}finally{b.disabled=false}}
async function scanWifi(){let b=document.getElementById('scanButton'),m=document.getElementById('wifiMsg'),sel=document.getElementById('wifiNetwork');b.disabled=true;m.textContent='WLAN-Netze werden gesucht …';try{let r=await api('/api/internet-wifi/scan');networks=r.networks||[];sel.innerHTML=networks.length?networks.map((n,i)=>`<option value="${i}">${esc(n.ssid)} · ${n.band} · ${n.signal}% · ${esc(n.security||'offen')}</option>`).join(''):'<option>Keine WLAN-Netze gefunden</option>';sel.disabled=!networks.length;document.getElementById('connectButton').disabled=!networks.length;m.textContent=networks.length?`${networks.length} Netze gefunden. Gewünschtes Netz auswählen.`:'Keine Netze gefunden. Stickposition prüfen und erneut suchen.'}catch(e){m.textContent=e.message}finally{b.disabled=false}}
async function connectWifi(){let index=Number(document.getElementById('wifiNetwork').value),network=networks[index],password=document.getElementById('wifiPassword').value,b=document.getElementById('connectButton'),m=document.getElementById('wifiMsg');if(!network){m.textContent='Bitte zuerst ein WLAN auswählen.';return}b.disabled=true;m.textContent=`${network.ssid} wird verbunden …`;try{let r=await api('/api/internet-wifi/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssid:network.ssid,bssid:network.bssid,password})});m.textContent=r.message;document.getElementById('wifiPassword').value='';await load()}catch(e){m.textContent=e.message}finally{b.disabled=false}}
async function act(action){if((action==='reboot'||action==='restart_wifi')&&!confirm('Aktion wirklich ausführen?'))return;let m=document.getElementById('msg');m.textContent='Wird ausgeführt …';try{let r=await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});m.textContent=r.message;setTimeout(load,action==='restart_wifi'?12000:5000)}catch(e){m.textContent=e.message}}
if(pin)login();setInterval(()=>{if(!document.getElementById('portal').classList.contains('hidden'))load().catch(()=>{})},10000);</script></body></html>'''


def run(command, timeout=12):
    return subprocess.run(command, cwd=PROJECT, text=True, capture_output=True, timeout=timeout)


def active(service):
    return run(["systemctl", "is-active", "--quiet", service], 4).returncode == 0


def app_ready():
    try:
        urllib.request.urlopen("http://127.0.0.1:8090/api/profiles", timeout=3).read(32)
        return True
    except Exception:
        return False


def local_client(address):
    try:
        ip = ipaddress.ip_address(address)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


def split_nmcli(line):
    """Zerlegt die mit --escape yes ausgegebene nmcli-Zeile sicher."""
    values, current, escaped = [], [], False
    for character in line.rstrip("\n"):
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ":":
            values.append("".join(current))
            current = []
        else:
            current.append(character)
    if escaped:
        current.append("\\")
    values.append("".join(current))
    return values


def nmcli_integer(value):
    """Liest nmcli-Zahlen sowohl pur als auch mit lokalisierter Einheit."""
    match = re.search(r"-?\d+", value or "")
    if not match:
        raise ValueError(f"Keine Zahl in nmcli-Wert: {value!r}")
    return int(match.group(0))


def connection_exists(name):
    result = run(["nmcli", "--terse", "--fields", "NAME", "connection", "show"], 5)
    return result.returncode == 0 and name in result.stdout.splitlines()


def usb_wifi_interface():
    """Gibt nur ein zusaetzliches USB-WLAN zurueck, niemals das Kassen-WLAN."""
    result = run(["nmcli", "--terse", "--escape", "yes", "--fields", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"], 6)
    if result.returncode != 0:
        return None
    candidates = []
    for line in result.stdout.splitlines():
        parts = split_nmcli(line)
        if len(parts) < 4:
            continue
        device, device_type, state, connection = parts[:4]
        if device_type != "wifi" or device == "wlan0" or connection == KIOSK_CONNECTION:
            continue
        device_path = os.path.realpath(f"/sys/class/net/{device}/device")
        if "/usb" not in device_path:
            continue
        driver_path = os.path.realpath(f"/sys/class/net/{device}/device/driver")
        candidates.append({
            "interface": device,
            "state": state,
            "connection": "" if connection == "--" else connection,
            "driver": os.path.basename(driver_path) if os.path.exists(driver_path) else "unbekannt",
        })
    return candidates[0] if candidates else None


def connection_value(name, field):
    result = run(["nmcli", "--get-values", field, "connection", "show", name], 5)
    return result.stdout.strip() if result.returncode == 0 else ""


def internet_wifi_status():
    device = usb_wifi_interface()
    if not device:
        return {"detected": False, "connected": False}
    interface = device["interface"]
    connection = run(["nmcli", "--get-values", "GENERAL.CONNECTION", "device", "show", interface], 5).stdout.strip()
    state = run(["nmcli", "--get-values", "GENERAL.STATE", "device", "show", interface], 5).stdout.strip()
    address = run(["nmcli", "--get-values", "IP4.ADDRESS", "device", "show", interface], 5).stdout.splitlines()
    ip_address = address[0].split("/", 1)[0] if address else ""
    connected = bool(connection and connection != "--" and state.startswith("100"))
    ssid = connection_value(connection, "802-11-wireless.ssid") if connected else ""
    return {"detected": True, "connected": connected, "interface": interface, "driver": device["driver"], "connection": "" if connection == "--" else connection, "ssid": ssid, "ip": ip_address}


def prepare_usb_wifi(interface):
    """Bereitet den separaten USB-Stick vor, ohne das Kassen-WLAN anzutasten."""
    if shutil.which("rfkill"):
        run(["rfkill", "unblock", "wifi"], 8)
    managed = run(["nmcli", "device", "set", interface, "managed", "yes"], 8)
    if managed.returncode != 0:
        raise RuntimeError("USB-WLAN-Stick konnte nicht von NetworkManager übernommen werden.")
    run(["nmcli", "radio", "wifi", "on"], 8)
    if shutil.which("iw"):
        run(["iw", "reg", "set", WIFI_COUNTRY], 8)
    link = run(["ip", "link", "set", interface, "up"], 8)
    if link.returncode != 0:
        raise RuntimeError("USB-WLAN-Schnittstelle konnte nicht aktiviert werden.")
    time.sleep(1)


def scan_wifi_networks():
    device = usb_wifi_interface()
    if not device:
        raise RuntimeError("USB-WLAN-Stick nicht erkannt. Stick einstecken und erneut versuchen.")
    interface = device["interface"]
    prepare_usb_wifi(interface)
    result = run(["nmcli", "--terse", "--escape", "yes", "--fields", "BSSID,SSID,SIGNAL,SECURITY,FREQ", "device", "wifi", "list", "ifname", interface, "--rescan", "yes"], 35)
    if result.returncode != 0:
        raise RuntimeError("WLAN-Suche fehlgeschlagen. USB-Stick und Treiber prüfen.")
    found = {}
    for line in result.stdout.splitlines():
        parts = split_nmcli(line)
        if len(parts) < 5 or not parts[1]:
            continue
        bssid, ssid, signal_text, security, frequency_text = parts[:5]
        try:
            # Je nach NetworkManager-Version lautet FREQ entweder "2412"
            # oder "2412 MHz". Beide Formen muessen denselben Scan ergeben.
            signal = nmcli_integer(signal_text)
            frequency = nmcli_integer(frequency_text)
        except ValueError:
            continue
        band = "5 GHz" if frequency >= 4900 else "2,4 GHz"
        key = (ssid, band)
        network = {"bssid": bssid, "ssid": ssid, "signal": signal, "security": "offen" if security in ("", "--") else security, "band": band}
        if key not in found or signal > found[key]["signal"]:
            found[key] = network
    return sorted(found.values(), key=lambda item: (item["band"] != "5 GHz", -item["signal"], item["ssid"].casefold()))


def connect_internet_wifi(ssid, password, bssid=None):
    device = usb_wifi_interface()
    if not device:
        raise RuntimeError("USB-WLAN-Stick nicht erkannt.")
    if not isinstance(ssid, str) or not 1 <= len(ssid.encode("utf-8")) <= 32 or any(ord(char) < 32 for char in ssid):
        raise ValueError("Ungültiger WLAN-Name.")
    if not isinstance(password, str) or (password and not (8 <= len(password) <= 63 or re.fullmatch(r"[0-9A-Fa-f]{64}", password))):
        raise ValueError("Das WLAN-Kennwort muss 8 bis 63 Zeichen lang sein.")
    if bssid is not None and (not isinstance(bssid, str) or not re.fullmatch(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", bssid)):
        raise ValueError("Ungültige WLAN-Basisstation.")
    interface = device["interface"]
    prepare_usb_wifi(interface)
    had_previous = connection_exists(UPLINK_CONNECTION)
    if connection_exists(UPLINK_NEXT_CONNECTION):
        run(["nmcli", "connection", "delete", UPLINK_NEXT_CONNECTION], 15)
    command = ["nmcli", "--wait", "60", "device", "wifi", "connect", ssid]
    if password:
        command += ["password", password]
    command += ["ifname", interface]
    if bssid:
        command += ["bssid", bssid]
    command += ["name", UPLINK_NEXT_CONNECTION]
    result = run(command, 70)
    if result.returncode != 0:
        if connection_exists(UPLINK_NEXT_CONNECTION):
            run(["nmcli", "connection", "delete", UPLINK_NEXT_CONNECTION], 15)
        if had_previous:
            run(["nmcli", "--wait", "30", "connection", "up", UPLINK_CONNECTION, "ifname", interface], 38)
        raise RuntimeError("Verbindung fehlgeschlagen. WLAN-Kennwort und Empfang prüfen.")
    settings = run(["nmcli", "connection", "modify", UPLINK_NEXT_CONNECTION, "connection.autoconnect", "yes", "connection.autoconnect-priority", "20", "ipv4.route-metric", "600", "ipv6.route-metric", "600", "802-11-wireless.powersave", "2"], 15)
    if settings.returncode != 0:
        run(["nmcli", "connection", "delete", UPLINK_NEXT_CONNECTION], 15)
        if had_previous:
            run(["nmcli", "--wait", "30", "connection", "up", UPLINK_CONNECTION, "ifname", interface], 38)
        raise RuntimeError("WLAN wurde erreicht, die sichere Dauerkonfiguration ist aber fehlgeschlagen.")
    if had_previous:
        run(["nmcli", "connection", "delete", UPLINK_CONNECTION], 15)
    renamed = run(["nmcli", "connection", "modify", UPLINK_NEXT_CONNECTION, "connection.id", UPLINK_CONNECTION], 15)
    if renamed.returncode != 0:
        raise RuntimeError("WLAN ist verbunden, konnte aber nicht als dauerhafte Verbindung gespeichert werden.")
    return internet_wifi_status()


def read_environment():
    values = {}
    try:
        with open(ENV_FILE, encoding="utf-8") as source:
            for raw_line in source:
                line = raw_line.rstrip("\n")
                if not line or line.lstrip().startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key] = value.rstrip("\r")
    except OSError:
        pass
    return values


def valid_email(value):
    return isinstance(value, str) and len(value) <= 254 and not re.search(r"[\r\n]", value) and re.fullmatch(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", value) is not None


def sender_address(value):
    match = re.fullmatch(r".*<([^>]+)>.*", value or "")
    return match.group(1).strip() if match else (value or "").strip()


def email_settings_status():
    settings = read_environment()
    reply_addresses = []
    for address in settings.get("CLUBIQ_SMTP_REPLY_TO", "").split(","):
        address = address.strip()
        if address and valid_email(address) and address.casefold() not in [item.casefold() for item in reply_addresses]:
            reply_addresses.append(address)
    try:
        password_set = os.path.getsize(SMTP_PASSWORD_FILE) > 0
    except OSError:
        password_set = False
    host = settings.get("CLUBIQ_SMTP_HOST", "").strip()
    user = settings.get("CLUBIQ_SMTP_USER", "").strip()
    sender = sender_address(settings.get("CLUBIQ_SMTP_FROM", ""))
    try:
        port = int(settings.get("CLUBIQ_SMTP_PORT", "587"))
    except ValueError:
        port = 587
    security = settings.get("CLUBIQ_SMTP_SECURITY", "starttls").strip()
    configured = bool(host and user and valid_email(sender) and password_set and reply_addresses and security in ("starttls", "tls") and 1 <= port <= 65535)
    return {"configured": configured, "host": host, "port": port, "security": security if security in ("starttls", "tls") else "starttls", "user": user, "sender": sender, "cashManagers": reply_addresses, "passwordSet": password_set}


def update_environment(changes):
    try:
        with open(ENV_FILE, encoding="utf-8") as source:
            lines = source.read().splitlines()
    except OSError as error:
        raise RuntimeError("Die ClubIQ-Konfiguration ist nicht verfügbar.") from error
    output, remaining = [], dict(changes)
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0]
            if key in remaining:
                output.append(f"{key}={remaining.pop(key)}")
                continue
        output.append(line)
    output.extend(f"{key}={value}" for key, value in remaining.items())
    descriptor, temporary = tempfile.mkstemp(prefix=".env.clubiq-", dir=PROJECT, text=True)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as target:
            target.write("\n".join(output) + "\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, ENV_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def wait_for_app(timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if app_ready():
            return True
        time.sleep(2)
    return False


def verify_email_settings():
    result = run(COMPOSE + ["exec", "-T", "app", "node", "/app/raspberry/smtp-check.mjs"], 35)
    if result.returncode != 0:
        combined = f"{result.stdout}\n{result.stderr}"
        if re.search(r"auth|credential|login|535", combined, re.I):
            raise RuntimeError("Mailserver-Anmeldung abgelehnt. Benutzername und App-Passwort prüfen.")
        if re.search(r"timeout|timed out|connect|socket|dns|enotfound|econn", combined, re.I):
            raise RuntimeError("Mailserver nicht erreichbar. Internet-WLAN, Server und Port prüfen.")
        raise RuntimeError("Der Mailserver konnte die Einstellungen nicht bestätigen.")


def save_email_settings(data):
    host = str(data.get("host", "")).strip()
    user = str(data.get("user", "")).strip()
    password = str(data.get("password", ""))
    sender = str(data.get("sender", "")).strip()
    security = str(data.get("security", "starttls")).strip()
    contacts = data.get("cashManagers", [])
    try:
        port = int(data.get("port", 587))
    except (TypeError, ValueError):
        raise ValueError("Ungültiger SMTP-Port.")
    if not re.fullmatch(r"(?=.{1,253}$)[A-Za-z0-9.-]+", host) or ".." in host:
        raise ValueError("Ungültiger SMTP-Server.")
    if not 1 <= port <= 65535:
        raise ValueError("Der SMTP-Port muss zwischen 1 und 65535 liegen.")
    if security not in ("starttls", "tls"):
        raise ValueError("Als Sicherheit ist nur STARTTLS oder TLS erlaubt.")
    if not user or len(user) > 320 or re.search(r"[\r\n]", user):
        raise ValueError("Ungültiger SMTP-Benutzername.")
    if not valid_email(sender):
        raise ValueError("Ungültige Absender-E-Mail.")
    if not isinstance(contacts, list) or not 1 <= len(contacts) <= 10:
        raise ValueError("Mindestens ein und höchstens zehn Kassenwarte sind erlaubt.")
    normalized = []
    for raw_address in contacts:
        address = str(raw_address).strip()
        if not valid_email(address):
            raise ValueError("Eine Kassenwart-E-Mail-Adresse ist ungültig.")
        if address.casefold() not in [item.casefold() for item in normalized]:
            normalized.append(address)
    if not password:
        try:
            if os.path.getsize(SMTP_PASSWORD_FILE) <= 0:
                raise ValueError("Bitte das SMTP- oder App-Passwort eingeben.")
        except OSError:
            raise ValueError("Bitte das SMTP- oder App-Passwort eingeben.")
    elif len(password) > 1024 or re.search(r"[\r\n\x00]", password):
        raise ValueError("Das SMTP-Passwort enthält unzulässige Zeichen.")
    with config_lock:
        if password:
            os.makedirs(os.path.dirname(SMTP_PASSWORD_FILE), mode=0o700, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix="smtp-password-", dir=os.path.dirname(SMTP_PASSWORD_FILE))
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                    target.write(password)
                os.chmod(temporary, 0o600)
                os.replace(temporary, SMTP_PASSWORD_FILE)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        update_environment({"CLUBIQ_SMTP_HOST": host, "CLUBIQ_SMTP_PORT": str(port), "CLUBIQ_SMTP_SECURITY": security, "CLUBIQ_SMTP_USER": user, "CLUBIQ_SMTP_FROM": f"Clubiq Ledger <{sender}>", "CLUBIQ_SMTP_REPLY_TO": ",".join(normalized)})
        recreated = run(COMPOSE + ["up", "-d", "--no-deps", "--force-recreate", "app"], 180)
        if recreated.returncode != 0 or not wait_for_app():
            raise RuntimeError("Einstellungen gespeichert, aber die Kassen-App wurde nicht wieder erreichbar. Bitte Kasse neu starten.")
        verify_email_settings()
    return email_settings_status()


def do_later(action):
    def work():
        time.sleep(1.5)
        if action == "restart_stack":
            run(["/usr/local/sbin/clubiq", "starten"], 180)
        elif action == "restart_wifi":
            run(["nmcli", "connection", "down", KIOSK_CONNECTION], 30)
            time.sleep(2)
            run(["nmcli", "connection", "up", KIOSK_CONNECTION], 45)
        elif action == "backup":
            run(["/usr/local/sbin/clubiq", "sichern"], 180)
        elif action == "reboot":
            subprocess.run(["systemctl", "reboot"], timeout=5)
    threading.Thread(target=work, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    server_version = "ClubIQ-Maintenance"

    def log_message(self, fmt, *args):
        return

    def headers_common(self, content_type):
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self' 'unsafe-inline'; connect-src 'self'")
        self.send_header("Referrer-Policy", "no-referrer")

    def json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.headers_common("application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        address = self.client_address[0]
        if not local_client(address):
            return False
        blocked, count = failures.get(address, (0, 0))
        if blocked > time.time():
            return False
        try:
            expected = open(PIN_FILE, encoding="utf-8").read().strip()
        except OSError:
            return False
        supplied = self.headers.get("X-ClubIQ-Maintenance-Pin", "").strip()
        if len(supplied) == 6 and hmac.compare_digest(supplied, expected):
            failures.pop(address, None)
            return True
        count += 1
        failures[address] = (time.time() + 60 if count >= 5 else 0, 0 if count >= 5 else count)
        return False

    def do_GET(self):
        if self.path in ("/", "/wartung"):
            body = HTML.encode()
            self.send_response(200)
            self.headers_common("text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path not in ("/api/status", "/api/internet-wifi/scan"):
            self.json(404, {"error": "Nicht gefunden"})
            return
        if not self.allowed():
            self.json(401, {"error": "Wartungs-PIN falsch oder vorübergehend gesperrt"})
            return
        if self.path == "/api/internet-wifi/scan":
            try:
                self.json(200, {"networks": scan_wifi_networks()})
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                self.json(503, {"error": str(error)})
            return
        usage = shutil.disk_usage("/")
        neighbors = run(["ip", "neigh", "show", "dev", "wlan0"], 4)
        count = sum(1 for line in neighbors.stdout.splitlines() if "lladdr" in line and "FAILED" not in line)
        wifi = run(["nmcli", "-t", "-f", "GENERAL.CONNECTION", "device", "show", "wlan0"], 4)
        lan = run(["ip", "-4", "-o", "address", "show", "dev", "eth0", "scope", "global"], 4)
        internet_wifi = internet_wifi_status()
        backup = run(COMPOSE + ["exec", "-T", "backup", "sh", "-c", "cat /backups/local/.last-backup.json 2>/dev/null"], 6)
        try:
            backup_ok = json.loads(backup.stdout).get("ok") is True
        except Exception:
            backup_ok = False
        usb = run(["findmnt", "--mountpoint", "/mnt/vereinskasse-sicherung"], 4)
        uplink = "LAN" if lan.stdout.strip() else "Internet-WLAN" if internet_wifi.get("connected") else "offline"
        self.json(200, {"app": app_ready(), "docker": active("docker"), "wifi": KIOSK_CONNECTION in wifi.stdout, "neighbors": count, "lan": bool(lan.stdout.strip()), "internetWifi": internet_wifi, "email": email_settings_status(), "uplink": uplink, "backup": backup_ok, "usb": usb.returncode == 0, "diskFree": f"{usage.free / 1024**3:.1f} GB", "diskPercent": round(usage.free / usage.total * 100)})

    def do_POST(self):
        if self.path not in ("/api/action", "/api/internet-wifi/connect", "/api/email-settings", "/api/email-test"):
            self.json(404, {"error": "Nicht gefunden"})
            return
        if not self.allowed():
            self.json(401, {"error": "Wartungs-PIN falsch oder vorübergehend gesperrt"})
            return
        if self.path in ("/api/email-settings", "/api/email-test") and self.headers.get("X-Forwarded-Proto", "").lower() != "https":
            self.json(426, {"error": "E-Mail-Einstellungen sind ausschließlich über die HTTPS-Wartungsseite erlaubt."})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 8192)
            data = json.loads(self.rfile.read(length))
        except Exception:
            self.json(400, {"error": "Ungültige Anfrage"})
            return
        if self.path == "/api/internet-wifi/connect":
            try:
                status = connect_internet_wifi(data.get("ssid"), data.get("password", ""), data.get("bssid"))
                self.json(200, {"ok": True, "message": f"{status.get('ssid') or 'Internet-WLAN'} ist verbunden und wird künftig automatisch verwendet.", "status": status})
            except ValueError as error:
                self.json(400, {"error": str(error)})
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                self.json(503, {"error": str(error)})
            return
        if self.path == "/api/email-settings":
            try:
                status = save_email_settings(data)
                self.json(200, {"ok": True, "message": f"Rechnungs-E-Mail ist bereit. Antworten gehen an {len(status['cashManagers'])} Kassenwart/Kassenwarte.", "status": status})
            except ValueError as error:
                self.json(400, {"error": str(error)})
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                self.json(503, {"error": str(error)})
            return
        if self.path == "/api/email-test":
            try:
                if not email_settings_status()["configured"]:
                    raise ValueError("Bitte zuerst vollständige E-Mail-Einstellungen speichern.")
                verify_email_settings()
                self.json(200, {"ok": True, "message": "Mailserver-Verbindung und Anmeldung sind gültig. Es wurde keine E-Mail versendet."})
            except ValueError as error:
                self.json(400, {"error": str(error)})
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                self.json(503, {"error": str(error)})
            return
        action = data.get("action")
        messages = {"restart_stack": "Kasse wird neu gestartet.", "restart_wifi": "Kassen-WLAN startet neu. Bitte kurz warten.", "backup": "Sicherung wurde gestartet.", "reboot": "Raspberry startet neu. In etwa 90 Sekunden erneut öffnen."}
        if action not in messages:
            self.json(400, {"error": "Aktion nicht erlaubt"})
            return
        do_later(action)
        self.json(202, {"ok": True, "message": messages[action]})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
