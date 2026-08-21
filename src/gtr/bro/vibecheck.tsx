// Вайб-чек GTR BRO: слушает 5 секунд через микрофон и честно прикидывает
// темп и вайб живого звука в зале — локально, без платного распознавания
// трека. Распознавание по отпечатку (Shazam-класс) на диджейском миксе
// или ремиксе чаще всего промахнётся мимо базы и всё равно платное за
// каждый запрос — прикидка по спектру работает всегда и бесплатно, просто
// не назовёт исполнителя.
//
// Микрофон открыт только на время прослушивания: дорожки останавливаются
// сразу после 5 секунд или при закрытии карточки — ни секунды лишнего
// доступа сверх честного назначения кнопки.
import { useEffect, useRef, useState } from "react";

import genreBpmRaw from "../data/genre-bpm.json";

const LISTEN_MS = 5000;

export type Vibe = { key: string; ru: string };
export type VibeResult = { bpm: number | null; vibe: Vibe };

type Band = { dir: string; ru: string; min: number; max: number };
const BANDS = genreBpmRaw.bands as Band[];

// Стиль — по тому же словарю dir/ru, что и вся остальная база жанров
// (genre-bpm.json), а не придуманные ярлыки: диапазоны — общепринятые
// темповые конвенции клубной музыки, не выгрузка с PromoDJ (там нет
// открытого API для аудио-отпечатков, а на живом диджей-миксе точное
// распознавание трека промахивается почти всегда). Диапазоны House и
// Techno, Hard Dance и Drum & Bass честно пересекаются в реальной
// музыке — при пересечении решает: бас/треб для Techno-vs-Trance
// (техно держит вес на бас-барабане, транс — на мелодических верхах),
// ровность бита для Hard Dance-vs-DnB (Hard Dance — прямая четверть,
// DnB — синкопированный брейк, разброс интервалов между ударами выше).
export function classifyVibe(
  bpm: number | null,
  bassRatio: number,
  regularity = 1,
): Vibe {
  if (bpm === null)
    return bassRatio > 0.5
      ? { key: "ambient-bass", ru: "фоновый бас без чёткого ритма" }
      : { key: "unclear", ru: "не расслышал чёткий ритм — подойди ближе к колонкам" };
  if (bpm < BANDS[0].min) return { key: "chill", ru: "чилл / лаундж" };

  const hits = BANDS.filter((b) => bpm >= b.min && bpm <= b.max);
  if (!hits.length) return { key: "energetic", ru: "бодрый ритм — стиль не читается однозначно" };

  let pick = hits[0];
  if (hits.length > 1) {
    const dirs = hits.map((h) => h.dir);
    if (dirs.includes("Techno") && dirs.includes("Trance"))
      pick = hits.find((h) => h.dir === (bassRatio > 0.48 ? "Techno" : "Trance"))!;
    else if (dirs.includes("Hard Dance") && dirs.includes("Drum & Bass"))
      pick = hits.find((h) => h.dir === (regularity > 0.72 ? "Hard Dance" : "Drum & Bass"))!;
  }

  let ru = pick.ru;
  if (pick.dir === "House" && bassRatio > 0.45) ru += " (бас-хаус)";
  else if (pick.dir === "Techno" && bassRatio > 0.55) ru += " (жёсткий, индастриал)";
  return { key: pick.dir.toLowerCase().replace(/[^a-z]+/g, "-"), ru };
}

type Phase = "idle" | "listening" | "result" | "error";

