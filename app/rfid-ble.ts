const SERVICE_UUID="4a4f0001-7b5a-4f52-8844-434c55424951";
const RX_UUID="4a4f0002-7b5a-4f52-8844-434c55424951";
const TX_UUID="4a4f0003-7b5a-4f52-8844-434c55424951";

type BluetoothValueEvent=Event&{target:{value?:DataView|null}};
type BluetoothCharacteristic={
  startNotifications:()=>Promise<BluetoothCharacteristic>;
  addEventListener:(name:string,listener:(event:BluetoothValueEvent)=>void)=>void;
  removeEventListener:(name:string,listener:(event:BluetoothValueEvent)=>void)=>void;
  writeValueWithResponse:(value:BufferSource)=>Promise<void>;
};
type BluetoothService={getCharacteristic:(uuid:string)=>Promise<BluetoothCharacteristic>};
type BluetoothServer={connected:boolean;connect:()=>Promise<BluetoothServer>;disconnect:()=>void;getPrimaryService:(uuid:string)=>Promise<BluetoothService>};
type BluetoothDevice={name?:string;gatt?:BluetoothServer};
type BluetoothApi={requestDevice:(options:unknown)=>Promise<BluetoothDevice>};

export type RfidBleProgress={state:string;message:string;hardwareId?:string};
export type RfidBleProvisionInput={name:string;ssid:string;password:string};

const progressMessages:Record<string,string>={
  ready:"Leser gefunden. Die Einrichtung startet jetzt …",
  wifi_connecting:"Leser verbindet sich jetzt mit dem Vereins-WLAN …",
  securing_connection:"Sichere Verbindung zum Kassenserver wird aufgebaut …",
  retrying_server:"ClubIQ wird noch einmal angefragt …",
  pairing:"Der Leser ist bereit. Die Freigabe wird automatisch abgeschlossen …",
  approved:"Leser ist jetzt verbunden und sofort einsatzbereit."
};

const base64=(value:string)=>{
  const bytes=new TextEncoder().encode(value);
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=4096)binary+=String.fromCharCode(...bytes.subarray(offset,offset+4096));
  return btoa(binary);
};

const delay=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

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

export async function provisionRfidReader(input:RfidBleProvisionInput,onProgress:(progress:RfidBleProgress)=>void){
  const bluetooth=(navigator as Navigator&{bluetooth?:BluetoothApi}).bluetooth;
  if(!bluetooth)throw new Error("Bluetooth-Einrichtung wird von diesem Browser nicht unterstützt. Bitte Chrome auf dem Android-Tablet verwenden.");
  if(!window.isSecureContext)throw new Error("Bluetooth ist nur über die sichere HTTPS-Adresse von ClubIQ verfügbar.");

  onProgress({state:"searching",message:"Bluetooth-Leser wird gesucht. Bitte den Leser einschalten …"});
  let device:BluetoothDevice;
  try{
    device=await bluetooth.requestDevice({
      filters:[{namePrefix:"ClubIQ-RFID-"}],
      optionalServices:[SERVICE_UUID]
    });
  }catch{
    throw new Error("Kein Leser gefunden. Bitte den Leser mit Strom versorgen und die Verbindung in der Browser-Abfrage bestätigen.");
  }
  if(!device.gatt)throw new Error("Der ausgewählte Leser bietet keine Bluetooth-Verbindung an.");
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
