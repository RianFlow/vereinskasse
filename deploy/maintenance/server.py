#!/usr/bin/env python3
"""Kleines, von Docker unabhaengiges ClubIQ-Wartungsportal."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import ipaddress
import json
import os
import shutil
import subprocess
import threading
import time
import urllib.request

HOST = os.environ.get("CLUBIQ_MAINTENANCE_HOST", "0.0.0.0")
PORT = int(os.environ.get("CLUBIQ_MAINTENANCE_PORT", "8091"))
PROJECT = os.environ.get("CLUBIQ_PROJECT_DIR", "/opt/clubiq-ledger/deploy/docker")
PIN_FILE = os.environ.get("CLUBIQ_MAINTENANCE_PIN_FILE", os.path.join(PROJECT, "secrets/maintenance_pin"))
COMPOSE = ["docker", "compose", "--env-file", ".env", "-f", "compose.yaml"]
failures = {}

HTML = r'''<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClubIQ Wartung</title><style>
:root{font-family:system-ui,sans-serif;color:#19231f;background:#edf1ee}*{box-sizing:border-box}body{margin:0}.top{background:#162a24;color:white;padding:18px 20px}.top small{color:#c6d6cf}.wrap{max-width:920px;margin:auto;padding:18px}.card{background:white;border:1px solid #d5ddd9;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 5px 18px #16342812}h1{font-size:22px;margin:0 0 3px}h2{font-size:18px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.state{padding:13px;border-radius:12px;background:#f3f5f4}.dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:8px;background:#8b9691}.ok .dot{background:#16835f}.bad .dot{background:#bd4138}.warn .dot{background:#d39418}.value{font-weight:750;margin-top:5px}.actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}button,input{font:inherit;border-radius:10px;padding:13px;border:1px solid #aab6b0}button{font-weight:700;background:#1e5949;color:#fff;cursor:pointer}button.danger{background:#752e2e}button.secondary{background:#34443f}button:disabled{opacity:.5}.msg{min-height:24px;margin-top:12px;font-weight:650}.muted{color:#65726c;font-size:14px}.login{max-width:430px;margin:50px auto}.hidden{display:none}</style></head>
<body><header class="top"><h1>ClubIQ Ledger · Wartung</h1><small>Lokale Hilfe – funktioniert auch ohne Internet</small></header><main class="wrap">
<section id="login" class="card login"><h2>Wartungs-PIN</h2><p class="muted">Die PIN liegt sicher auf dem Raspberry und ist unabhängig von den Mitgliederdaten.</p><input id="pin" inputmode="numeric" maxlength="6" placeholder="6-stellige PIN"><button style="margin-left:8px" onclick="login()">Öffnen</button><div id="loginMsg" class="msg"></div></section>
<div id="portal" class="hidden"><section class="card"><h2>Systemzustand</h2><div id="states" class="grid"></div><div class="muted" id="updated"></div></section>
<section class="card"><h2>Sichere Schnellaktionen</h2><div class="actions"><button onclick="act('restart_stack')">Kasse neu starten</button><button class="secondary" onclick="act('restart_wifi')">Reader & Tablet neu verbinden</button><button class="secondary" onclick="act('backup')">Sicherung jetzt erstellen</button><button class="danger" onclick="act('reboot')">Raspberry neu starten</button></div><div id="msg" class="msg"></div></section>
<section class="card"><h2>Adressen</h2><p><b>Kasse:</b> <a href="https://10.42.0.1">https://10.42.0.1</a><br><b>Zertifikat:</b> <a href="http://10.42.0.1:8080/vereinskasse-ca.crt">herunterladen</a></p><p class="muted">„Kassen-WLAN neu verbinden“ trennt Tablet und Reader kurz. Danach verbinden sich beide selbstständig wieder.</p></section></div></main>
<script>let pin=sessionStorage.getItem('clubiq-maintenance-pin')||'';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,opt={}){opt.headers={...(opt.headers||{}),'X-ClubIQ-Maintenance-Pin':pin};let r=await fetch(path,opt);let j=await r.json().catch(()=>({error:'Ungültige Antwort'}));if(!r.ok)throw Error(j.error||'Fehler');return j}
async function login(){pin=document.getElementById('pin').value.trim();try{await load();sessionStorage.setItem('clubiq-maintenance-pin',pin);document.getElementById('login').classList.add('hidden');document.getElementById('portal').classList.remove('hidden')}catch(e){document.getElementById('loginMsg').textContent=e.message}}
function box(name,value,state){return `<div class="state ${state}"><span class="dot"></span>${esc(name)}<div class="value">${esc(value)}</div></div>`}
async function load(){let s=await api('/api/status');document.getElementById('states').innerHTML=box('Kassen-App',s.app?'bereit':'nicht erreichbar',s.app?'ok':'bad')+box('Docker',s.docker?'aktiv':'gestoppt',s.docker?'ok':'bad')+box('Kassen-WLAN',s.wifi?'aktiv':'nicht aktiv',s.wifi?'ok':'bad')+box('Geräte im WLAN',s.neighbors,s.neighbors>0?'ok':'warn')+box('Letzte Sicherung',s.backup?'erfolgreich':'prüfen',s.backup?'ok':'warn')+box('USB-Sicherung',s.usb?'eingehängt':'nicht bereit',s.usb?'ok':'warn')+box('Freier Speicher',s.diskFree,s.diskPercent>15?'ok':'warn')+box('LAN / Internet',s.lan?'LAN verbunden':'Offline-Betrieb',s.lan?'ok':'warn');document.getElementById('updated').textContent='Aktualisiert: '+new Date().toLocaleTimeString()}
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

def do_later(action):
    def work():
        time.sleep(1.5)
        if action == "restart_stack":
            run(["/usr/local/sbin/clubiq", "starten"], 180)
        elif action == "restart_wifi":
            run(["nmcli", "connection", "down", "clubiq-kassen-wlan"], 30)
            time.sleep(2)
            run(["nmcli", "connection", "up", "clubiq-kassen-wlan"], 45)
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
        body=json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status); self.headers_common("application/json; charset=utf-8"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def allowed(self):
        address=self.client_address[0]
        if not local_client(address): return False
        blocked,count=failures.get(address,(0,0))
        if blocked>time.time(): return False
        try: expected=open(PIN_FILE,encoding="utf-8").read().strip()
        except OSError: return False
        supplied=self.headers.get("X-ClubIQ-Maintenance-Pin","").strip()
        if len(supplied)==6 and hmac.compare_digest(supplied,expected):
            failures.pop(address,None); return True
        count+=1; failures[address]=(time.time()+60 if count>=5 else 0,0 if count>=5 else count); return False
    def do_GET(self):
        if self.path in ("/","/wartung"):
            body=HTML.encode(); self.send_response(200); self.headers_common("text/html; charset=utf-8"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body); return
        if self.path!="/api/status": self.json(404,{"error":"Nicht gefunden"}); return
        if not self.allowed(): self.json(401,{"error":"Wartungs-PIN falsch oder vorübergehend gesperrt"}); return
        usage=shutil.disk_usage("/")
        neighbors=run(["ip","neigh","show","dev","wlan0"],4)
        count=sum(1 for line in neighbors.stdout.splitlines() if "lladdr" in line and "FAILED" not in line)
        wifi=run(["nmcli","-t","-f","GENERAL.CONNECTION","device","show","wlan0"],4)
        lan=run(["ip","-4","-o","address","show","dev","eth0","scope","global"],4)
        backup=run(COMPOSE+["exec","-T","backup","sh","-c","cat /backups/local/.last-backup.json 2>/dev/null"],6)
        try: backup_ok=json.loads(backup.stdout).get("ok") is True
        except Exception: backup_ok=False
        usb=run(["findmnt","--mountpoint","/mnt/vereinskasse-sicherung"],4)
        self.json(200,{"app":app_ready(),"docker":active("docker"),"wifi":"clubiq-kassen-wlan" in wifi.stdout,"neighbors":count,"lan":bool(lan.stdout.strip()),"backup":backup_ok,"usb":usb.returncode==0,"diskFree":f"{usage.free/1024**3:.1f} GB","diskPercent":round(usage.free/usage.total*100)})
    def do_POST(self):
        if self.path!="/api/action": self.json(404,{"error":"Nicht gefunden"}); return
        if not self.allowed(): self.json(401,{"error":"Wartungs-PIN falsch oder vorübergehend gesperrt"}); return
        try:
            length=min(int(self.headers.get("Content-Length","0")),1024); data=json.loads(self.rfile.read(length)); action=data.get("action")
        except Exception:
            self.json(400,{"error":"Ungültige Anfrage"}); return
        messages={"restart_stack":"Kasse wird neu gestartet.","restart_wifi":"Kassen-WLAN startet neu. Bitte kurz warten.","backup":"Sicherung wurde gestartet.","reboot":"Raspberry startet neu. In etwa 90 Sekunden erneut öffnen."}
        if action not in messages: self.json(400,{"error":"Aktion nicht erlaubt"}); return
        do_later(action); self.json(202,{"ok":True,"message":messages[action]})

if __name__ == "__main__":
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
