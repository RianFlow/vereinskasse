const encoder=new TextEncoder();
const iterations=100_000;
const toHex=(bytes:Uint8Array)=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
const fromHex=(value:string)=>new Uint8Array(value.match(/.{2}/g)?.map(byte=>Number.parseInt(byte,16))||[]);
const equal=(left:Uint8Array,right:Uint8Array)=>{if(left.length!==right.length)return false;let difference=0;for(let index=0;index<left.length;index++)difference|=left[index]^right[index];return difference===0};
const derive=async(code:string,salt:Uint8Array,rounds:number)=>{
  const material=await crypto.subtle.importKey("raw",encoder.encode(code),"PBKDF2",false,["deriveBits"]);
  const saltBuffer=salt.slice().buffer as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:saltBuffer,iterations:rounds},material,256));
};

export const isProtectedAccessCode=(stored:string)=>stored.startsWith("PBKDF2$");

export async function protectAccessCode(code:string){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return `PBKDF2$${iterations}$${toHex(salt)}$${toHex(await derive(code,salt,iterations))}`;
}

export async function verifyAccessCode(stored:string,entered:string){
  if(!isProtectedAccessCode(stored))return {valid:stored.toLocaleLowerCase("de-DE")===entered.toLocaleLowerCase("de-DE"),legacy:true};
  const [,roundText,saltText,hashText]=stored.split("$"),rounds=Number(roundText);
  if(!Number.isInteger(rounds)||rounds<50_000||rounds>iterations||!/^[0-9a-f]{32}$/i.test(saltText||"")||!/^[0-9a-f]{64}$/i.test(hashText||""))return {valid:false,legacy:false};
  const calculated=await derive(entered,fromHex(saltText),rounds);
  return {valid:equal(calculated,fromHex(hashText)),legacy:false};
}
