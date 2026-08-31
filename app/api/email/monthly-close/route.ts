import { env } from "cloudflare:workers";
import { sendMonthlyCashManagerReport } from "../../../monthly-cash-manager-email";

const runtimeImport=(specifier:string)=>import(/* @vite-ignore */ specifier);
const clean=(value:unknown)=>String(value||"").trim();
const previousBerlinMonth=()=>{
  const parts=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit"}).formatToParts(new Date());
  const date=new Date(Date.UTC(Number(parts.find(part=>part.type==="year")?.value),Number(parts.find(part=>part.type==="month")?.value)-2,1,12));
  return date.toISOString().slice(0,7);
};
async function authorized(request:Request){
  const path=clean((env as unknown as Record<string,unknown>).CLUBIQ_MONTHLY_MAIL_TOKEN_FILE),supplied=clean(request.headers.get("x-clubiq-monthly-token"));
  if(!path||!supplied)return false;
  try{const fs=await runtimeImport("node:fs/promises") as {readFile:(file:string,encoding:string)=>Promise<string>};const expected=(await fs.readFile(path,"utf8")).trim();if(!expected)return false;const [left,right]=await Promise.all([crypto.subtle.digest("SHA-256",new TextEncoder().encode(expected)),crypto.subtle.digest("SHA-256",new TextEncoder().encode(supplied))]);return Array.from(new Uint8Array(left)).every((value,index)=>value===new Uint8Array(right)[index])}catch{return false}
}

export async function POST(request:Request){
  if(!await authorized(request))return Response.json({error:"Nicht autorisiert"},{status:403});
  const month=previousBerlinMonth(),profiles=await env.DB.prepare("SELECT id,name FROM profiles ORDER BY name").all<{id:string;name:string}>(),results=[];
  for(const profile of profiles.results){
    try{results.push({profileId:profile.id,...await sendMonthlyCashManagerReport({profileId:profile.id,profileName:profile.name,month,operatorId:"SYSTEM-MONATSABSCHLUSS",mode:"automatic"})})}
    catch(error){const code=error instanceof Error?error.message:"UNKNOWN";results.push({profileId:profile.id,ok:false,skipped:code==="MONTH_NOT_CLOSED",reason:code})}
  }
  return Response.json({ok:results.every(result=>result.ok||result.skipped),month,results},{headers:{"cache-control":"no-store"}});
}
