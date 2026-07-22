import { env } from "cloudflare:workers";

export type ActiveProfile={id:string;name:string;shortName:string;color:string;mustChangePin:boolean};
const cookieName="vereinskasse_profile_session";
export const legacyBootstrapPinHash="be2b52436b122cae1d2e8c01a57ac76d57dbe204c0a0d7cec8cd849ac9575532";
export const compatibleBootstrapPinHash="6b66aa5e7bc6b477017b074f7ca5b694bfc0b287279f5011187b7d22b39537f1";

const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,"0")).join("");
export async function hashProfilePin(pin:string,salt:string){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:new TextEncoder().encode(salt),iterations:100000},key,256));
}
export function randomSalt(){const bytes=crypto.getRandomValues(new Uint8Array(16));return [...bytes].map(value=>value.toString(16).padStart(2,"0")).join("")}
export async function activeProfile(request:Request):Promise<ActiveProfile|null>{
  const token=request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`))?.[1];if(!token)return null;
  const row=await env.DB.prepare("SELECT p.id,p.name,p.short_name shortName,p.color,p.must_change_pin mustChangePin,s.expires_at expiresAt FROM profile_sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.token=? AND p.active=1").bind(decodeURIComponent(token)).first<ActiveProfile&{expiresAt:string}>();
  if(!row||row.expiresAt<=new Date().toISOString())return null;return {...row,mustChangePin:Boolean(row.mustChangePin)};
}
export async function requireProfile(request:Request){return activeProfile(request)}
export const profileCookie=(token:string,maxAge=43200)=>`${cookieName}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
