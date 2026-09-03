// The successful revision claim and every catalogue write run in ONE DB batch.
// A stale writer cannot delete or replace any products, discounts or audit rows.
export function configurationClaim<T extends {bind:(...values:unknown[])=>T}>(db:{prepare:(sql:string)=>T},profileId:string,revision:number,mutation:string){
  return db.prepare("UPDATE configuration_state SET revision=revision+1,last_mutation=? WHERE profile_id=? AND revision=?").bind(mutation,profileId,revision);
}
export const configurationGuard="EXISTS (SELECT 1 FROM configuration_state WHERE profile_id=? AND last_mutation=?)";
