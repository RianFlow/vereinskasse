const SERVICE_UUID="4a4f0001-7b5a-4f52-8844-434c55424951";
const RX_UUID="4a4f0002-7b5a-4f52-8844-434c55424951";
const TX_UUID="4a4f0003-7b5a-4f52-8844-434c55424951";

type BluetoothValueEvent=Event&{target:{value?:DataView|null}};
type BluetoothCharacteristic={
  startNotifications:()=>Promise<BluetoothCharacteristic>;
  addEventListener:(name:string,listener:(event:BluetoothValueEvent)=>void)=>void;
  removeEventListener:(name:string,listener:(event:BluetoothValueEvent)=>void)=>void;
  writeValueWithResponse:(value:BufferSource)=>Promise<void>;
  writeValueWithoutResponse?:(value:BufferSource)=>Promise<void>;
};
type BluetoothService={getCharacteristic:(uuid:string)=>Promise<BluetoothCharacteristic>};
type BluetoothServer={connected:boolean;connect:()=>Promise<BluetoothServer>;disconnect:()=>void;getPrimaryService:(uuid:string)=>Promise<BluetoothService>};
type BluetoothDevice={id:string;name?:string;gatt?:BluetoothServer;addEventListener?:(name:string,listener:()=>void)=>void;removeEventListener?:(name:string,listener:()=>void)=>void};
type BluetoothApi={
  requestDevice:(options:unknown)=>Promise<BluetoothDevice>;
  getDevices?:()=>Promise<BluetoothDevice[]>;
};

export type RfidBleProgress={state:string;message:string;hardwareId?:string};
export type RfidBleProvisionInput={name:string;ssid:string;password:string};
export type RfidBleReader={id:string;name:string;device:BluetoothDevice};
export type RfidBleRuntimeStatus={state:"unsupported"|"idle"|"connecting"|"online"|"error";message:string;readerName?:string;hardwareId?:string;updatedAt:number};

const OTA_UUID="4a4f0004-7b5a-4f52-8844-434c55424951";

const progressMessages:Record<string,string>={
  ready:"Leser gefunden. Einstellungen werden sicher übertragen …",
  confirmation_required:"Sicherheitsfreigabe: Jetzt eine RFID-Karte am Leser auflegen.",
  physical_confirmed:"Karte erkannt. Die neue Verbindung wird eingerichtet …",
  wifi_connecting:"Leser verbindet sich mit dem Vereins-WLAN …",
  securing_connection:"Sichere ClubIQ-Verbindung wird aufgebaut …",
  retrying_server:"ClubIQ wird erneut gesucht …",
  pairing:"Leser gefunden. Sichere Freigabe läuft automatisch …",
  approved:"Leser ist verbunden und einsatzbereit."
};

const base64=(value:string)=>{
  const bytes=new TextEncoder().encode(value);
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=4096)binary+=String.fromCharCode(...bytes.subarray(offset,offset+4096));
  return btoa(binary);
};

const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const randomHex=(bytes:number)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");

const bluetoothApi=()=>{
  const bluetooth=(navigator as Navigator&{bluetooth?:BluetoothApi}).bluetooth;
  if(!bluetooth)throw new Error("Bluetooth-Einrichtung wird von diesem Browser nicht unterstützt. Bitte Chrome auf dem Android-Tablet verwenden.");
  if(!window.isSecureContext)throw new Error("Bluetooth ist nur über die sichere HTTPS-Adresse von ClubIQ verfügbar.");
  return bluetooth;
};

const readerFrom=(device:BluetoothDevice):RfidBleReader=>({
  id:device.id,
  name:device.name?.trim()||"ClubIQ-RFID-Leser",
  device
});

export async function getAuthorizedRfidBleReaders(){
  const bluetooth=bluetoothApi();
  if(!bluetooth.getDevices)return [];
  const devices=await bluetooth.getDevices();
  return devices.filter(device=>device.name?.startsWith("ClubIQ-RFID-")&&device.gatt).map(readerFrom);
}

export async function selectRfidBleReader(){
  const device=await bluetoothApi().requestDevice({
    // Android fasst Namen und Service-UUID nicht auf jedem Chipsatz zuverlässig
    // zusammen, wenn der ESP32 sie auf Advertising und Scan Response verteilt.
    // Mehrere Filter werden als ODER ausgewertet und finden deshalb beide Fälle.
    filters:[{namePrefix:"ClubIQ-RFID-"},{services:[SERVICE_UUID]}],
    optionalServices:[SERVICE_UUID]
  });
  if(!device.gatt)throw new Error("Der ausgewählte Leser bietet keine Bluetooth-Verbindung an.");
  return readerFrom(device);
}

