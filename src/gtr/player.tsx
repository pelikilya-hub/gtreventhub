// Плеер GTR SOUND: первые треки BOSS в футере мобильной версии.
// Один <audio> живёт в оболочке и переживает навигацию между экранами.
// Web Audio AnalyserNode слушает бас и пишет уровень в CSS-переменную
// --gtr-pulse на корне — атмосфера и скин плеера дышат в ритм музыки.
// Эквалайзер и прогресс двигаются напрямую через refs в rAF (без ререндеров).
import { useEffect, useRef, useState } from "react";

const TRACKS = [
  { src: "/music/dark-velvet-circuit.mp3", title: "DARK VELVET CIRCUIT" },
  { src: "/music/midnight-circuit.mp3", title: "MIDNIGHT CIRCUIT" },
  { src: "/music/concrete-static.mp3", title: "CONCRETE STATIC" },
  { src: "/music/frozen-shadows.mp3", title: "FROZEN SHADOWS" },
];

export function GtrPlayerBar() {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef(0);
  const levelRef = useRef(0);
  // состояние детектора ударов: огибающие, время последнего удара,
  // интервалы и текущий темп
  const beatRef = useRef({ fast: 0, slow: 0, last: 0, gaps: [] as number[], bpm: 0 });
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const wantPlayRef = useRef(false);

  // состояние воспроизведения нужно не только панели: от него выходит и
  // уходит танцор. Отдаём его в корень документа — так въезд и уход
  // делает CSS, без лишних перерисовок React.
  useEffect(() => {
    document.documentElement.dataset.gtrPlaying = playing ? "1" : "";
  }, [playing]);

  const reduced = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Анализатор подключается один раз, из жеста (iOS требует resume из клика)
  const ensureViz = () => {
    if (reduced()) return;
    const a = audioRef.current;
    if (!a) return;
    try {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const srcNode = ctx.createMediaElementSource(a);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.72;
        srcNode.connect(an);
        an.connect(ctx.destination);
        ctxRef.current = ctx;
        analyserRef.current = an;
        dataRef.current = new Uint8Array(an.frequencyBinCount);
      }
      void ctxRef.current.resume();
    } catch {
      // без Web Audio трек всё равно играет — просто без пульса
    }
  };

  const loop = () => {
    const a = audioRef.current;
    const an = analyserRef.current;
    const data = dataRef.current;
    if (a && an && data) {
      an.getByteFrequencyData(data);
      // бас — первые бины спектра: это и есть «ритм» трека
      let bass = 0;
      for (let i = 1; i <= 10; i++) bass += data[i];
      bass = bass / (10 * 255);
      levelRef.current += (bass - levelRef.current) * 0.3;
      const lvl = Math.max(0, Math.min(1, (levelRef.current - 0.28) * 1.9));
      document.documentElement.style.setProperty("--gtr-pulse", lvl.toFixed(3));

      // Темп трека из тех же данных, что и пульс. Удар — момент, когда
      // быстрая огибающая баса пробивает медленную с запасом; между
      // ударами держим рефрактерный зазор, иначе один бас-бочок
      // насчитает три удара. Из последних интервалов берём медиану —
      // одиночный сбивчивый брейк не должен дёргать танец.
      const b = beatRef.current;
      b.fast += (bass - b.fast) * 0.5;
      b.slow += (bass - b.slow) * 0.05;
      const now = performance.now();
      if (b.fast > b.slow * 1.32 && b.fast > 0.12 && now - b.last > 240) {
        if (b.last > 0) {
          const iv = now - b.last;
          if (iv < 2000) {
            b.gaps.push(iv);
            if (b.gaps.length > 12) b.gaps.shift();
          }
        }
        b.last = now;
        if (b.gaps.length >= 4) {
          const sorted = [...b.gaps].sort((x, y) => x - y);
          let bpm = 60000 / sorted[Math.floor(sorted.length / 2)];
          // приводим в танцевальный диапазон: половинные и двойные доли
          // одного темпа — это один темп
          while (bpm < 70) bpm *= 2;
          while (bpm > 180) bpm /= 2;
          if (Math.abs(bpm - b.bpm) > 3) {
            b.bpm = bpm;
            document.documentElement.style.setProperty("--gtr-bpm", String(Math.round(bpm)));
            window.dispatchEvent(new CustomEvent("gtr:bpm", { detail: Math.round(bpm) }));
          }
        }
      }
      // 4 полосы эквалайзера — низ / низ-середина / середина / верх
      const bands = [
        [1, 6],
        [7, 18],
        [19, 44],
        [45, 96],
      ];
      bands.forEach(([lo, hi], bi) => {
        const el = barsRef.current[bi];
        if (!el) return;
        let s = 0;
        for (let i = lo; i <= hi; i++) s += data[i];
        const v = s / ((hi - lo + 1) * 255);
        el.style.transform = `scaleY(${(0.15 + v * 0.95).toFixed(3)})`;
      });
    }
    if (a && progressRef.current && a.duration > 0) {
      progressRef.current.style.transform = `scaleX(${(a.currentTime / a.duration).toFixed(4)})`;
    }
    rafRef.current = requestAnimationFrame(loop);
  };

  const startLoop = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  };
  const stopLoop = () => {
    cancelAnimationFrame(rafRef.current);
    document.documentElement.style.setProperty("--gtr-pulse", "0");
    barsRef.current.forEach((el) => {
      if (el) el.style.transform = "scaleY(0.15)";
    });
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      ensureViz();
      wantPlayRef.current = true;
      void a.play().catch(() => {
        wantPlayRef.current = false;
        setPlaying(false);
      });
    } else {
      wantPlayRef.current = false;
      a.pause();
    }
  };

  const next = () => {
    const a = audioRef.current;
    const keep = wantPlayRef.current || (a ? !a.paused : false);
    wantPlayRef.current = keep;
    setIdx((i) => (i + 1) % TRACKS.length);
  };

  // Смена трека: перезагрузить источник и продолжить, если играли
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.load();
    if (progressRef.current) progressRef.current.style.transform = "scaleX(0)";
    if (wantPlayRef.current) void a.play().catch(() => setPlaying(false));
  }, [idx]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      document.documentElement.style.removeProperty("--gtr-pulse");
      void ctxRef.current?.close().catch(() => {});
    };
  }, []);

  const tr = TRACKS[idx];

  return (
    <div className={`gtr-playbar ${playing ? "playing" : ""}`}>
      <audio
        ref={audioRef}
        src={tr.src}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          startLoop();
        }}
        onPause={() => {
          setPlaying(false);
          stopLoop();
        }}
        onEnded={() => {
          wantPlayRef.current = true;
          setIdx((i) => (i + 1) % TRACKS.length);
        }}
      />
      <div className="gtr-playbar-progress" aria-hidden>
        <div ref={progressRef} />
      </div>
      <button
        className="gtr-play-btn"
        aria-label={playing ? "Pause" : "Play"}
        onClick={toggle}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
            <rect x="6" y="5" width="4" height="14" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="gtr-playbar-meta" onClick={toggle}>
        <span className="gtr-playbar-title">{tr.title}</span>
        <span className="gtr-playbar-sub gtr-mono">
          GTR SOUND · {String(idx + 1).padStart(2, "0")}/{String(TRACKS.length).padStart(2, "0")}
        </span>
      </div>
      <span className="gtr-playbar-eq" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            ref={(el) => {
              barsRef.current[i] = el;
            }}
          />
        ))}
      </span>
      <button className="gtr-next-btn" aria-label="Next track" onClick={next}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
          <path d="M5 5.5v13l9-6.5z" fill="currentColor" />
          <rect x="16" y="5" width="3" height="14" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
