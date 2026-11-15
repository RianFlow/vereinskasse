"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CLUBIQ_MUSIC_URL, youtubePlaylistUrl, type MusicLibrary, type MusicPlaylist, type RadioStation } from "./tablet-music";

const playerScreen = "(min-width: 900px) and (min-height: 560px)";
function canShowVideo() {
  return !document.hidden && window.matchMedia(playerScreen).matches && (window.visualViewport?.height ?? window.innerHeight) >= 560;
}
function subscribeToScreen(notify: () => void) {
  const media = window.matchMedia(playerScreen);
  media.addEventListener("change", notify);
  document.addEventListener("visibilitychange", notify);
  window.visualViewport?.addEventListener("resize", notify);
  return () => {
    media.removeEventListener("change", notify);
    document.removeEventListener("visibilitychange", notify);
    window.visualViewport?.removeEventListener("resize", notify);
  };
}

export function useTabletMusic() {
  const [library, setLibrary] = useState<MusicLibrary | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null);
  const [radioName, setRadioName] = useState("");
  const [radioStatus, setRadioStatus] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const activeRadio = useRef<{ station: RadioStation; url: string } | null>(null);
  const videoFits = useSyncExternalStore(subscribeToScreen, canShowVideo, () => false);
  useEffect(() => {
    const element = audio.current;
    return () => {
      activeRadio.current = null;
      element?.pause();
      element?.removeAttribute("src");
      element?.load();
    };
  }, []);

  async function load() {
    setLoading(true);
    setCatalogError("");
    try {
      const response = await fetch("/api/tablet/music", { cache: "no-store", signal: AbortSignal.timeout(6500) });
      if (!response.ok) throw new Error();
      setLibrary(await response.json() as MusicLibrary);
    } catch {
      setCatalogError("ClubIQ Music ist gerade nicht erreichbar.");
    } finally {
      setLoading(false);
    }
  }

  function stopRadio() {
    activeRadio.current = null;
    const element = audio.current;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    setRadioName("");
    setRadioStatus("");
  }

  function playRadio(station: RadioStation, url = station.url) {
    const element = audio.current;
    if (!element) return;
    setPlaylist(null);
    const playback = { station, url };
    activeRadio.current = playback;
    setRadioName(station.name);
    setRadioStatus("Sender wird verbunden …");
    element.src = url;
    void element.play().catch(reason => {
      if (activeRadio.current !== playback || reason?.name === "AbortError") return;
      if (reason?.name === "NotAllowedError") {
        setRadioStatus("Bitte den Sender erneut antippen.");
      } else {
        radioError();
      }
    });
  }

  function radioError() {
    const current = activeRadio.current;
    if (!current) return;
    const { station, url } = current;
    if (station.fallback && station.fallback !== url) playRadio(station, station.fallback);
    else setRadioStatus("Sender gerade nicht abspielbar.");
  }

  function startPlaylist(value: MusicPlaylist) {
    stopRadio();
    setPlaylist(value);
  }

  const audioElement = <audio ref={audio} preload="none" onError={radioError}
    onPlaying={() => { if (activeRadio.current) setRadioStatus("Läuft auf dem Tablet"); }}
    onWaiting={() => { if (activeRadio.current) setRadioStatus("Sender wird verbunden …"); }}
    onPause={() => { if (activeRadio.current) setRadioStatus("Pausiert"); }} />;
  return {
    library, loading, catalogError, playlist, radioName, radioStatus, audioElement, videoFits,
    load, playRadio, stopRadio, startPlaylist, stopPlaylist: () => setPlaylist(null),
  };
}

type TabletMusic = ReturnType<typeof useTabletMusic>;

export function TabletMusicControls({ music, done }: { music: TabletMusic; done: () => void }) {
  const { loading, catalogError, library, playlist, radioName, radioStatus, videoFits } = music;
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const lists = library?.playlists ?? [];
  const selected = lists[playlistIndex] ?? lists[0];
  return <div className="tc5-music-controls">
    <p>Die Wiedergabe läuft auf diesem Tablet. Koppel die Box in den Bluetooth-Einstellungen des Samsung.</p>
    {loading && <p role="status">ClubIQ Music wird geladen …</p>}
    {catalogError && <p role="status">{catalogError}</p>}
    {(catalogError || library?.radio === null || library?.playlists === null) &&
      <button disabled={loading} onClick={() => void music.load()}>Musik neu laden</button>}
    <section aria-label="Internetradio">
      <h3>Internetradio</h3>
      {library?.radio?.map(station => <button key={station.url + station.name} onClick={() => music.playRadio(station)}>
        {station.name}{radioName === station.name && <small>{radioStatus}</small>}
      </button>)}
      {library?.radio?.length === 0 && <p>Kein Radiosender für das Tablet verfügbar.</p>}
      {library?.radio === null && <p>Die Senderliste ist gerade nicht erreichbar.</p>}
      {radioName && <button onClick={music.stopRadio}>Radio stoppen</button>}
    </section>
    <section aria-label="Abgestimmte Playlist">
      <h3>Abgestimmte Playlist</h3>
      {selected && <>
        {lists.length > 1 ? <label>Playlist auswählen
          <select value={String(lists.indexOf(selected))} onChange={event => setPlaylistIndex(Number(event.target.value))}>
            {lists.map((list, index) => <option key={index} value={index}>{list.name} · {list.videoIds.length} Titel</option>)}
          </select>
        </label> : <p>{selected.name} · {selected.videoIds.length} Titel</p>}
        <button disabled={!videoFits} onClick={() => { music.startPlaylist(selected); done(); }}>Playlist anzeigen</button>
        {!videoFits && <p>Im Querformat mit voller Bildschirmhöhe öffnen.</p>}
      </>}
      {library?.playlists?.length === 0 && <p>Es gibt noch keine abgeschlossene Playlist mit Titeln.</p>}
      {library?.playlists === null && <p>Die Playlist ist gerade nicht erreichbar.</p>}
      {playlist && <button onClick={music.stopPlaylist}>Videoplayer schließen</button>}
    </section>
    <a className="tc-menu-link" href={CLUBIQ_MUSIC_URL} target="_blank" rel="noopener noreferrer">ClubIQ Music öffnen</a>
  </div>;
}

export function TabletMusicVideo({ playlist, stop }: { playlist: MusicPlaylist; stop: () => void }) {
  return <aside className="tc5-music-video" aria-label="Musikwiedergabe auf dem Tablet">
    <div className="tc5-music-video-head"><strong>{playlist.name}</strong><button aria-label="Videoplayer schließen" onClick={stop}>×</button></div>
    <iframe title="Abgestimmte YouTube-Playlist" src={youtubePlaylistUrl(playlist)} referrerPolicy="strict-origin-when-cross-origin"
      allow="encrypted-media" />
    <a href={`https://www.youtube.com/watch?v=${playlist.videoIds[0]}`} target="_blank" rel="noopener noreferrer">Auf YouTube öffnen</a>
  </aside>;
}
