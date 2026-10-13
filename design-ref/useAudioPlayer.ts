'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gridFor, type Grid } from './beatmap';

export interface Track { title: string; src: string }
// Used only if tracks.json is missing (it is generated at build time from public/assets/audio).
const DEFAULT_TRACKS: Track[] = [{ title: 'NIGHT DRIVE', src: '/assets/audio/night-drive.mp3' }];
const POS_LS = 'gtrpht_track_pos';
const IDX_LS = 'gtrpht_track_idx';
const STALL_MS = 9000;

declare global {
  interface Window { __gtrAudio?: HTMLAudioElement; __gtrGrid?: Grid | null }
}

export type AudioStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/**
 * Playlist player built for flaky mobile networks and iOS:
 * - plain <audio>, no WebAudio routing (MediaElementSource goes silent after an iOS interruption),
 * - play() rejections (autoplay policy) never leave the UI claiming it plays,
 * - a broken track skips to the next one, but gives up after one full lap instead of looping,
 * - a stalled stream is reloaded at the same position,
 * - lock-screen / headset controls via the Media Session API.
 * The hero reel reads window.__gtrAudio + window.__gtrGrid (beat grid) to cut on the beat.
 */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef<Track[]>(DEFAULT_TRACKS);
  const idxRef = useRef(0);
  const wantPlay = useRef(false);
  const errRun = useRef(0);
  const [status, setStatus] = useState<AudioStatus>('idle');
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const [idx, setIdx] = useState(0);
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS);

  const tryPlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.src) return;
    wantPlay.current = true;
    const p = a.play();
    if (p) p.catch((e: DOMException) => {
      // autoplay blocked or interrupted: show it as paused, keep the intent only for real errors
      if (e?.name === 'NotAllowedError') wantPlay.current = false;
      if (a.paused) setStatus(a.error ? 'error' : 'paused');
    });
  }, []);

  const load = useCallback((i: number, autoplay: boolean, at = 0) => {
    const a = audioRef.current, list = tracksRef.current;
    if (!a || !list.length) return;
    const n = ((i % list.length) + list.length) % list.length;
    idxRef.current = n;
    setIdx(n); setT(at); setD(0);
    a.src = list[n].src;
    a.loop = list.length === 1;
    window.__gtrGrid = gridFor(list[n].src);
    if (at > 0) a.addEventListener('loadedmetadata', () => { try { a.currentTime = at; } catch { /* ignore */ } }, { once: true });
    a.load();
    try { localStorage.setItem(IDX_LS, String(n)); if (!at) localStorage.removeItem(POS_LS); } catch { /* ignore */ }
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: list[n].title, artist: 'BANGTAOSTYLE.COM', album: 'Protocol 10.10',
          artwork: [{ src: '/assets/video/v-palms.jpg', sizes: '960x540', type: 'image/jpeg' }],
        });
      } catch { /* old browsers */ }
    }
    if (autoplay) { setStatus('loading'); tryPlay(); } else setStatus('paused');
  }, [tryPlay]);

  useEffect(() => {
    const a = new Audio();
    audioRef.current = a;
    window.__gtrAudio = a;
    a.preload = 'metadata';
    let alive = true;

    fetch('/assets/audio/tracks.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((list: Track[] | null) => {
        if (!alive) return;
        if (Array.isArray(list) && list.length) { tracksRef.current = list; setTracks(list); }
        let i = 0, pos = 0;
        try { i = +(localStorage.getItem(IDX_LS) || 0); pos = +(localStorage.getItem(POS_LS) || 0); } catch { /* ignore */ }
        if (!isFinite(i) || i < 0 || i >= tracksRef.current.length) { i = 0; pos = 0; }
        load(i, wantPlay.current, isFinite(pos) && pos > 0 ? pos : 0);
      });

    let lastSave = 0, stallT = 0, lastProgress = 0;
    const savePos = () => { try { localStorage.setItem(POS_LS, String(a.currentTime || 0)); } catch { /* ignore */ } };
    const clearStall = () => { clearTimeout(stallT); stallT = 0; };
    const armStall = () => {
      clearStall();
      lastProgress = a.currentTime;
      stallT = window.setTimeout(() => {
        // still stuck on the same spot → reload the stream where it stopped
        if (wantPlay.current && Math.abs(a.currentTime - lastProgress) < 0.25) load(idxRef.current, true, a.currentTime);
      }, STALL_MS);
    };

    const onTime = () => {
      setT(a.currentTime); setD(isFinite(a.duration) ? a.duration : 0);
      if (Date.now() - lastSave > 2000) { lastSave = Date.now(); savePos(); }
      if ('mediaSession' in navigator && isFinite(a.duration) && a.duration > 0) {
        try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate }); } catch { /* ignore */ }
      }
    };
    const onMeta = () => setD(isFinite(a.duration) ? a.duration : 0);
    const onPlaying = () => { errRun.current = 0; clearStall(); setStatus('playing'); };
    const onPause = () => { clearStall(); if (!a.ended) setStatus(a.error ? 'error' : 'paused'); savePos(); };
    const onWaiting = () => { if (wantPlay.current && !a.paused) { setStatus('loading'); armStall(); } };
    const onEnded = () => { if (tracksRef.current.length > 1) load(idxRef.current + 1, true); };
    const onError = () => {
      clearStall();
      errRun.current += 1;
      // try the next track, but never spin forever if the network is gone
      if (errRun.current < tracksRef.current.length && tracksRef.current.length > 1) load(idxRef.current + 1, wantPlay.current);
      else { wantPlay.current = false; setStatus('error'); }
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('playing', onPlaying);
    a.addEventListener('pause', onPause);
    a.addEventListener('waiting', onWaiting);
    a.addEventListener('stalled', onWaiting);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);

    // Browsers block autoplay with sound: start on the first real tap (click, not a scroll touch).
    const kick = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-audio-ui], a, input, select, textarea, iframe, video, .maplibregl-map')) return;
      window.removeEventListener('click', kick, true);
      if (a.paused && a.src && !wantPlay.current) tryPlay();
    };
    window.addEventListener('click', kick, true);

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      const set = (k: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(k, h); } catch { /* unsupported action */ } };
      set('play', () => tryPlay());
      set('pause', () => { wantPlay.current = false; a.pause(); });
      set('nexttrack', () => load(idxRef.current + 1, true));
      set('previoustrack', () => load(idxRef.current - 1, true));
      set('seekto', (det) => { if (det.seekTime != null && isFinite(a.duration)) a.currentTime = Math.min(a.duration, det.seekTime); });
    }
    window.addEventListener('pagehide', savePos);

    return () => {
      alive = false;
      clearStall();
      a.pause();
      a.removeAttribute('src'); a.load();
      if (window.__gtrAudio === a) delete window.__gtrAudio;
      a.removeEventListener('timeupdate', onTime); a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('playing', onPlaying); a.removeEventListener('pause', onPause);
      a.removeEventListener('waiting', onWaiting); a.removeEventListener('stalled', onWaiting);
      a.removeEventListener('ended', onEnded); a.removeEventListener('error', onError);
      window.removeEventListener('click', kick, true);
      window.removeEventListener('pagehide', savePos);
    };
  }, [load, tryPlay]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (status === 'error') { errRun.current = 0; load(idxRef.current, true, a.currentTime || 0); return; }
    if (a.paused) { setStatus('loading'); tryPlay(); } else { wantPlay.current = false; a.pause(); }
  }, [status, load, tryPlay]);
  const next = useCallback(() => load(idxRef.current + 1, true), [load]);
  const prev = useCallback(() => {
    const a = audioRef.current;
    if (a && a.currentTime > 4) { a.currentTime = 0; return; }
    load(idxRef.current - 1, true);
  }, [load]);
  const seek = useCallback((ratio: number) => {
    const a = audioRef.current;
    if (!a || !d) return;
    a.currentTime = Math.max(0, Math.min(1, ratio)) * d;
  }, [d]);

  const playing = status === 'playing' || status === 'loading';
  return { title: tracks[idx]?.title || '', count: tracks.length, idx, status, playing, t, d, toggle, seek, next, prev };
}
