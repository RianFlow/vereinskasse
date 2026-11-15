// Run after build:raspberry with a disposable SQLite server and music fixtures.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const base = "http://localhost:4262";
const musicSource = "https://qa-radio.invalid/test.wav";
const catalogue = createServer((request, response) => {
  const paths = {
    "/player/radio/stations": { stations: [
      { name: "QA Radio", stream_url: musicSource },
      { name: "Unsicherer Sender", stream_url: "http://qa-radio.invalid/" },
    ] },
    "/cycles": { cycles: [
      { id: 4, name: "Laufende Wahl", status: "open" },
      { id: 3, name: "Abstimmung November", status: "closed", playlist_target_count: 2 },
      { id: 2, name: "Abstimmung Oktober", status: "closed", playlist_target_count: 1 },
    ] },
    "/cycles/3/playlist": { playlist: [
      { provider: "youtube", external_id: "abcdefghijk" },
      { provider: "youtube", external_id: "abcdefghijk" },
      { provider: "youtube", external_id: "bad/identifier" },
      { provider: "youtube", external_id: "bcdefghijkl" },
      { provider: "youtube", external_id: "cdefghijklm" },
    ] },
    "/cycles/2/playlist": { playlist: [{ provider: "youtube", external_id: "cdefghijklm" }] },
  };
  const value = request.method === "GET" ? paths[request.url] : undefined;
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers.cookie, undefined);
  response.writeHead(value ? 200 : 404, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value ?? {}));
});

// A few minutes of silent PCM let the browser play a real media element.
const pcmBytes = 180 * 8000;
const sample = Buffer.alloc(pcmBytes + 44, 128);
sample.write("RIFF", 0); sample.writeUInt32LE(sample.length - 8, 4);
sample.write("WAVEfmt ", 8); sample.writeUInt32LE(16, 16);
sample.writeUInt16LE(1, 20); sample.writeUInt16LE(1, 22);
sample.writeUInt32LE(8000, 24); sample.writeUInt32LE(8000, 28);
sample.writeUInt16LE(1, 32); sample.writeUInt16LE(8, 34);
sample.write("data", 36); sample.writeUInt32LE(pcmBytes, 40);

mkdirSync("work", { recursive: true });
const directory = mkdtempSync(resolve("work/music-test-"));
const databasePath = join(directory, "qa.sqlite");
await new Promise(resolve => catalogue.listen(0, "127.0.0.1", resolve));
const server = spawn(process.execPath, ["raspberry/start-production.mjs"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env, HOST: "127.0.0.1", PORT: "4262", VINEXT_TRUSTED_HOSTS: "localhost,127.0.0.1",
    VEREINSKASSE_RUNTIME: "raspberry", VEREINSKASSE_DATABASE_PROVIDER: "sqlite",
    VEREINSKASSE_DATA_DIR: directory, VEREINSKASSE_BACKUP_DIR: join(directory, "objects"), VEREINSKASSE_DATABASE_PATH: databasePath,
    PGHOST: "", PGDATABASE: "", DATABASE_URL: "", CLUBIQ_MUSIC_API: `http://127.0.0.1:${catalogue.address().port}`,
  },
});
let browser, db, logs = "";
server.stdout.on("data", value => { logs += value; });
server.stderr.on("data", value => { logs += value; });

