import { env } from "cloudflare:workers";
import { requireProfile } from "../../profile-session";
import type { MusicLibrary, MusicPlaylist, RadioStation } from "../../../tablet-music";

// Only these read endpoints on the existing Raspberry service are used. The
// request cannot choose a destination or forward credentials to ClubIQ Music.
const runtime = env as unknown as { VEREINSKASSE_RUNTIME?: string; CLUBIQ_MUSIC_API?: string };
const headers = { "Cache-Control": "no-store" };
const youtubeId = /^[A-Za-z0-9_-]{11}$/;
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

async function catalog<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(runtime.CLUBIQ_MUSIC_API + path, { signal, redirect: "error" });
  if (!response.ok) throw new Error("ClubIQ Music nicht erreichbar");
  return response.json() as Promise<T>;
}

function streamUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch { /* A sender with an invalid URL is unavailable on the tablet. */ }
}

async function radio(signal: AbortSignal): Promise<RadioStation[]> {
  const { stations } = await catalog<{ stations: { name: string; stream_url: unknown; fallback_url: unknown }[] }>("/player/radio/stations", signal);
  return stations.slice(0, 100).flatMap(station => {
    const main = streamUrl(station.stream_url), fallback = streamUrl(station.fallback_url);
    const url = main || fallback;
    return url && typeof station.name === "string" && station.name.trim()
      ? [{ name: station.name.slice(0, 150), url, fallback: fallback !== url ? fallback : undefined }]
      : [];
  });
}

async function playlists(signal: AbortSignal): Promise<MusicPlaylist[]> {
  const { cycles } = await catalog<{ cycles: { id: number; name: string; status: string; playlist_target_count: number }[] }>("/cycles", signal);
  const recent = cycles.filter(cycle => cycle.status === "closed" && Number.isSafeInteger(cycle.id) && cycle.id > 0)
    .sort((first, second) => second.id - first.id).slice(0, 5);
  const results = await Promise.allSettled(recent.map(async cycle => {
    const list = await catalog<{ playlist: { provider: string; external_id: unknown }[] }>(`/cycles/${cycle.id}/playlist`, signal);
    const count = Number.isInteger(cycle.playlist_target_count) ? Math.max(1, Math.min(50, cycle.playlist_target_count)) : 50;
    const videoIds = [...new Set(list.playlist.flatMap(song => song.provider === "youtube" && typeof song.external_id === "string" && youtubeId.test(song.external_id) ? [song.external_id] : []))].slice(0, count);
    return videoIds.length && typeof cycle.name === "string" ? { name: cycle.name.slice(0, 150), videoIds } : null;
  }));
  if (results.length && results.every(result => result.status === "rejected")) throw new Error("Abstimmungen nicht erreichbar");
  return results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

export async function GET(request: Request) {
  if (runtime.VEREINSKASSE_RUNTIME !== "raspberry" || !runtime.CLUBIQ_MUSIC_API) return fail(404, "Musik ist auf dem Kassentablet verfügbar.");
  if (!await requireProfile(request)) return fail(401, "Profilanmeldung erforderlich");

  const signal = AbortSignal.timeout(4500);
  const [stationResult, playlistResult] = await Promise.allSettled([radio(signal), playlists(signal)]);
  if (stationResult.status === "rejected" && playlistResult.status === "rejected") {
    return fail(503, "ClubIQ Music ist gerade nicht erreichbar.");
  }
  return Response.json({
    radio: stationResult.status === "fulfilled" ? stationResult.value : null,
    playlists: playlistResult.status === "fulfilled" ? playlistResult.value : null,
  } satisfies MusicLibrary, { headers });
}
