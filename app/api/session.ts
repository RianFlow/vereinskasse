import { env } from "cloudflare:workers";

export type SessionUser={id:string;name:string;role:string};
export async function issueSession(member:SessionUser){
  const token=crypto.randomUUID()+crypto.randomUUID(),now=new Date(),expires=new Date(now.getTime()+12*60*60*1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").bind(now.toISOString()),
    env.DB.prepare("INSERT INTO auth_sessions (token,member_id,role,expires_at,created_at) VALUES (?,?,?,?,?)").bind(token,member.id,member.role,expires.toISOString(),now.toISOString())
  ]);
  return {createdAt:now.toISOString(),cookie:`vereinskasse_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`};
}
export async function sessionUser(request:Request):Promise<SessionUser|null>{
  const token=request.headers.get("cookie")?.match(/(?:^|;\s*)vereinskasse_session=([^;]+)/)?.[1];if(!token)return null;
  const row=await env.DB.prepare("SELECT m.id,m.name,m.role,s.expires_at expiresAt FROM auth_sessions s JOIN members m ON m.id=s.member_id WHERE s.token=? AND m.active=1").bind(decodeURIComponent(token)).first<SessionUser&{expiresAt:string}>();
  if(!row||row.expiresAt<=new Date().toISOString())return null;return {id:row.id,name:row.name,role:row.role};
}
export async function requireRole(request:Request,roles:string[]){const user=await sessionUser(request);return user&&roles.includes(user.role)?user:null}
