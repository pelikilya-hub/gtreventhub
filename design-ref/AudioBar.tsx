'use client';
import { useAudioPlayer } from '@/lib/useAudioPlayer';
import { useHub } from '@/lib/HubContext';

const fmt = (v: number) => (isFinite(v) ? `${(v / 60) | 0}:${String((v | 0) % 60).padStart(2, '0')}` : '0:00');

/** Soundtrack dock as a BMW climate panel: three backlit keys (SVG icons — the old ⏮ ⏭ glyphs turned into
 *  blue emoji on iOS) and an orange segment-style display with the track and time. */
export function AudioBar() {
  const ru = useHub().lang === 'ru';
  const { title, count, idx, status, playing, t, d, toggle, seek, next, prev } = useAudioPlayer();
  const pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
  const line = status === 'error' ? (ru ? 'НЕТ СВЯЗИ · НАЖМИ ↻' : 'NO SIGNAL · TAP ↻') : status === 'loading' ? (ru ? 'ЗАГРУЗКА…' : 'LOADING…') : title;
  return (
    <div className={'glass audio' + (playing ? '' : ' paused') + (status === 'loading' ? ' loading' : '') + (status === 'error' ? ' error' : '')} data-audio-ui>
      <div className="ab-keys">
        {count > 1 && (
          <button className="key ab-k" onClick={prev} aria-label="previous">
            <svg width="20" height="14" viewBox="0 0 20 14" fill="currentColor" aria-hidden><rect x="1" y="1" width="2.4" height="12" rx=".6" /><path d="M11 1.6v10.8L4.4 7zM19 1.6v10.8L12.4 7z" /></svg>
          </button>
        )}
        <button className={'key ab-k ab-play' + (playing ? ' on' : '')} onClick={toggle} aria-label={status === 'error' ? 'retry' : playing ? 'pause' : 'play'}>
          {status === 'error'
            ? <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 7a5 5 0 1 1-1.5-3.6M12 1.5V5H8.5" /></svg>
            : playing
            ? <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" aria-hidden><rect x="2.2" y="1.5" width="3.4" height="11" rx=".7" /><rect x="8.4" y="1.5" width="3.4" height="11" rx=".7" /></svg>
            : <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor" aria-hidden><path d="M3.2 1.4v11.2L12.6 7z" /></svg>}
        </button>
        {count > 1 && (
          <button className="key ab-k" onClick={next} aria-label="next">
            <svg width="20" height="14" viewBox="0 0 20 14" fill="currentColor" aria-hidden><path d="M1 1.6v10.8L7.6 7zM9 1.6v10.8L15.6 7z" /><rect x="16.6" y="1" width="2.4" height="12" rx=".6" /></svg>
          </button>
        )}
      </div>
      <div className="ab-lcd">
        <div className="ab-line">
          <span className="eq" aria-hidden><i /><i /><i /><i /></span>
          <span className="ab-title">{line}</span>
          {count > 1 && <span className="ab-n">{idx + 1}/{count}</span>}
        </div>
        <div className="ab-line">
          <div role="slider" tabIndex={0} aria-label="position" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(t)} className="ab-seek"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); }}
            onKeyDown={(e) => { if (d && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) seek((t + (e.key === 'ArrowRight' ? 10 : -10)) / d); }}>
            <div className="ab-bar"><i style={{ width: pct + '%' }} /></div>
          </div>
          <span className="ab-time">{fmt(t)}<span className="ab-dur"> / {fmt(d)}</span></span>
        </div>
      </div>
    </div>
  );
}