try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base + "/api/profiles", { signal: AbortSignal.timeout(1000) })).ok) break; }
    catch { /* Wait for startup. */ }
    assert.ok(attempt < 59, logs.slice(-2500));
    await delay(250);
  }
  assert.equal((await fetch(base + "/api/tablet/music")).status, 401);
  db = new DatabaseSync(databasePath);
  const iso = new Date().toISOString(), token = randomUUID(), profile = "qa-music";
  db.prepare("INSERT INTO profiles (id,name,short_name,color,pin_salt,pin_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(profile, "QA Kasse", "QA", "#b99656", "qa-only", "qa-only", iso, iso);
  db.prepare("INSERT INTO profile_sessions (token,profile_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(token, profile, new Date(Date.now() + 600000).toISOString(), iso);
  db.prepare("INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,?,?,?,1)")
    .run("qa-member", "QA Mitglied", "Mitglied", "NOLOGIN-QA", "QM");
  db.prepare("INSERT INTO members (id,name,role,code,initials,active) VALUES (?,?,?,?,?,1)")
    .run("qa-board", "QA Verwaltung", "Vorstand", "NOLOGIN-QA-BOARD", "QV");
  db.prepare("INSERT INTO products (id,profile_id,name,price,member_price,included_items_json,is_offer,icon,category,color,updated_at) VALUES (1,?,?,?,?, '[]',0,'beer','Getränke','#b99656',?)")
    .run(profile, "QA Pils", 2.5, 2, iso);
  const response = await fetch(base + "/api/tablet/music", { headers: { cookie: `vereinskasse_profile_session=${token}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    radio: [{ name: "QA Radio", url: musicSource }],
    playlists: [
      { name: "Abstimmung November", videoIds: ["abcdefghijk", "bcdefghijkl"] },
      { name: "Abstimmung Oktober", videoIds: ["cdefghijklm"] },
    ],
  });

  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  const context = await browser.newContext({ viewport: { width: 1024, height: 600 }, hasTouch: true });
  await context.addCookies([{ name: "vereinskasse_profile_session", value: token, url: base, httpOnly: true, sameSite: "Strict" }]);
  await context.addInitScript(() => localStorage.setItem("barver-cash-layout", "tablet"));
  // SQLite does not enable payments in the A5 UI. Render that UI with the real
  // test profile and product catalogue, leaving payment API calls untouched.
  await context.route("**/api/data", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const upstream = await route.fetch();
    if (!upstream.ok()) return route.fulfill({ response: upstream });
    await route.fulfill({ response: upstream, json: { ...await upstream.json(), tabletAvailable: true } });
  });
  await context.route(musicSource, route => route.fulfill({ contentType: "audio/wav", body: sample }));
  await context.route("https://www.youtube-nocookie.com/embed/**", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: '<body style="background:#17191e;color:#eeeae1;font:16px sans-serif;display:grid;place-items:center;min-height:90vh">▶ Videoplayer (Test)</body>',
  }));

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Musik", exact: true }).tap();
  const musicDialog = page.getByRole("dialog", { name: "Musik auf dem Tablet" });
  await musicDialog.getByRole("button", { name: "QA Radio" }).tap();
  await musicDialog.getByText("Läuft auf dem Tablet").waitFor();
  await musicDialog.getByRole("button", { name: "Fenster schließen" }).tap();
  await page.getByRole("button", { name: /QA Pils hinzufügen/ }).tap();
  assert.ok(await page.locator("audio").evaluate(audio => !audio.paused && audio.currentTime >= 0));
  assert.match(await page.locator(".tc5-lines").innerText(), /QA Pils/);
  console.log("PASS local media continues after returning to an active order");

  const voteUrl = "https://vereinskasse-1.tail289dda.ts.net:8443/";
  await context.route(voteUrl, route => route.fulfill({ contentType: "text/html", body: "<h1>QA Online-Abstimmung</h1>" }));
  await page.getByRole("button", { name: "Musik", exact: true }).tap();
  const [voteTab] = await Promise.all([page.waitForEvent("popup"), musicDialog.getByRole("link", { name: "Online abstimmen" }).tap()]);
  await voteTab.getByRole("heading", { name: "QA Online-Abstimmung" }).waitFor();
  assert.equal(voteTab.url(), voteUrl);
  assert.equal(await voteTab.evaluate(() => window.opener), null);
  await voteTab.close();
  await page.bringToFront();
  await musicDialog.getByRole("button", { name: "Fenster schließen" }).tap();
  assert.match(await page.locator(".tc5-lines").innerText(), /QA Pils/);
  console.log("PASS online voting opens separately and the cashier keeps the order");

  await page.getByRole("button", { name: "Musik", exact: true }).tap();
  await musicDialog.getByRole("button", { name: "Playlist anzeigen" }).tap();
  const video = page.getByTitle("Abgestimmte YouTube-Playlist");
  await video.waitFor();
  const url = new URL(await video.getAttribute("src"));
  assert.equal(url.pathname, "/embed/abcdefghijk");
  assert.equal(url.searchParams.get("playlist"), "bcdefghijkl");
  assert.ok(await page.locator("audio").evaluate(audio => audio.paused && !audio.hasAttribute("src")));
  await page.getByRole("button", { name: "Alle Personen", exact: false }).tap();
  const person = page.getByRole("dialog", { name: "Wer bestellt?" });
  await person.getByRole("button", { name: /QA Mitglied/ }).waitFor();
  for (const viewport of [{ width: 1024, height: 600 }, { width: 900, height: 560 }]) {
    await page.setViewportSize(viewport);
    const iframe = await video.boundingBox(), backdrop = await page.locator(".tc-backdrop").boundingBox();
    assert.ok(iframe.width >= 200 && iframe.height >= 200);
    assert.ok(backdrop.x + backdrop.width <= iframe.x);
  }
  await person.getByRole("button", { name: /QA Mitglied/ }).tap();
  assert.match(await page.locator(".tc5-lines").innerText(), /QA Pils/);
  const checkout = await page.locator(".tc5-secondary").boundingBox(), footer = await page.locator(".tc5-footer").boundingBox();
  assert.ok(checkout.y + checkout.height <= footer.y + 1, "Checkout remains above the footer even with the player and the closed-shift banner");
  await page.setViewportSize({ width: 1024, height: 600 });
  if (process.env.CLUBIQ_MUSIC_QA_SCREENSHOT) await page.screenshot({ path: process.env.CLUBIQ_MUSIC_QA_SCREENSHOT });
  await page.setViewportSize({ width: 900, height: 330 });
  await video.waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1024, height: 600 });
  await video.waitFor();
  await page.getByRole("button", { name: "Videoplayer schließen" }).tap();
  assert.equal(await video.count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS official playlist URL, visible video alongside cashier dialogs, and safe return to full cashier");
} finally {
  if (browser) await browser.close();
  if (db) db.close();
  catalogue.close();
  if (server.pid && process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else server.kill("SIGTERM");
}
