import { env } from "cloudflare:workers";
import { activeProfile,hashProfilePin,profileCookie,randomSalt } from "../profile-session";
import { sessionUser } from "../session";

export async function GET(request:Request){const profile=await activeProfile(request);return profile?Response.json({profile}):Response.json({profile:null},{status:401})}

export async function POST(request:Request){
  try{
    const body=await request.json() as {profileId?:string;pin?:string};if(!body.profileId||!/^[0-9]{6}$/.test(body.pin||""))return Response.json({error:"Bitte die sechsstellige Profil-PIN eingeben"},{status:400});
    const now=new Date(),profile=await env.DB.prepare("SELECT id,name,short_name shortName,color,pin_salt pinSalt,pin_hash pinHash,must_change_pin mustChangePin,failed_attempts failedAttempts,locked_until lockedUntil FROM profiles WHERE id=? AND active=1").bind(body.profileId).first<{id:string;name:string;shortName:string;color:string;pinSalt:string;pinHash:string;mustChangePin:number;failedAttempts:number;lockedUntil:string|null}>();if(!profile)return Response.json({error:"Profil nicht gefunden"},{status:404});
    if(profile.lockedUntil&&profile.lockedUntil>now.toISOString())return Response.json({error:"Profil ist nach mehreren Fehlversuchen kurz gesperrt. Bitte später erneut versuchen."},{status:429});
    const valid=(await hashProfilePin(body.pin!,profile.pinSalt))===profile.pinHash;if(!valid){const attempts=Number(profile.failedAttempts||0)+1,locked=attempts>=5?new Date(now.getTime()+5*60*1000).toISOString():null;await env.DB.prepare("UPDATE profiles SET failed_attempts=?,locked_until=? WHERE id=?").bind(locked?0:attempts,locked,profile.id).run();return Response.json({error:locked?"Zu viele Fehlversuche. Profil ist fünf Minuten gesperrt.":`PIN ist falsch · noch ${5-attempts} Versuche`},{status:403})}
    const token=crypto.randomUUID()+crypto.randomUUID(),expires=new Date(now.getTime()+12*60*60*1000);await env.DB.batch([env.DB.prepare("UPDATE profiles SET failed_attempts=0,locked_until=NULL WHERE id=?").bind(profile.id),env.DB.prepare("DELETE FROM profile_sessions WHERE expires_at<=?").bind(now.toISOString()),env.DB.prepare("INSERT INTO profile_sessions (token,profile_id,expires_at,created_at) VALUES (?,?,?,?)").bind(token,profile.id,expires.toISOString(),now.toISOString())]);
    const headers=new Headers({"content-type":"application/json"});headers.append("set-cookie",profileCookie(token));headers.append("set-cookie","vereinskasse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");return new Response(JSON.stringify({profile:{id:profile.id,name:profile.name,shortName:profile.shortName,color:profile.color,mustChangePin:Boolean(profile.mustChangePin)}}),{headers});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Profilanmeldung fehlgeschlagen"},{status:500})}
}

export async function PATCH(request:Request){
  try{
    const [profile,user]=await Promise.all([activeProfile(request),sessionUser(request)]);if(!profile)return Response.json({error:"Profilanmeldung erforderlich"},{status:401});if(!profile.mustChangePin&&user?.role!=="Vorstand")return Response.json({error:"Nur der Hauptadministrator darf die Profil-PIN ändern"},{status:403});
    const {newPin}=await request.json() as {newPin?:string};if(!/^[0-9]{6}$/.test(newPin||""))return Response.json({error:"Die neue PIN muss genau sechs Ziffern haben"},{status:400});const salt=randomSalt(),hash=await hashProfilePin(newPin!,salt),now=new Date().toISOString();await env.DB.prepare("UPDATE profiles SET pin_salt=?,pin_hash=?,must_change_pin=0,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?").bind(salt,hash,now,profile.id).run();return Response.json({ok:true,profile:{...profile,mustChangePin:false}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"PIN konnte nicht geändert werden"},{status:500})}
}
export async function DELETE(){const headers=new Headers({"content-type":"application/json"});headers.append("set-cookie",profileCookie("",0));headers.append("set-cookie","vereinskasse_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");return new Response(JSON.stringify({ok:true}),{headers})}
