const SERVICE_UUID="4a4f0001-7b5a-4f52-8844-434c55424951";
const RX_UUID="4a4f0002-7b5a-4f52-8844-434c55424951";
const TX_UUID="4a4f0003-7b5a-4f52-8844-434c55424951";
const KIOSK_API_URL="https://10.42.0.1/api/rfid";

type BluetoothValueEvent=Event&{target:{value?:DataView|null}};
type BluetoothCharacteristic={
  startNotifications:()=>Promise<BluetoothCharacteristic>;
  addEventListener:(name:string,listener:(event:BluetoothValueEvent)=>void)=>void;
  removeEventListener:(name:string,listener:(event:BluetoothValueEvent)=>void)=>void;
  writeValueWithResponse:(value:BufferSource)=>Promise<void>;
};
type BluetoothService={getCharacteristic:(uuid:string)=>Promise<BluetoothCharacteristic>};
type BluetoothServer={connected:boolean;connect:()=>Promise<BluetoothServer>;disconnect:()=>void;getPrimaryService:(uuid:string)=>Promise<BluetoothService>};
type BluetoothDevice={
  id:string;
  name?:string;
  gatt?:BluetoothServer;
  addEventListener?:(name:string,listener:()=>void)=>void;
  removeEventListener?:(name:string,listener:()=>void)=>void;
};
type BluetoothApi={requestDevice:(options:unknown)=>Promise<BluetoothDevice>;getDevices?:()=>Promise<BluetoothDevice[]>};
type BleFrame={state?:string;message?:string;hardwareId?:string;tokenHash?:string;proof?:string};
type RegisteredDevice={hardwareId?:string|null;active?:boolean|number;lastSeenAt?:string|null;firmwareVersion?:string|null};

export type RfidBleProgress={state:string;message:string;hardwareId?:string};
export type RfidBleProvisionInput={name:string;ssid:string;password:string};
export type RfidBleReader={id:string;name:string;device:BluetoothDevice};

const progressMessages:Record<string,string>={
  ready:"Leser gefunden. Sichere Einrichtung wird vorbereitet …",
  confirmation_required:"Sicherheitsfreigabe: Jetzt eine RFID-Karte am Leser auflegen.",
  physical_confirmed:"Karte erkannt. Einstellungen werden gespeichert …",
  pair_offer:"Leser wird sicher in ClubIQ registriert …",
  approved:"Leser ist registriert. Kassen-WLAN wird übertragen …",
  settings_saved:"Einstellungen gespeichert. Leser startet neu …"
};

const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const randomHex=(bytes:number)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
const base64=(value:string)=>{
  const bytes=new TextEncoder().encode(value);
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=4096)binary+=String.fromCharCode(...bytes.subarray(offset,offset+4096));
  return btoa(binary);
};

const bluetoothApi=()=>{
  const bluetooth=(navigator as Navigator&{bluetooth?:BluetoothApi}).bluetooth;
  if(!bluetooth)throw new Error("Bluetooth-Einrichtung wird von diesem Browser nicht unterstützt. Bitte Chrome auf dem Android-Tablet verwenden.");
  if(!window.isSecureContext)throw new Error("Bluetooth ist nur über die sichere HTTPS-Adresse von ClubIQ verfügbar.");
  return bluetooth;
};

const readerFrom=(device:BluetoothDevice):RfidBleReader=>({id:device.id,name:device.name?.trim()||"ClubIQ-RFID-Leser",device});

export async function getAuthorizedRfidBleReaders(){
  const bluetooth=bluetoothApi();
  if(!bluetooth.getDevices)return [];
  const devices=await bluetooth.getDevices();
  return devices.filter(device=>device.name?.startsWith("ClubIQ-RFID-")&&device.gatt).map(readerFrom);
}

export async function selectRfidBleReader(){
  const device=await bluetoothApi().requestDevice({
    filters:[{namePrefix:"ClubIQ-RFID-"},{services:[SERVICE_UUID]}],
    optionalServices:[SERVICE_UUID]
  });
  if(!device.gatt)throw new Error("Der ausgewählte Leser bietet keine Bluetooth-Verbindung an.");
  return readerFrom(device);
}