async function writeFrame(characteristic:BluetoothCharacteristic,payload:unknown){
  const bytes=new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
  for(let offset=0;offset<bytes.length;offset+=18){
    await characteristic.writeValueWithResponse(bytes.slice(offset,offset+18));
  }
}

async function approvePairing(hardwareId:string,code:string,name:string){
  const deadline=Date.now()+90_000;
  while(Date.now()<deadline){
    const response=await fetch("/api/rfid/pair",{cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Lesersuche ist momentan nicht möglich.");
    const pairing=(data.pairings||[]).find((entry:{hardwareId?:string})=>entry.hardwareId===hardwareId);
    if(pairing){
      const approval=await fetch("/api/rfid/pair",{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:pairing.id,code,name})
      });
      const result=await approval.json();
      if(!approval.ok)throw new Error(result.error||"Leser konnte nicht freigegeben werden.");
      return;
    }
    await delay(900);
  }
  throw new Error("Der Leser wurde nicht rechtzeitig in ClubIQ gefunden.");
}

export async function provisionRfidReader(reader:RfidBleReader,input:RfidBleProvisionInput,onProgress:(progress:RfidBleProgress)=>void){
  bluetoothApi();
  const device=reader.device;
  if(!device.gatt)throw new Error("Der ausgewählte Leser bietet keine Bluetooth-Verbindung an.");
  onProgress({state:"connecting",message:`${reader.name} wird mit ClubIQ verbunden …`});
  const server=await device.gatt.connect();
  const service=await server.getPrimaryService(SERVICE_UUID);
  const [rx,tx]=await Promise.all([service.getCharacteristic(RX_UUID),service.getCharacteristic(TX_UUID)]);
  await tx.startNotifications();

  let receiveBuffer="",finished=false,approvalStarted=false;
  let resolveFinished:()=>void=()=>undefined;
  let rejectFinished:(reason:Error)=>void=()=>undefined;
  const completion=new Promise<void>((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject});
  const decoder=new TextDecoder();
  const listener=(event:BluetoothValueEvent)=>{
    const view=event.target.value;
    if(!view)return;
    receiveBuffer+=decoder.decode(new Uint8Array(view.buffer,view.byteOffset,view.byteLength),{stream:true});
    let separator=receiveBuffer.indexOf("\n");
    while(separator>=0){
      const frame=receiveBuffer.slice(0,separator);receiveBuffer=receiveBuffer.slice(separator+1);
      separator=receiveBuffer.indexOf("\n");
      if(!frame)continue;
      try{
        const state=JSON.parse(frame) as {state?:string;message?:string;hardwareId?:string;code?:string};
        const stateName=state.state||"working";
        onProgress({state:stateName,message:state.message||progressMessages[stateName]||"Leser wird eingerichtet …",hardwareId:state.hardwareId});
        if(stateName==="error"){finished=true;rejectFinished(new Error(state.message||"Einrichtung am Leser fehlgeschlagen."));return}
        if(stateName==="pairing"&&state.hardwareId&&state.code&&!approvalStarted){
          approvalStarted=true;
          void approvePairing(state.hardwareId,state.code,input.name).then(()=>{
            onProgress({state:"approving",message:"Freigabe übertragen. Leser schließt die Einrichtung ab …",hardwareId:state.hardwareId});
          }).catch(reason=>{finished=true;rejectFinished(reason instanceof Error?reason:new Error("Freigabe fehlgeschlagen."))});
        }
        if(stateName==="approved"){finished=true;resolveFinished();return}
      }catch{finished=true;rejectFinished(new Error("Der Leser hat eine ungültige Bluetooth-Antwort gesendet."));return}
    }
  };
  tx.addEventListener("characteristicvaluechanged",listener);

  try{
    const certificateResponse=await fetch("/rfid-ca.crt",{cache:"no-store"});
    const rootCa=await certificateResponse.text();
    if(!certificateResponse.ok||!rootCa.includes("BEGIN CERTIFICATE"))throw new Error("Das ClubIQ-Zertifikat konnte nicht geladen werden.");
    const apiUrl=`${location.origin}/api/rfid`;
    await writeFrame(rx,{
      type:"provision",version:1,
      name:base64(input.name),ssid:base64(input.ssid),password:base64(input.password),
      apiUrl:base64(apiUrl),rootCa:base64(rootCa)
    });
    onProgress({state:"transferred",message:"Einstellungen übertragen. Der Leser verbindet sich jetzt …"});
    await Promise.race([
      completion,
      delay(150_000).then(()=>{if(!finished)throw new Error("Die Einrichtung hat zu lange gedauert. WLAN-Kennwort und Reichweite prüfen.")})
    ]);
  }finally{
    tx.removeEventListener("characteristicvaluechanged",listener);
    if(server.connected)server.disconnect();
  }
}

