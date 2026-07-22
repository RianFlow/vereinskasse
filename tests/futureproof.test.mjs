import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("schützt Updates mit Migrationen und automatischen Prüfungen",async()=>{
  const [workflow,checker,packageFile,migration,readme]=await Promise.all([read(".github/workflows/ci.yml"),read("scripts/check-migrations.mjs"),read("package.json"),read("drizzle/0013_concerned_mockingbird.sql"),read("README.md")]);
  assert.ok(workflow.includes("npm run lint"));
  assert.ok(workflow.includes("npm test"));
  assert.ok(packageFile.includes("check:migrations"));
  assert.ok(checker.includes("destructive-reviewed"));
  assert.ok(migration.includes("sales_profile_time_idx"));
  assert.ok(readme.includes("Sicherer Updateablauf"));
});

test("erstellt prüfbare und herunterladbare Vollsicherungen",async()=>{
  const [backup,page,data]=await Promise.all([read("app/api/backup/route.ts"),read("app/page.tsx"),read("app/api/data/route.ts")]);
  for(const feature of ["SHA-256","customMetadata","x-backup-sha256","FULL_BACKUP_CREATED","formatVersion","downloadUrl"])assert.ok(backup.includes(feature),`${feature} fehlt`);
  for(const feature of ["SystemStatus","Jetzt vollständig sichern","Sicherung herunterladen","Automatische Prüfungen"])assert.ok(page.includes(feature),`${feature} fehlt`);
  assert.ok(data.includes("configuration-before-change"));
  assert.ok(data.includes("saleAllocations.profileId"));
  assert.ok(data.includes("roundClaims.profileId"));
});