async function writeFrame(characteristic:BluetoothCharacteristic,payload:unknown){
  const bytes=new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
  for(let offset=0;offset<bytes.length;offset+=18)await characteristic.writeValueWithResponse(bytes.slice(offset,offset+18));
}

async function loadRegisteredDevices(){
  const response=await fetch("/api/rfid/devices",{cache:"no-store"});
  const data=await response.json() as {error?:string;devices?:RegisteredDevice[]};
  if(!response.ok)throw new Error(data.error||"Leserstatus konnte nicht geladen werden.");
  return data.devices||[];
}

async function waitForWifiReader(hardwareId:string,baselineLastSeen:number,startedAt:number,onProgress:(progress:RfidBleProgress)=>void){
  const deadline=Date.now()+90_000;
  onProgress({state:"wifi_connecting",message:"Leser startet neu und verbindet sich mit dem Kassen-WLAN …",hardwareId});
  while(Date.now()<deadline){
    await delay(1000);
    const devices=await loadRegisteredDevices();
    const device=devices.find(entry=>entry.hardwareId===hardwareId&&Boolean(entry.active));
    const seenAt=device?.lastSeenAt?Date.parse(device.lastSeenAt):0;
    if(device&&seenAt>baselineLastSeen&&seenAt>=startedAt-5000){
      onProgress({state:"approved",message:`Leser ist über das Kassen-WLAN verbunden${device.firmwareVersion?` · Firmware ${device.firmwareVersion}`:""}.`,hardwareId});
      return;
    }
  }
  throw new Error("Die Einstellungen wurden gespeichert, aber der Leser hat den Raspberry nicht erreicht. WLAN-Kennwort, 2,4-GHz-Empfang und Stromversorgung prüfen.");
}

