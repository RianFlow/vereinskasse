import { env } from "cloudflare:workers";
import { requireProfile } from "./profile-session";

export async function cashTransaction(request: Request, action: () => Promise<Response>, required = false) {
  const profile = await requireProfile(request);
  if (!profile) return Response.json({error:"Bitte zuerst ein Profil entsperren"}, {status:401});
  const db = env.DB as unknown as {transaction?: (profileId:string, callback:()=>Promise<Response>)=>Promise<Response>};
  if (db.transaction) return db.transaction(profile.id, action);
  if (required) return Response.json({error:"Diese Geldfunktion benötigt die PostgreSQL-Kasse."}, {status:503});
  return action();
}
