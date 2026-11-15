export type RadioStation = { name: string; url: string; fallback?: string };
export type MusicPlaylist = { name: string; videoIds: string[] };
export type MusicLibrary = {
  radio: RadioStation[] | null;
  playlists: MusicPlaylist[] | null;
};

export const CLUBIQ_MUSIC_URL = "https://vereinskasse-1.tail289dda.ts.net:8443/";

export function youtubePlaylistUrl({ videoIds }: MusicPlaylist) {
  const [first, ...next] = videoIds;
  const url = new URL(`https://www.youtube-nocookie.com/embed/${first}`);
  url.searchParams.set("playsinline", "1");
  if (next.length) url.searchParams.set("playlist", next.join(","));
  return url.href;
}