export async function provisionRfidReader(reader:RfidBleReader,input:RfidBleProvisionInput,onProgress:(progress:RfidBleProgress)=>void){
  bluetoothApi();
  const device=reader.device;
  if(!device.gatt)throw new Error("Der ausgewählte Leser bietet keine Bluetooth-Verbindung an.");

  const certificateResponse=await fetch("/rfid-ca.crt",{cache:"no-store"});
  const rootCa=await certificateResponse.text();
  if(!certificateResponse.ok||!rootCa.includes("BEGIN CERTIFICATE"))throw new Error("Das ClubIQ-Zertifikat konnte nicht geladen werden.");

  const startedAt=Date.now();
  onProgress({state:"connecting",message:`${reader.name} wird für die einmalige Einrichtung verbunden …`});
  const server=await device.gatt.connect();
  const service=await server.getPrimaryService(SERVICE_UUID);
  const [rx,tx]=await Promise.all([service.getCharacteristic(RX_UUID),service.getCharacteristic(TX_UUID)]);
  await tx.startNotifications();

  let receiveBuffer="",hardwareId="",provisionSent=false,pairRequested=false,pairing=false,settled=false,baselineLastSeen=0;
  let resolveStored:()=>void=()=>undefined,rejectStored:(reason:Error)=>void=()=>undefined;
  const stored=new Promise<void>((resolve,reject)=>{resolveStored=resolve;rejectStored=reject});
  const decoder=new TextDecoder();
  let actionQueue=Promise.resolve();

  const finishError=(reason:unknown)=>{
    if(settled)return;
    settled=true;
    rejectStored(reason instanceof Error?reason:new Error("Bluetooth-Einrichtung fehlgeschlagen."));
  };
  const sendProvision=async()=>{
    if(provisionSent)return;
    if(hardwareId){
      const devices=await loadRegisteredDevices();
      const existing=devices.find(entry=>entry.hardwareId===hardwareId);
      baselineLastSeen=existing?.lastSeenAt?Date.parse(existing.lastSeenAt):0;
    }
    provisionSent=true;
    onProgress({state:"transferring",message:"WLAN und ClubIQ-Zertifikat werden sicher gespeichert …",hardwareId:hardwareId||undefined});
    await writeFrame(rx,{
      type:"provision",version:2,
      name:base64(input.name),ssid:base64(input.ssid),password:base64(input.password),
      apiUrl:base64(KIOSK_API_URL),rootCa:base64(rootCa)
    });
  };
  const handleFrame=async(frame:BleFrame)=>{
    const state=String(frame.state||"working");
    if(frame.hardwareId)hardwareId=String(frame.hardwareId).toUpperCase();
    onProgress({state,message:frame.message||progressMessages[state]||"Leser wird eingerichtet …",hardwareId:hardwareId||undefined});
    if(state==="error")throw new Error(frame.message||"Einrichtung am Leser fehlgeschlagen.");
    if(state==="ready"){
      // Auch ein bereits bekannter Leser wird vor einer WLAN-Aenderung neu
      // bestaetigt. Damit heilt die Einrichtung veraltete Tokens kontrolliert,
      // statt mit einer scheinbar erfolgreichen, aber unbrauchbaren Verbindung
      // weiterzulaufen. Der Leser verlangt dafuer eine Karte direkt am Geraet.
      if(!pairRequested){pairRequested=true;await writeFrame(rx,{type:"pair_ble",version:2})}
      return;
    }
    if(state==="pair_offer"&&!pairing){
      pairing=true;
      const response=await fetch("/api/rfid/ble",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"pair",hardwareId:frame.hardwareId,tokenHash:frame.tokenHash,proof:frame.proof||undefined,name:input.name})
      });
      const result=await response.json() as {error?:string;approval?:string};
      if(!response.ok||!result.approval)throw new Error(result.error||"Leser konnte nicht sicher registriert werden.");
      await writeFrame(rx,{type:"pair_activate",approval:result.approval});
      return;
    }
    if(state==="approved"&&pairing){await sendProvision();return}
    if(state==="settings_saved"){
      if(!settled){settled=true;resolveStored()}
    }
  };
  const listener=(event:BluetoothValueEvent)=>{
    const view=event.target.value;
    if(!view)return;
    receiveBuffer+=decoder.decode(new Uint8Array(view.buffer,view.byteOffset,view.byteLength),{stream:true});
    let separator=receiveBuffer.indexOf("\n");
    while(separator>=0){
      const raw=receiveBuffer.slice(0,separator);
      receiveBuffer=receiveBuffer.slice(separator+1);
      separator=receiveBuffer.indexOf("\n");
      if(!raw)continue;
      try{
        const frame=JSON.parse(raw) as BleFrame;
        actionQueue=actionQueue.then(()=>handleFrame(frame)).catch(finishError);
      }catch{finishError(new Error("Der Leser hat eine unvollständige Bluetooth-Antwort gesendet."))}
    }
  };
  const disconnected=()=>{
    // Nach dem Speichern startet der ESP32 absichtlich neu. Falls Android die
    // letzte Benachrichtigung verschluckt, bestätigt anschließend der
    // Kassenserver eindeutig, ob die Einrichtung wirklich erfolgreich war.
    if(provisionSent&&!settled){settled=true;resolveStored()}
    else if(!settled)finishError(new Error("Bluetooth wurde vor dem Speichern getrennt. Bitte erneut verbinden."));
  };
  tx.addEventListener("characteristicvaluechanged",listener);
  device.addEventListener?.("gattserverdisconnected",disconnected);

  try{
    await writeFrame(rx,{type:"hello",nonce:randomHex(24)});
    await Promise.race([stored,delay(60_000).then(()=>{throw new Error("Der Leser hat die WLAN-Einstellungen nicht rechtzeitig bestätigt.")})]);
  }finally{
    tx.removeEventListener("characteristicvaluechanged",listener);
    device.removeEventListener?.("gattserverdisconnected",disconnected);
    if(server.connected)server.disconnect();
  }
  if(!hardwareId)throw new Error("Die Gerätekennung des Lesers fehlt.");
  await waitForWifiReader(hardwareId,baselineLastSeen,startedAt,onProgress);
}
