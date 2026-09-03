import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {migrate} from '../migrate.mjs';
export async function postgresFixture(){
  let pool,close,dbName='postgres';
  if(process.env.BACKOFFICE_TEST_DATABASE_URL){
    const url=new URL(process.env.BACKOFFICE_TEST_DATABASE_URL);
    if(url.pathname!=='/clubiq_backoffice_test')throw new Error('Tests dürfen nur in clubiq_backoffice_test laufen.');
    dbName='clubiq_backoffice_test';
    const native=new Pool({connectionString:url.href,max:1});pool=native;close=()=>native.end();
    const {rows:[state]}=await pool.query("SELECT to_regclass('public.profiles') AS present");
    if(state.present)throw new Error('Tests benötigen eine frische, leere Testdatenbank. Keine vorhandenen Tabellen werden gelöscht.');
  }else{
    const pg=await PGlite.create();
    const query=async(sql,params)=>{
      let result;
      if(params)result=await pg.query(sql,params);else result=(await pg.exec(sql)).at(-1)||{rows:[],affectedRows:0};
      return {...result,rowCount:result.affectedRows??result.rows.length};
    };
    pool={query,connect:async()=>({query,release(){},on(){},off(){}})};close=()=>pg.close();
  }
  const directory=new URL('../../postgres/migrations/',import.meta.url);
  for(const name of(await readdir(directory)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort())await pool.query(await readFile(new URL(name,directory),'utf8'));
  await pool.query("CREATE ROLE clubiq_backoffice LOGIN; CREATE ROLE vereinskasse LOGIN;");
  const grants=(await readFile(new URL('../grants.sql',import.meta.url),'utf8')).replaceAll('DATABASE vereinskasse',`DATABASE ${dbName}`);
  await pool.query(grants);
  await pool.query('SET search_path=backoffice,public');
  await pool.query('SET ROLE clubiq_backoffice');
  await migrate(pool);await migrate(pool);
  await pool.query('RESET ROLE');
  return {pool,close};
}
