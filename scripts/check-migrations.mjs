import { readdir, readFile } from "node:fs/promises";

const migrationDirectory=new URL("../drizzle/",import.meta.url);
const files=(await readdir(migrationDirectory)).filter(file=>/^\d{4}_.+\.sql$/.test(file)).sort();
const postgresMigrationDirectory=new URL("../postgres/migrations/",import.meta.url);
const postgresFiles=(await readdir(postgresMigrationDirectory)).filter(file=>/^\d{4}_.+\.sql$/.test(file)).sort();
const journal=JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json",import.meta.url),"utf8"));
const recorded=new Set(journal.entries.map(entry=>`${entry.tag}.sql`));
const destructive=/\b(DROP\s+TABLE|DROP\s+COLUMN|DELETE\s+FROM|TRUNCATE\s+TABLE|ALTER\s+COLUMN)\b/i;
const problems=[];

for(const file of files){
  const sql=await readFile(new URL(file,migrationDirectory),"utf8");
  if(!recorded.has(file))problems.push(`${file} fehlt im Migrationsjournal`);
  if(destructive.test(sql)&&!sql.includes("-- @destructive-reviewed"))problems.push(`${file} enthält eine potentiell datenlöschende Änderung ohne Freigabemarkierung`);
}
for(const file of recorded)if(!files.includes(file))problems.push(`${file} steht im Journal, die SQL-Datei fehlt jedoch`);
for(const file of postgresFiles){
  const sql=await readFile(new URL(file,postgresMigrationDirectory),"utf8");
  if(destructive.test(sql)&&!sql.includes("-- @destructive-reviewed"))problems.push(`PostgreSQL ${file} enthält eine potentiell datenlöschende Änderung ohne Freigabemarkierung`);
}
if(postgresFiles[0]!=="0001_baseline.sql")problems.push("PostgreSQL-Basismigration 0001_baseline.sql fehlt");
if(problems.length){console.error(["Unsichere Datenbankmigration:",...problems.map(problem=>`- ${problem}`)].join("\n"));process.exit(1)}
console.log(`${files.length} D1- und ${postgresFiles.length} PostgreSQL-Migrationen geprüft · keine unbestätigte Datenlöschung`);