export async function pairRfidBleReader(reader:RfidBleReader,input:{name:string},onProgress:(progress:RfidBleProgress)=>void){
  bluetoothApi();
  const device=reader.device;
  if(!device.gatt)throw new Error("Der ausgewählte Leser bietet keine Bluetooth-Verbindung an.");
  rfidBleRuntime.pause();
  onProgress({state:"connecting",message:`${reader.name} wird direkt mit ClubIQ verbunden …`});
  const server=await device.gatt.connect();
  const service=await server.getPrimaryService(SERVICE_UUID);
  const [rx,tx]=await Promise.all([service.getCharacteristic(RX_UUID),service.getCharacteristic(TX_UUID)]);
  await tx.startNotifications();
  let receiveBuffer="",finished=false,pairingStarted=false;
  let resolveFinished:()=>void=()=>undefined,rejectFinished:(reason:Error)=>void=()=>undefined;
  const completion=new Promise<void>((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject});
  const decoder=new TextDecoder();
  const listener=(event:BluetoothValueEvent)=>{
    const view=event.target.value;if(!view)return;
    receiveBuffer+=decoder.decode(new Uint8Array(view.buffer,view.byteOffset,view.byteLength),{stream:true});
    let separator=receiveBuffer.indexOf("\n");
    while(separator>=0){
      const raw=receiveBuffer.slice(0,separator);receiveBuffer=receiveBuffer.slice(separator+1);separator=receiveBuffer.indexOf("\n");
      if(!raw)continue;
      try{
        const frame=JSON.parse(raw) as Record<string,unknown>,state=String(frame.state||"working"),message=String(frame.message||progressMessages[state]||"Leser wird verbunden …");
        onProgress({state,message,hardwareId:String(frame.hardwareId||"")||undefined});
        if(state==="error"){finished=true;rejectFinished(new Error(message));return}
        if(state==="pair_offer"&&!pairingStarted){
          pairingStarted=true;
          void (async()=>{
            const response=await fetch("/api/rfid/ble",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"pair",hardwareId:frame.hardwareId,tokenHash:frame.tokenHash,proof:frame.proof||undefined,name:input.name})});
            const result=await response.json();
            if(!response.ok)throw new Error(result.error||"Leser konnte nicht freigegeben werden.");
            await writeFrame(rx,{type:"pair_activate",approval:result.approval});
            onProgress({state:"approving",message:"Sichere Freigabe wird im Leser gespeichert …",hardwareId:String(frame.hardwareId||"")});
          })().catch(reason=>{finished=true;rejectFinished(reason instanceof Error?reason:new Error("Bluetooth-Kopplung fehlgeschlagen."))});
        }
        if(state==="approved"){finished=true;localStorage.setItem("clubiq-rfid-ble-reader",device.id);resolveFinished();return}
      }catch{finished=true;rejectFinished(new Error("Der Leser hat eine ungültige Bluetooth-Antwort gesendet."));return}
    }
  };
  tx.addEventListener("characteristicvaluechanged",listener);
  try{
    await writeFrame(rx,{type:"pair_ble",version:2});
    await Promise.race([completion,delay(120_000).then(()=>{if(!finished)throw new Error("Die Bluetooth-Kopplung hat zu lange gedauert.")})]);
  }finally{
    tx.removeEventListener("characteristicvaluechanged",listener);
    if(server.connected)server.disconnect();
    rfidBleRuntime.resume();
  }
}

type RuntimeFrame=Record<string,unknown>;
type DisplayPayload={state:"idle"|"cart";customerName:string;itemsText:string;itemCount:number;totalCents:number};

