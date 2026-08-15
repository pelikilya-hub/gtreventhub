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

// критически демпфированная пружина через интеграцию скорости на каждый
// кадр — настоящая физика, не canned CSS-переход
function springTo(
  from: number,
  to: number,
  onUpdate: (v: number) => void,
  onDone?: () => void,
): () => void {
  let pos = from;
  let velocity = 0;
  let raf = 0;
  const reduced = reducedMotion();
  const stiffness = reduced ? 0.4 : 0.22;
  const damping = reduced ? 0.9 : 0.74;
  function step() {
    const force = (to - pos) * stiffness;
    velocity = (velocity + force) * damping;
    pos += velocity;
    onUpdate(pos);
    if (Math.abs(to - pos) > 0.4 || Math.abs(velocity) > 0.4) {
      raf = requestAnimationFrame(step);
    } else {
      onUpdate(to);
      onDone?.();
    }
  }
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

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

type SwipeStatus = "idle" | "sending" | "done";

export function SwipeToBook({
  label = "ПРОВЕДИ ДЛЯ БРОНИ →",
  sendingLabel = "ОТПРАВЛЯЕМ…",
  doneLabel = "✓ СТОЛ ЗАБРОНИРОВАН",
  onConfirm,
  disabled,
}: {
  label?: string;
  sendingLabel?: string;
  doneLabel?: string;
  onConfirm: () => Promise<{ ok: boolean; reason?: string }>;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const stopSpringRef = useRef<() => void>(() => {});
  const posRef = useRef(0);
  const maxXRef = useRef(0);
  const draggingRef = useRef(false);
  const lastSparkT = useRef(0);
  const HANDLE = 52;

  const [status, setStatus] = useState<SwipeStatus>("idle");
  const [error, setError] = useState("");
  const [burstKey, setBurstKey] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (trackRef.current) maxXRef.current = trackRef.current.clientWidth - HANDLE - 8;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const paint = (p: number) => {
    posRef.current = p;
    if (handleRef.current) handleRef.current.style.transform = `translateX(${p}px)`;
    if (fillRef.current) fillRef.current.style.width = `${p + HANDLE / 2}px`;
    const max = maxXRef.current || 1;
    setProgress(Math.max(0, Math.min(1, p / max)));
  };

  const spawnSpark = (x: number, y: number) => {
    const track = trackRef.current;
    if (!track) return;
    const s = document.createElement("div");
    s.className = "gtr-swipe-spark";
    const dy = (Math.random() - 0.5) * 16;
    s.style.setProperty("--dx", `${8 + Math.random() * 10}px`);
    s.style.setProperty("--dy", `${dy}px`);
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    track.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  };

  const onDown = (e: React.PointerEvent) => {
    if (disabled || status !== "idle") return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startPosRef.current = posRef.current;
    stopSpringRef.current();
  };
  const startXRef = useRef(0);
  const startPosRef = useRef(0);
  const hapticStage = useRef(0);

  const onMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const max = maxXRef.current;
    const dx = e.clientX - startXRef.current;
    const p = Math.min(max, Math.max(0, startPosRef.current + dx));
    paint(p);
    const prog = max > 0 ? p / max : 0;
    if (prog >= 0.5 && hapticStage.current < 1) {
      hapticStage.current = 1;
      vibrate(8);
    }
    if (prog >= 0.72 && hapticStage.current < 2) {
      hapticStage.current = 2;
      vibrate(16);
    }
    const now = performance.now();
    if (!reducedMotion() && prog > 0.12 && now - lastSparkT.current > 45) {
      lastSparkT.current = now;
      spawnSpark(p + HANDLE - 6, HANDLE / 2 - 1.5);
    }
  };

  const onUp = async () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    hapticStage.current = 0;
    const max = maxXRef.current;
    const prog = max > 0 ? posRef.current / max : 0;
    if (prog < 0.72) {
      stopSpringRef.current = springTo(posRef.current, 0, paint);
      return;
    }
    // порог пройден — держим puck в конце и ждём ответ сервера, повторный
    // жест заблокирован до ответа (спека раздел 9.1)
    stopSpringRef.current = springTo(posRef.current, max, paint);
    setStatus("sending");
    setError("");
    try {
      const r = await onConfirm();
      if (r.ok) {
        vibrate([12, 40, 18]);
        setBurstKey((k) => k + 1);
        setStatus("done");
      } else {
        setError(r.reason || "Не удалось забронировать — попробуйте ещё раз");
        setStatus("idle");
        stopSpringRef.current = springTo(posRef.current, 0, paint);
      }
    } catch {
      setError("Сервер недоступен — попробуйте ещё раз");
      setStatus("idle");
      stopSpringRef.current = springTo(posRef.current, 0, paint);
    }
  };

  const currentLabel = status === "done" ? doneLabel : status === "sending" ? sendingLabel : label;

  return (
    <div>
      <div
        ref={trackRef}
        className={`gtr-swipe${status === "done" ? " is-done" : ""}`}
        role="presentation"
      >
        <div className="gtr-swipe-grain" />
        <div ref={fillRef} className="gtr-swipe-fill" />
        <div className={`gtr-swipe-label${status === "done" ? " is-done" : ""}`}>{currentLabel}</div>
        <div
          ref={handleRef}
          className={`gtr-swipe-handle${status === "done" ? " is-done" : ""}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          role="button"
          tabIndex={-1}
          aria-hidden
        >
          <span className="gtr-swipe-handle-mark">GTR</span>
        </div>
        <div key={burstKey} className={`gtr-swipe-burst${burstKey ? " is-play" : ""}`} aria-hidden />
      </div>
      {/* доступная альтернатива для VoiceOver/TalkBack и клавиатуры */}
      <button
        className="gtr-swipe-alt"
        disabled={disabled || status !== "idle"}
        aria-label="Подтвердить бронь стола"
        onClick={async () => {
          setStatus("sending");
          setError("");
          const r = await onConfirm();
          if (r.ok) {
            vibrate([12, 40, 18]);
            setStatus("done");
          } else {
            setError(r.reason || "Не удалось забронировать — попробуйте ещё раз");
            setStatus("idle");
          }
        }}
      >
        Подтвердить бронь
      </button>
      {error ? (
        <div
          className="gtr-mono"
          style={{ marginTop: 8, font: "500 10px/1.4 'JetBrains Mono',monospace", color: "var(--gtr-red-hot)" }}
        >
          {error}
        </div>
      ) : null}
      <span aria-live="polite" className="gtr-swipe-alt">
        {status === "sending" ? `${Math.round(progress * 100)}%` : ""}
      </span>
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
