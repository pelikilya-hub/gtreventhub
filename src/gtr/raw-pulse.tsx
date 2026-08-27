// GTR RAW PULSE — Фаза 1: транзакционные CTA, swipe-to-book, hold-to-confirm.
// Геометрия везде острые срезанные углы (var(--gtr-cut)) — капсулы из
// эталонного кита сознательно не используются, см. gtr.css.
import { useEffect, useRef, useState, type ReactNode } from "react";

const vibrate = (pattern: number | number[]) => {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // iOS Safari не даёт API вообще — тихо игнорируем
    }
  }
};

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;


// ---------- CTA: крупные транзакционные кнопки ----------

export type CtaVariant = "primary" | "split" | "reserve" | "live" | "cancel";
export type CtaState = "idle" | "loading" | "disabled";

export function CtaButton({
  label,
  price,
  icon,
  variant = "primary",
  state = "idle",
  onClick,
  ariaLabel,
}: {
  label: string;
  price?: string;
  icon?: ReactNode;
  variant?: CtaVariant;
  state?: CtaState;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const disabled = state === "disabled" || state === "loading";
  const cls = [
    "gtr-cta",
    variant === "live" ? "gtr-cta-live" : "",
    variant === "cancel" ? "gtr-cta-cancel" : "",
    variant === "split" ? "gtr-cta-split" : "",
    state === "loading" ? "gtr-cta-loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (variant === "split") {
    return (
      <button className={cls} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
        <span className="gtr-cta-price">{price}</span>
        <span className="gtr-cta-action">
          <span className="gtr-cta-label">{label}</span>
        </span>
      </button>
    );
  }

  return (
    <button className={cls} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {state === "loading" ? <span className="gtr-cta-spin" aria-hidden /> : icon}
      <span className="gtr-cta-label">{label}</span>
    </button>
  );
}

// ---------- Swipe-to-book ----------
// Производительность: во время жеста НЕ дёргаем React вообще — состояние
// живёт в ref, а в DOM пишутся только transform/opacity трёх композитных
// слоёв за один rAF-кадр. Раньше setState на каждый pointermove давал
// перерисовку React 60 раз в секунду и анимацию через width (пересчёт
// лейаута) — теперь ни того, ни другого.

type SwipeStatus = "idle" | "sending" | "done";

const HANDLE = 52;
const THRESHOLD = 0.72; // порог подтверждения по спеке RAW PULSE 9.1

export function SwipeToBook({
  label = "ПРОВЕДИ ДЛЯ БРОНИ →",
  desktopLabel = "ЗАБРОНИРОВАТЬ СТОЛ",
  sendingLabel = "ОТПРАВЛЯЕМ…",
  doneLabel = "✓ СТОЛ ЗАБРОНИРОВАН",
  onConfirm,
  disabled,
}: {
  label?: string;
  desktopLabel?: string;
  sendingLabel?: string;
  doneLabel?: string;
  onConfirm: () => Promise<{ ok: boolean; reason?: string }>;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const posRef = useRef(0);
  const maxXRef = useRef(1);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startPosRef = useRef(0);
  const hapticStage = useRef(0);
  const rafRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const springRef = useRef(0);

  const [status, setStatus] = useState<SwipeStatus>("idle");
  const [error, setError] = useState("");
  const [popKey, setPopKey] = useState(0);

  useEffect(() => {
    const measure = () => {
      const el = trackRef.current;
      if (el) maxXRef.current = Math.max(1, el.clientWidth - HANDLE - 10);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(springRef.current);
    };
  }, []);

  // единственная точка записи в DOM — только композитные свойства
  const commit = (p: number) => {
    const max = maxXRef.current;
    const k = Math.max(0, Math.min(1, p / max));
    if (handleRef.current) handleRef.current.style.transform = `translate3d(${p}px,0,0)`;
    // заливка едет, а не тянется — мягкая кромка не деформируется
    if (fillRef.current) {
      const shown = (p + HANDLE / 2) / (max + HANDLE);
      fillRef.current.style.transform = `translate3d(${(shown - 1) * 100}%,0,0)`;
    }
    if (bloomRef.current) {
      bloomRef.current.style.transform = `translate3d(${p + HANDLE / 2}px,0,0) scale(${0.6 + k * 0.75})`;
      bloomRef.current.style.opacity = `${Math.min(1, k * 1.6)}`;
    }
    if (labelRef.current) labelRef.current.style.opacity = `${Math.max(0, 1 - k * 1.7)}`;
  };

  // все записи собираются в один кадр — несколько pointermove подряд
  // не приводят к нескольким layout/paint
  const schedule = (p: number) => {
    posRef.current = p;
    pendingRef.current = p;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (pendingRef.current !== null) commit(pendingRef.current);
      pendingRef.current = null;
    });
  };

  const springTo = (to: number, onDone?: () => void) => {
    cancelAnimationFrame(springRef.current);
    let velocity = 0;
    const reduced = reducedMotion();
    const stiffness = reduced ? 0.42 : 0.26;
    const damping = reduced ? 0.9 : 0.72;
    const step = () => {
      const force = (to - posRef.current) * stiffness;
      velocity = (velocity + force) * damping;
      posRef.current += velocity;
      commit(posRef.current);
      if (Math.abs(to - posRef.current) > 0.4 || Math.abs(velocity) > 0.4) {
        springRef.current = requestAnimationFrame(step);
      } else {
        posRef.current = to;
        commit(to);
        onDone?.();
      }
    };
    springRef.current = requestAnimationFrame(step);
  };

  const setGrab = (on: boolean) => {
    trackRef.current?.classList.toggle("is-grab", on);
  };

  const onDown = (e: React.PointerEvent) => {
    if (disabled || status !== "idle") return;
    draggingRef.current = true;
    hapticStage.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startPosRef.current = posRef.current;
    cancelAnimationFrame(springRef.current);
    setGrab(true);
    vibrate(5);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const max = maxXRef.current;
    const p = Math.min(max, Math.max(0, startPosRef.current + (e.clientX - startXRef.current)));
    schedule(p);
    const k = p / max;
    if (k >= 0.5 && hapticStage.current < 1) {
      hapticStage.current = 1;
      vibrate(8);
    }
    if (k >= THRESHOLD && hapticStage.current < 2) {
      hapticStage.current = 2;
      vibrate(16);
    }
  };

  const onUp = async () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    hapticStage.current = 0;
    setGrab(false);
    const k = posRef.current / maxXRef.current;
    if (k < THRESHOLD) {
      springTo(0);
      return;
    }
    springTo(maxXRef.current);
    await send();
  };

  const send = async () => {
    setStatus("sending");
    setError("");
    try {
      const r = await onConfirm();
      if (r.ok) {
        vibrate([12, 40, 18]);
        // подпись гасилась инлайново во время жеста — возвращаем её,
        // иначе «СТОЛ ЗАБРОНИРОВАН» останется невидимым
        if (labelRef.current) labelRef.current.style.opacity = "1";
        setPopKey((n) => n + 1);
        setStatus("done");
      } else {
        setError(r.reason || "Не удалось забронировать — попробуйте ещё раз");
        setStatus("idle");
        springTo(0);
      }
    } catch {
      setError("Сервер недоступен — попробуйте ещё раз");
      setStatus("idle");
      springTo(0);
    }
  };

  const shownLabel = status === "done" ? doneLabel : status === "sending" ? sendingLabel : label;

  return (
    <div>
      <div ref={trackRef} className={`gtr-swipe${status === "done" ? " is-done" : ""}`}>
        <div ref={fillRef} className="gtr-swipe-fill" />
        <div ref={bloomRef} className="gtr-swipe-bloom" aria-hidden />
        <div className="gtr-swipe-grain" />
        <div ref={labelRef} className={`gtr-swipe-label${status === "done" ? " is-done" : ""}`}>
          {shownLabel}
        </div>
        {status === "done" ? (
          <img
            key={popKey}
            className="gtr-swipe-success is-play"
            src="/raw-pulse/success-champagne.webp"
            alt=""
            aria-hidden
          />
        ) : null}
        <div
          ref={handleRef}
          className={`gtr-swipe-handle${status === "done" ? " is-done" : ""}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-hidden
        >
          <img className="gtr-swipe-sticker" src="/raw-pulse/handle-logo.webp" alt="" />
        </div>
      </div>
      {/* На десктопе это обычная кнопка (жест мышью неудобен), на тач-
          устройствах — скрытая доступная альтернатива для VoiceOver/
          TalkBack и клавиатуры. Переключает медиазапрос, см. gtr.css */}
      <button
        className="gtr-swipe-alt"
        disabled={disabled || status !== "idle"}
        onClick={send}
      >
        {status === "done" ? doneLabel : status === "sending" ? sendingLabel : desktopLabel}
      </button>
      {error ? (
        <div
          className="gtr-mono"
          style={{ marginTop: 8, font: "500 12px/1.5 'JetBrains Mono',monospace", color: "var(--gtr-red-hot)" }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Hold-to-confirm ----------

export function HoldToConfirm({
  label = "УДЕРЖИВАЙ",
  doneLabel = "✓",
  durationMs = 850,
  onConfirm,
  locked,
}: {
  label?: string;
  doneLabel?: string;
  durationMs?: number;
  onConfirm: () => void;
  locked?: boolean;
}) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const startRef = useRef(0);
  const rafRef = useRef(0);
  const hapticStage = useRef(0);

  const stop = (springBack: boolean) => {
    cancelAnimationFrame(rafRef.current);
    if (springBack) {
      const from = pct;
      const dur = 180;
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        setPct(from * (1 - k));
        if (k < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const onDown = () => {
    if (locked || done) return;
    hapticStage.current = 0;
    startRef.current = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - startRef.current) / durationMs);
      setPct(k);
      if (k >= 0.5 && hapticStage.current < 1) {
        hapticStage.current = 1;
        vibrate(8);
      }
      if (k >= 0.85 && hapticStage.current < 2) {
        hapticStage.current = 2;
        vibrate(16);
      }
      if (k >= 1) {
        vibrate([12, 40, 18]);
        setDone(true);
        onConfirm();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const onUp = () => {
    if (done) return;
    stop(true);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <button
      className={`gtr-hold${done ? " is-done" : ""}${locked ? " is-locked" : ""}`}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      disabled={locked}
      aria-label={label}
    >
      <svg className="gtr-hold-ring" width="76" height="76" viewBox="0 0 76 76" aria-hidden>
        <circle className="track" cx="38" cy="38" r={R} />
        <circle
          className="fill"
          cx="38"
          cy="38"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <span className="gtr-hold-label">{done ? doneLabel : label}</span>
    </button>
  );
}
