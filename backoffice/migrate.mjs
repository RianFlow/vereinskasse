import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function migrate(pool){
  const db=await pool.connect();
  try{
    const {rows:[schema]}=await db.query('SELECT current_schema() AS name');
    if(schema.name!=='backoffice')throw new Error('Migration abgebrochen: eigenes backoffice-Schema fehlt.');
    await db.query("SELECT pg_advisory_lock(hashtext('clubiq-backoffice-migrations'))");
    await db.query('CREATE TABLE IF NOT EXISTS bo_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    const directory=new URL('./migrations/',import.meta.url);
    for(const name of (await readdir(directory)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort()){
      const sql=await readFile(new URL(name,directory),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
      const {rows:[prior]}=await db.query('SELECT checksum FROM bo_migrations WHERE name=$1',[name]);
      if(prior){if(prior.checksum!==checksum)throw new Error('Bereits angewendete Verwaltungsmigration wurde verändert.');continue;}
      await db.query('BEGIN');
      try{await db.query(sql);await db.query('INSERT INTO bo_migrations(name,checksum) VALUES ($1,$2)',[name,checksum]);await db.query('COMMIT');}
      catch(error){await db.query('ROLLBACK');throw error;}
    }
  }finally{await db.query("SELECT pg_advisory_unlock(hashtext('clubiq-backoffice-migrations'))");db.release();}
}