export function VibeCheck({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<VibeResult | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);

  // Закрыли карточку — гасим микрофон немедленно, даже если 5 секунд
  // ещё не прошли: открытый мик без причины — худшее, что тут можно
  // оставить висеть.
  useEffect(() => {
    if (open) return;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setPhase("idle");
    setResult(null);
  }, [open]);

  const listen = async () => {
    setPhase("listening");
    setErrMsg("");

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Без эхоподавления/автогейна: они рассчитаны на голос и ломают
        // басовую огибающую, по которой считаем темп трека.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      void ctx.close().catch(() => {});
      ctxRef.current = null;
      setErrMsg("Нет доступа к микрофону — разреши в настройках браузера");
      setPhase("error");
      return;
    }
    streamRef.current = stream;
    void ctx.resume();

    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.65;
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);

    const beat = { fast: 0, slow: 0, last: 0, gaps: [] as number[] };
    let bassSum = 0;
    let midSum = 0;
    let trebleSum = 0;
    const started = performance.now();

    const finish = () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void ctx.close().catch(() => {});
      ctxRef.current = null;

      let bpm: number | null = null;
      // Ровность интервалов между ударами — второй сигнал вдобавок к
      // темпу: считаем только при достаточной выборке (4+ интервала),
      // иначе разброс на двух-трёх ударах ничего не значит.
      let regularity = 1;
      if (beat.gaps.length >= 3) {
        const sorted = [...beat.gaps].sort((a, b) => a - b);
        let v = 60000 / sorted[Math.floor(sorted.length / 2)];
        while (v < 70) v *= 2;
        while (v > 180) v /= 2;
        bpm = Math.round(v);
        if (beat.gaps.length >= 4) {
          const mean = beat.gaps.reduce((s, g) => s + g, 0) / beat.gaps.length;
          const variance = beat.gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / beat.gaps.length;
          const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
          regularity = Math.max(0, Math.min(1, 1 - cv));
        }
      }
      const total = bassSum + midSum + trebleSum || 1;
      setResult({ bpm, vibe: classifyVibe(bpm, bassSum / total, regularity) });
      setPhase("result");
    };

    const tick = () => {
      an.getByteFrequencyData(data);
      let bass = 0;
      let mid = 0;
      let treble = 0;
      const hi = Math.min(200, data.length - 1);
      for (let i = 1; i <= 10; i++) bass += data[i];
      for (let i = 11; i <= 60; i++) mid += data[i];
      for (let i = 61; i <= hi; i++) treble += data[i];
      bassSum += bass / (10 * 255);
      midSum += mid / (50 * 255);
      trebleSum += treble / ((hi - 60) * 255);

      // Тот же детектор удара, что и в футере-плеере: быстрая огибающая
      // баса пробивает медленную — это и есть удар; рефрактерный зазор
      // 240мс не даёт одному бас-бочку насчитать три удара подряд.
      beat.fast += (bass / (10 * 255) - beat.fast) * 0.5;
      beat.slow += (bass / (10 * 255) - beat.slow) * 0.05;
      const now = performance.now();
      if (beat.fast > beat.slow * 1.32 && beat.fast > 0.12 && now - beat.last > 240) {
        if (beat.last > 0) {
          const iv = now - beat.last;
          if (iv < 2000) beat.gaps.push(iv);
        }
        beat.last = now;
      }

      if (now - started < LISTEN_MS) rafRef.current = requestAnimationFrame(tick);
      else finish();
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  if (!open) return null;

  return (
    <div className="gtr-vibe" role="dialog" aria-label="Вайб-чек">
      <div className="gtr-vibe-card">
        <button className="gtr-vibe-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        {phase === "idle" && (
          <>
            <div className="gtr-vibe-title">Вайб-чек</div>
            <div className="gtr-vibe-sub">
              Направь телефон на колонки — за 5 секунд прикинем темп и вайб
            </div>
            <button className="gtr-vibe-btn" onClick={() => void listen()}>
              Слушать
            </button>
          </>
        )}
        {phase === "listening" && (
          <>
            <div className="gtr-vibe-ring" aria-hidden />
            <div className="gtr-vibe-title">Слушаю…</div>
          </>
        )}
        {phase === "error" && (
          <>
            <div className="gtr-vibe-title">Не вышло</div>
            <div className="gtr-vibe-sub">{errMsg}</div>
            <button className="gtr-vibe-btn" onClick={() => void listen()}>
              Попробовать снова
            </button>
          </>
        )}
        {phase === "result" && result && (
          <>
            <div className="gtr-vibe-bpm">{result.bpm ?? "—"}</div>
            {result.bpm ? <div className="gtr-vibe-bpm-label">BPM</div> : null}
            <div className="gtr-vibe-tag">{result.vibe.ru}</div>
            <button className="gtr-vibe-btn ghost" onClick={() => void listen()}>
              Ещё раз
            </button>
          </>
        )}
      </div>
    </div>
  );
}