class RfidBleRuntime {
  private running=false;
  private paused=false;
  private connecting=false;
  private openingSession=false;
  private handshakePending=false;
  private retryTimer:ReturnType<typeof setTimeout>|null=null;
  private handshakeTimer:ReturnType<typeof setTimeout>|null=null;
  private retryDelay=800;
  private preferredReader:RfidBleReader|null=null;
  private device:BluetoothDevice|null=null;
  private server:BluetoothServer|null=null;
  private rx:BluetoothCharacteristic|null=null;
  private tx:BluetoothCharacteristic|null=null;
  private ota:BluetoothCharacteristic|null=null;
  private receiveBuffer="";
  private decoder=new TextDecoder();
  private writeQueue:Promise<void>=Promise.resolve();
  private sessionId="";
  private hardwareId="";
  private helloNonce="";
  private commandTimer:ReturnType<typeof setInterval>|null=null;
  private renewTimer:ReturnType<typeof setTimeout>|null=null;
  private activeCommand="";
  private scanRequests=new Set<string>();
  private otaReadyResolve:(()=>void)|null=null;
  private otaReadyReject:((reason:Error)=>void)|null=null;
  private listeners=new Set<(status:RfidBleRuntimeStatus)=>void>();
  private status:RfidBleRuntimeStatus={state:"idle",message:"Bluetooth-Leser wird vorbereitet.",updatedAt:Date.now()};
  private lastDisplay:DisplayPayload={state:"idle",customerName:"",itemsText:"",itemCount:0,totalCents:0};
  private disconnected=()=>this.handleDisconnect();
  private notification=(event:BluetoothValueEvent)=>this.handleNotification(event);

  subscribe(listener:(status:RfidBleRuntimeStatus)=>void){this.listeners.add(listener);listener(this.status);return()=>{this.listeners.delete(listener)}}
  snapshot(){return this.status}
  private update(next:Partial<RfidBleRuntimeStatus>){this.status={...this.status,...next,updatedAt:Date.now()};for(const listener of this.listeners)listener(this.status)}
  start(){if(this.running)return;this.running=true;this.paused=false;void this.connect()}
  stop(){this.running=false;this.paused=false;this.disconnect()}
  pause(){this.paused=true;this.disconnect()}
  resume(){this.paused=false;if(this.running)void this.connect()}
  prefer(reader:RfidBleReader){
    if(typeof localStorage!=="undefined")localStorage.setItem("clubiq-rfid-ble-reader",reader.id);
    this.preferredReader=reader;
    this.retryDelay=800;
    this.paused=false;
    this.update({state:"connecting",message:`${reader.name} wird mit ClubIQ verbunden …`,readerName:reader.name});
    this.disconnect(false);
    if(this.running)this.scheduleReconnect(100);
    else this.start();
  }
  setDisplay(payload:DisplayPayload){
    this.lastDisplay=payload;
    if(this.sessionId)void this.send({type:"display",...payload}).catch(reason=>this.handleTransportError(reason));
  }

  private async connect(){
    if(!this.running||this.paused)return;
    if(this.connecting){this.scheduleReconnect(250);return}
    if(this.server?.connected)return;
    this.connecting=true;this.update({state:"connecting",message:"Bluetooth-Leser wird verbunden …"});
    try{
      const selectedReader=this.preferredReader;
      const readers=selectedReader?[selectedReader]:await getAuthorizedRfidBleReaders();
      const preferred=typeof localStorage==="undefined"?"":localStorage.getItem("clubiq-rfid-ble-reader")||"";
      const reader=selectedReader||readers.find(item=>item.id===preferred)||readers[0];
      if(!reader){this.update({state:"idle",message:"Noch kein Bluetooth-Leser für diese Kasse freigegeben."});this.scheduleReconnect(5000);return}
      this.preferredReader=reader;
      this.device=reader.device;this.device.addEventListener?.("gattserverdisconnected",this.disconnected);
      this.server=await reader.device.gatt!.connect();
      const service=await this.server.getPrimaryService(SERVICE_UUID);
      [this.rx,this.tx,this.ota]=await Promise.all([service.getCharacteristic(RX_UUID),service.getCharacteristic(TX_UUID),service.getCharacteristic(OTA_UUID)]);
      await this.tx.startNotifications();this.tx.addEventListener("characteristicvaluechanged",this.notification);
      this.retryDelay=800;this.update({state:"connecting",message:"Leser gefunden. Sichere Sitzung wird aufgebaut …",readerName:reader.name});
      await this.beginHandshake();
    }catch(reason){
      const unsupported=reason instanceof Error&&/nicht unterstützt|HTTPS-Adresse/.test(reason.message);
      this.update({state:unsupported?"unsupported":"error",message:reason instanceof Error?reason.message:"Bluetooth-Verbindung fehlgeschlagen."});
      this.disconnect(false);if(!unsupported)this.scheduleReconnect();
    }finally{this.connecting=false}
  }

