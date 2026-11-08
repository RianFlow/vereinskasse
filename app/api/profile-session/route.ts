import { env } from "cloudflare:workers";
import { activeProfile,compatibleBootstrapPinHash,hashProfilePin,legacyBootstrapPinHash,profileCookie,profileSessionToken,randomSalt,rememberedProfileMaxAge } from "../profile-session";
import { hasRole, sessionUser } from "../session";

export async function GET(request:Request){const profile=await activeProfile(request);return profile?Response.json({profile}):Response.json({profile:null},{status:401})}

// Only retain the already authenticated profile on this browser. Personal
// operator/admin sessions keep their separate twelve-hour lifetime.
export async function PUT(request:Request){
  const headers=new Headers({"content-type":"application/json","cache-control":"no-store"});
  try{
    const profile=await activeProfile(request),token=profileSessionToken(request);
    if(!profile||!token)return Response.json({error:"Bitte dieses Profil zuerst mit PIN oder Chip öffnen"},{status:401,headers});
    if(profile.mustChangePin)return Response.json({error:"Bitte zuerst eine eigene Profil-PIN festlegen"},{status:409,headers});
    const body=await request.json() as {rememberDevice?:boolean};
    if(body.rememberDevice!==true)return Response.json({error:"Bitte das Merken dieses Tablets ausdrücklich auswählen"},{status:400,headers});
    const now=new Date(),expires=new Date(now.getTime()+rememberedProfileMaxAge*1000);
    const updated=await env.DB.prepare("UPDATE profile_sessions SET expires_at=? WHERE token=? AND profile_id=? AND expires_at>?").bind(expires.toISOString(),token,profile.id,now.toISOString()).run();
    if(!updated.meta.changes)return Response.json({error:"Die Anmeldung ist abgelaufen. Bitte erneut anmelden."},{status:401,headers});
    headers.append("set-cookie",profileCookie(token,rememberedProfileMaxAge));
    return new Response(JSON.stringify({ok:true,rememberedUntil:expires.toISOString()}),{headers});
  }catch{return Response.json({error:"Dieses Tablet konnte gerade nicht gemerkt werden. Bitte erneut versuchen."},{status:503,headers})}
}

export async function POST(request:Request){
  try{
    const body=await request.json() as {profileId?:string;pin?:string};if(!body.profileId||!/^[0-9]{6}$/.test(body.pin||""))return Response.json({error:"Bitte die sechsstellige Profil-PIN eingeben"},{status:400});
    const now=new Date(),profile=await env.DB.prepare("SELECT id,name,short_name shortName,color,pin_salt pinSalt,pin_hash pinHash,must_change_pin mustChangePin,failed_attempts failedAttempts,locked_until lockedUntil FROM profiles WHERE id=? AND active=1").bind(body.profileId).first<{id:string;name:string;shortName:string;color:string;pinSalt:string;pinHash:string;mustChangePin:number;failedAttempts:number;lockedUntil:string|null}>();if(!profile)return Response.json({error:"Profil nicht gefunden"},{status:404});
    if(profile.lockedUntil&&profile.lockedUntil>now.toISOString())return Response.json({error:"Profil ist nach mehreren Fehlversuchen kurz gesperrt. Bitte später erneut versuchen."},{status:429});
    const calculatedHash=await hashProfilePin(body.pin!,profile.pinSalt),isLegacyBootstrap=profile.id==="darts"&&Boolean(profile.mustChangePin)&&profile.pinHash===legacyBootstrapPinHash&&calculatedHash===compatibleBootstrapPinHash,valid=calculatedHash===profile.pinHash||isLegacyBootstrap;if(!valid){const attempts=Number(profile.failedAttempts||0)+1,locked=attempts>=5?new Date(now.getTime()+5*60*1000).toISOString():null;await env.DB.prepare("UPDATE profiles SET failed_attempts=?,locked_until=? WHERE id=?").bind(locked?0:attempts,locked,profile.id).run();return Response.json({error:locked?"Zu viele Fehlversuche. Profil ist fünf Minuten gesperrt.":`PIN ist falsch · noch ${5-attempts} Versuche`},{status:403})}
    const token=crypto.randomUUID()+crypto.randomUUID(),expires=new Date(now.getTime()+12*60*60*1000);await env.DB.batch([env.DB.prepare("UPDATE profiles SET pin_hash=?,failed_attempts=0,locked_until=NULL WHERE id=?").bind(calculatedHash,profile.id),env.DB.prepare("DELETE FROM profile_sessions WHERE expires_at<=?").bind(now.toISOString()),env.DB.prepare("INSERT INTO profile_sessions (token,profile_id,expires_at,created_at) VALUES (?,?,?,?)").bind(token,profile.id,expires.toISOString(),now.toISOString())]);
    const headers=new Headers({"content-type":"application/json"});headers.append("set-cookie",profileCookie(token));headers.append("set-cookie","vereinskasse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");return new Response(JSON.stringify({profile:{id:profile.id,name:profile.name,shortName:profile.shortName,color:profile.color,mustChangePin:Boolean(profile.mustChangePin)}}),{headers});
  }catch{return Response.json({error:"Profilanmeldung ist vorübergehend nicht möglich"},{status:500})}
}

export async function PATCH(request:Request){
  try{
    const [profile,user]=await Promise.all([activeProfile(request),sessionUser(request)]);if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});if(!profile.mustChangePin&&(!user||!hasRole(user,"Vorstand")&&!hasRole(user,"Systemadmin")))return Response.json({error:"Nur Vorstand oder Systemadministration dürfen die Profil-PIN ändern"},{status:403});
    const {newPin}=await request.json() as {newPin?:string};if(!/^[0-9]{6}$/.test(newPin||""))return Response.json({error:"Die neue PIN muss genau sechs Ziffern haben"},{status:400});const salt=randomSalt(),hash=await hashProfilePin(newPin!,salt),now=new Date().toISOString();await env.DB.batch([env.DB.prepare("UPDATE profiles SET pin_salt=?,pin_hash=?,must_change_pin=0,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?").bind(salt,hash,now,profile.id),env.DB.prepare("DELETE FROM profile_sessions WHERE profile_id=? AND token<>?").bind(profile.id,profileSessionToken(request))]);return Response.json({ok:true,profile:{...profile,mustChangePin:false}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"PIN konnte nicht geändert werden"},{status:500})}
}
export async function DELETE(request:Request){
  const headers=new Headers({"content-type":"application/json","cache-control":"no-store"});
  headers.append("set-cookie",profileCookie("",0));headers.append("set-cookie","vereinskasse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  try{const token=profileSessionToken(request);if(token)await env.DB.prepare("DELETE FROM profile_sessions WHERE token=?").bind(token).run();return new Response(JSON.stringify({ok:true}),{headers})}
  catch{return new Response(JSON.stringify({error:"Die Gerätefreigabe konnte nicht vollständig entfernt werden. Bitte erneut versuchen."}),{status:503,headers})}
}