  private scheduleReconnect(delayMs?:number){if(!this.running||this.paused||this.retryTimer)return;const wait=delayMs??this.retryDelay;this.retryDelay=Math.min(this.retryDelay*2,10_000);this.retryTimer=setTimeout(()=>{this.retryTimer=null;void this.connect()},wait)}
  private disconnect(schedule=true){
    if(this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=null}
    if(this.handshakeTimer){clearTimeout(this.handshakeTimer);this.handshakeTimer=null}
    if(this.commandTimer){clearInterval(this.commandTimer);this.commandTimer=null}
    if(this.renewTimer){clearTimeout(this.renewTimer);this.renewTimer=null}
    this.sessionId="";this.hardwareId="";this.helloNonce="";this.openingSession=false;this.handshakePending=false;this.activeCommand="";this.scanRequests.clear();this.receiveBuffer="";
    this.otaReadyReject?.(new Error("Bluetooth-Verbindung während des Updates getrennt."));this.otaReadyResolve=null;this.otaReadyReject=null;
    if(this.tx)this.tx.removeEventListener("characteristicvaluechanged",this.notification);
    this.device?.removeEventListener?.("gattserverdisconnected",this.disconnected);
    if(this.server?.connected)this.server.disconnect();
    this.server=null;this.rx=null;this.tx=null;this.ota=null;this.device=null;
    if(schedule&&this.running&&!this.paused)this.scheduleReconnect();
  }
  private handleDisconnect(){this.update({state:"connecting",message:"Leser getrennt. ClubIQ verbindet automatisch neu …"});this.disconnect()}
  private handleTransportError(reason:unknown){
    this.update({state:"connecting",message:reason instanceof Error?`Leser getrennt: ${reason.message}`:"Leser getrennt. ClubIQ verbindet automatisch neu …"});
    this.disconnect();
  }
  private send(payload:unknown){
    if(!this.rx)return Promise.reject(new Error("Bluetooth-Leser ist nicht verbunden."));
    const characteristic=this.rx;this.writeQueue=this.writeQueue.catch(()=>{}).then(()=>writeFrame(characteristic,payload));return this.writeQueue;
  }
  private async beginHandshake(){
    if(this.handshakePending)return;
    this.handshakePending=true;
    this.helloNonce=randomHex(24);
    try{
      await this.send({type:"hello",version:3,nonce:this.helloNonce});
      if(this.handshakeTimer)clearTimeout(this.handshakeTimer);
      this.handshakeTimer=setTimeout(()=>{
        this.handshakeTimer=null;
        if(!this.handshakePending)return;
        this.handshakePending=false;
        this.handleTransportError(new Error("Leser antwortet nicht auf den sicheren Sitzungsaufbau."));
      },7000);
    }catch(reason){this.handshakePending=false;throw reason}
  }
  private handleNotification(event:BluetoothValueEvent){
    const view=event.target.value;if(!view)return;
    this.receiveBuffer+=this.decoder.decode(new Uint8Array(view.buffer,view.byteOffset,view.byteLength),{stream:true});
    let separator=this.receiveBuffer.indexOf("\n");
    while(separator>=0){
      const raw=this.receiveBuffer.slice(0,separator);this.receiveBuffer=this.receiveBuffer.slice(separator+1);separator=this.receiveBuffer.indexOf("\n");
      if(!raw)continue;
      try{
        void this.handleFrame(JSON.parse(raw) as RuntimeFrame).catch(reason=>this.handleTransportError(reason));
      }catch{
        this.update({state:"error",message:"Ungültige Antwort vom Bluetooth-Leser."});
      }
    }
  }
  private async handleFrame(frame:RuntimeFrame){
    const state=String(frame.state||"");
    if(state==="ready"){
      const hardwareId=String(frame.hardwareId||"");if(!/^ESP32-[0-9A-F]{6}$/.test(hardwareId))return;
      const nonce=String(frame.nonce||""),proof=String(frame.proof||""),firmwareVersion=String(frame.firmwareVersion||"");
      if(nonce!==this.helloNonce||!/^[0-9a-f]{64}$/.test(proof))return;
      if(this.handshakeTimer){clearTimeout(this.handshakeTimer);this.handshakeTimer=null}
      this.handshakePending=false;
      if(!this.sessionId&&!this.openingSession){this.openingSession=true;try{this.hardwareId=hardwareId;await this.openSession(nonce,proof,firmwareVersion)}finally{this.openingSession=false}}return;
    }
    if(state==="session_ready"){
      this.update({state:"online",message:"RFID-Leser bereit",hardwareId:this.hardwareId});
      await this.send({type:"display",...this.lastDisplay});
      if(this.commandTimer)clearInterval(this.commandTimer);this.commandTimer=setInterval(()=>void this.pollCommand(),1600);void this.pollCommand();return;
    }
    if(state==="session_expired"){await this.restartSession();return}
    if(state==="scan"){void this.relayScan(frame);return}
    if(state==="heartbeat"){void this.relayHeartbeat(frame);return}
    if(state==="command_result"){void this.relayCommandResult(frame);return}
    if(state==="ota_ready"){this.otaReadyResolve?.();this.otaReadyResolve=null;this.otaReadyReject=null;return}
    if(state==="ota_progress"){this.update({state:"online",message:`Firmwareupdate: ${Number(frame.percent||0)} %`,hardwareId:this.hardwareId});return}
    if(state==="error"){
      const error=new Error(String(frame.message||"Fehler am RFID-Leser."));this.otaReadyReject?.(error);this.otaReadyResolve=null;this.otaReadyReject=null;this.update({state:"error",message:error.message,hardwareId:this.hardwareId});
    }
  }
  private async openSession(nonce:string,proof:string,firmwareVersion:string){
    const response=await fetch("/api/rfid/ble",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"session",hardwareId:this.hardwareId,nonce,proof,firmwareVersion})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Bluetooth-Sitzung konnte nicht geöffnet werden.");
    this.sessionId=data.sessionId;await this.send({type:"session",sessionId:data.sessionId,nonce:data.nonce,expiresAt:data.expiresAt,authorization:data.authorization});
    if(this.renewTimer)clearTimeout(this.renewTimer);this.renewTimer=setTimeout(()=>void this.restartSession(),8*60_000);
  }
  private async restartSession(){
    if(this.openingSession||this.handshakePending||!this.server?.connected)return;
    this.sessionId="";
    if(this.commandTimer){clearInterval(this.commandTimer);this.commandTimer=null}
    await this.beginHandshake().catch(reason=>this.handleTransportError(reason));
  }
  private async relayHeartbeat(frame:RuntimeFrame){
    if(!this.sessionId)return;
    const response=await fetch("/api/rfid/ble",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"heartbeat",hardwareId:this.hardwareId,sessionId:this.sessionId,counter:frame.counter,firmwareVersion:frame.firmwareVersion,signature:frame.signature})}).catch(()=>null);
    if(response?.status===409)await this.restartSession();
  }
  private async relayScan(frame:RuntimeFrame){
    if(!this.sessionId)return;const key=`${this.sessionId}:${frame.counter}`;if(this.scanRequests.has(key))return;this.scanRequests.add(key);
    try{
      const response=await fetch("/api/rfid/ble",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"scan",hardwareId:this.hardwareId,sessionId:this.sessionId,counter:frame.counter,uid:frame.uid,cardType:frame.cardType,blocks:frame.blocks,firmwareVersion:frame.firmwareVersion,signature:frame.signature})});
      const data=await response.json();if(response.status===409){await this.restartSession();return}if(!response.ok)throw new Error(data.error||"RFID-Scan wurde nicht gespeichert.");
      await this.send({type:"scan_ack",counter:frame.counter,uid:frame.uid,state:data.state,memberName:data.memberName||"",acknowledgement:data.acknowledgement});
      this.update({state:"online",message:data.memberName?`${data.memberName} erkannt`:"Unbekannte Karte erkannt",hardwareId:this.hardwareId});
    }catch(reason){this.update({state:"error",message:reason instanceof Error?reason.message:"RFID-Scan konnte nicht übertragen werden.",hardwareId:this.hardwareId})}
    finally{this.scanRequests.delete(key)}
  }
  private async pollCommand(){
    if(!this.sessionId||this.activeCommand)return;
    try{
      const response=await fetch(`/api/rfid/ble?hardwareId=${encodeURIComponent(this.hardwareId)}&sessionId=${encodeURIComponent(this.sessionId)}`,{cache:"no-store"});
      if(response.status===204)return;if(response.status===409){await this.restartSession();return}const data=await response.json();if(!response.ok)throw new Error(data.error||"RFID-Auftrag konnte nicht geladen werden.");
      const command=data.command as Record<string,unknown>;this.activeCommand=String(command.id||"");if(!this.activeCommand)return;
      if(command.action==="firmware")await this.uploadFirmware(command);else await this.authorizeAndSend(command,0,"");
    }catch(reason){this.activeCommand="";this.update({state:"error",message:reason instanceof Error?reason.message:"RFID-Auftrag fehlgeschlagen.",hardwareId:this.hardwareId})}
  }
  private async authorizeAndSend(command:Record<string,unknown>,size:number,sha256:string){
    const response=await fetch("/api/rfid/ble",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"authorize_command",hardwareId:this.hardwareId,sessionId:this.sessionId,commandId:command.id,size,sha256})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"RFID-Auftrag konnte nicht freigegeben werden.");
    await this.send({type:"command",action:command.action,id:command.id,uid:command.uid,block:command.block,payload:command.payloadHex,expiresAt:command.expiresAt,size,sha256,authorization:data.authorization});
  }
  private async uploadFirmware(command:Record<string,unknown>){
    if(!this.ota)throw new Error("Der Leser unterstützt noch keine Bluetooth-Updates.");
    this.update({state:"online",message:"Firmware wird sicher vorbereitet …",hardwareId:this.hardwareId});
    const firmware=await fetch(String(command.firmwareUrl||""),{cache:"no-store"});if(!firmware.ok)throw new Error("Firmwaredatei konnte nicht geladen werden.");
    const bytes=new Uint8Array(await firmware.arrayBuffer());const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));const sha256=[...digest].map(byte=>byte.toString(16).padStart(2,"0")).join("");
    const ready=new Promise<void>((resolve,reject)=>{this.otaReadyResolve=resolve;this.otaReadyReject=reject});
    await this.authorizeAndSend(command,bytes.length,sha256);await Promise.race([ready,delay(12_000).then(()=>{throw new Error("Leser hat das Firmwareupdate nicht gestartet.")})]);
    const writer=this.ota.writeValueWithResponse.bind(this.ota);
    let chunkSize=180;
    for(let offset=0;offset<bytes.length;){
      const chunk=bytes.slice(offset,Math.min(offset+chunkSize,bytes.length));
      try{await writer(chunk)}catch(reason){if(chunkSize>18){chunkSize=18;continue}throw reason}
      offset+=chunk.length;
      if(offset%18_000<chunk.length)this.update({state:"online",message:`Firmwareupdate: ${Math.floor(offset*100/bytes.length)} %`,hardwareId:this.hardwareId});
    }
    await this.send({type:"ota_end",id:command.id});
  }
  private async relayCommandResult(frame:RuntimeFrame){
    if(!this.sessionId)return;
    try{
      const response=await fetch("/api/rfid/ble",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"command_result",hardwareId:this.hardwareId,sessionId:this.sessionId,commandId:frame.commandId,success:frame.success,uid:frame.uid,value:frame.value||"",error:frame.error||"",signature:frame.signature})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"RFID-Ergebnis konnte nicht bestätigt werden.");
      await this.send({type:"command_ack",id:frame.commandId,status:data.status,acknowledgement:data.acknowledgement});
      this.activeCommand="";this.update({state:"online",message:data.status==="succeeded"?"RFID-Auftrag abgeschlossen":"RFID-Auftrag fehlgeschlagen",hardwareId:this.hardwareId});
    }catch(reason){this.update({state:"error",message:reason instanceof Error?reason.message:"RFID-Ergebnis konnte nicht gespeichert werden.",hardwareId:this.hardwareId})}
  }
}

export const rfidBleRuntime=new RfidBleRuntime();
export const setRfidBleDisplayState=(payload:DisplayPayload)=>rfidBleRuntime.setDisplay(payload);
