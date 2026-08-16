// Интерфейс GTR BRO. Голос ведёт разговор, экран показывает то, что
// голосом передать нельзя: во что превратилась речь, что нашлось на самом
// деле и куда нажать.
//
// Две вещи здесь принципиальны. Первая: карточки собираются только из
// типизированных результатов инструментов — на экране не появляется
// ничего, чего не вернул сервер. Вторая: денежные и внешние действия
// подтверждаются нажатием, а не словом; голосовое «да» до этой границы
// не доходит.

import { useCallback, useEffect, useRef, useState } from "react";

import { broLogFn } from "../kv-api";
import { VOICE_LAB_LINES, type PersonaMode } from "./prompt.ru";
import { BroSession, type BroCard, type BroLine, type BroState, type BroVoice } from "./session";

const STATE_RU: Record<BroState, string> = {
  idle: "готов",
  requesting_permission: "прошу микрофон",
  connecting: "поднимаю связь",
  listening: "слушаю",
  thinking: "думаю",
  speaking: "говорю",
  running_tool: "смотрю афишу",
  awaiting_confirmation: "жду подтверждения",
  reconnecting: "переподключаюсь",
  error: "сбой",
  closed: "закрыто",
};

const ERROR_RU: Record<string, string> = {
  "mic-denied": "Микрофон закрыт. Разреши доступ в настройках браузера — без него голоса не будет.",
  network: "Связь не поднялась. Попробуй ещё раз.",
  webrtc: "Голосовой канал не открылся. Проверь сеть и повтори.",
  disabled: "GTR BRO пока выключен.",
  "no-key": "Голос не настроен на сервере.",
  rate: "Слишком много запусков подряд. Подожди пару минут.",
  auth: "Нужно войти в GTR.",
};

const MODES: [PersonaMode, string, string][] = [
  ["concierge", "Консьерж", "премиально и коротко"],
  ["bro", "Бро", "свой человек"],
  ["unhinged", "Без тормозов", "18+"],
];

const VOICES: [BroVoice, string][] = [
  ["cedar", "Cedar"],
  ["marin", "Marin"],
  ["ash", "Ash"],
];

// Счётчики шлём пачкой: сорок отдельных запросов на разговор — это
// нагрузка ради ничего.
function useMetrics() {
  const buf = useRef<string[]>([]);
  const flush = useCallback(() => {
    const events = buf.current.splice(0);
    if (events.length) void broLogFn({ data: { events } }).catch(() => {});
  }, []);
  useEffect(() => {
    const id = window.setInterval(flush, 20_000);
    return () => {
      window.clearInterval(id);
      flush();
    };
  }, [flush]);
  return useCallback((name: string) => {
    buf.current.push(name);
    if (buf.current.length >= 20) flush();
  }, [flush]);
}

export function GtrBroOverlay({
  open,
  onClose,
  screen,
  district,
  boss,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  screen?: string;
  district?: string;
  boss?: boolean;
  onNavigate: (route: string, entityId?: string) => void;
}) {
  const [state, setState] = useState<BroState>("idle");
  const [detail, setDetail] = useState<string>();
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<BroLine[]>([]);
  const [cards, setCards] = useState<BroCard[]>([]);
  const [mode, setMode] = useState<PersonaMode>("bro");
  const [voice, setVoice] = useState<BroVoice>("cedar");
  const [muted, setMuted] = useState(false);
  const [tune, setTune] = useState(false);
  const [lab, setLab] = useState(false);
  const [ask, setAsk] = useState<{ tool: string; summary: string; resolve: (v: boolean) => void } | null>(
    null,
  );
  const ses = useRef<BroSession | null>(null);
  const metric = useMetrics();

  const reset = () => {
    setLines([]);
    setCards([]);
    setLevel(0);
    setDetail(undefined);
  };

  const stop = useCallback(() => {
    ses.current?.stop("user");
    ses.current = null;
    setState("idle");
  }, []);

  const begin = useCallback(
    async (v: BroVoice, m: PersonaMode) => {
      ses.current?.stop("restart");
      reset();
      const s = new BroSession({
        onState: (st, d) => {
          setState(st);
          setDetail(d);
        },
        onLevel: setLevel,
        onLine: (l) => setLines((p) => [...p.slice(-20), l]),
        onCard: (c) => {
          if (c.kind === "navigate") {
            onNavigate(String(c.data.route), c.data.entityId);
            return;
          }
          setCards((p) => [c, ...p].slice(0, 6));
        },
        onMetric: metric,
        onConfirm: (a) => new Promise<boolean>((resolve) => setAsk({ ...a, resolve })),
      });
      ses.current = s;
      await s.start({ voice: v, personaMode: m, screen, district });
    },
    [district, metric, onNavigate, screen],
  );

  // Закрытие оверлея всегда рвёт соединение: забытая в фоне сессия — это
  // открытый микрофон и счёт по времени.
  useEffect(() => {
    if (!open && ses.current) stop();
  }, [open, stop]);
  useEffect(() => () => ses.current?.stop("unmount"), []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;

  const live = ses.current !== null && state !== "closed" && state !== "idle" && state !== "error";
  const busy = state === "connecting" || state === "requesting_permission";
  const err = state === "error" ? (ERROR_RU[detail ?? ""] ?? "Не получилось. Попробуй ещё раз.") : null;

  const runLab = async () => {
    setLab(true);
    metric("bro.voicelab.run");
    await begin(voice, "bro");
    // Ждём открытия канала: реплики, отправленные раньше, просто пропадут.
    for (let i = 0; i < 60 && ses.current?.current !== "listening"; i++)
      await new Promise((r) => setTimeout(r, 250));
    for (const l of VOICE_LAB_LINES) {
      if (!ses.current) break;
      ses.current.speakVerbatim(l.text);
      await new Promise((r) => setTimeout(r, 6500));
    }
  };

  return (
    <div className="gtr-bro" role="dialog" aria-modal="true" aria-label="GTR BRO">
      <button className="gtr-bro-scrim" aria-label="Закрыть" onClick={onClose} />

      <div className="gtr-bro-sheet">
        <div className="gtr-bro-head">
          <span className="gtr-bro-eyebrow">GTR BRO</span>
          <span className={`gtr-bro-state s-${state}`}>{STATE_RU[state]}</span>
          <button className="gtr-bro-x" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        {/* Визуализатор: единственная деталь, которая честно показывает,
            что микрофон открыт. Пока он живой — тебя слышат. */}
        <div className="gtr-bro-orb-wrap">
          <button
            className={`gtr-bro-orb${live ? " on" : ""}${busy ? " busy" : ""}`}
            style={{ ["--gtr-bro-lvl" as string]: String(0.6 + level * 0.75) }}
            onClick={() => (live ? stop() : void begin(voice, mode))}
            aria-label={live ? "Остановить" : "Начать разговор"}
          >
            <img src="/raw-pulse/handle-logo.webp" alt="" aria-hidden />
          </button>
          <div className="gtr-bro-hint">
            {live
              ? state === "speaking"
                ? "говори — перебью себя сам"
                : "слушаю"
              : busy
                ? "секунду"
                : "нажми и говори"}
          </div>
        </div>

        {err && <div className="gtr-bro-err">{err}</div>}

        {cards.length > 0 && (
          <div className="gtr-bro-cards">
            {cards.map((c, i) => (
              <BroCardView key={i} card={c} onNavigate={onNavigate} />
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <div className="gtr-bro-lines">
            {lines.slice(-6).map((l, i) => (
              <div key={i} className={`gtr-bro-line ${l.who}`}>
                {l.text}
              </div>
            ))}
          </div>
        )}

        <div className="gtr-bro-bar">
          <button
            className={`gtr-bro-btn${muted ? " on" : ""}`}
            disabled={!live}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              ses.current?.mute(next);
            }}
          >
            {muted ? "Микрофон выкл" : "Микрофон вкл"}
          </button>
          <button className="gtr-bro-btn" onClick={() => setTune((v) => !v)}>
            Настройки
          </button>
          <button className="gtr-bro-btn danger" disabled={!live} onClick={stop}>
            Стоп
          </button>
        </div>

        {tune && (
          <div className="gtr-bro-tune">
            <div className="gtr-bro-tune-t">Характер</div>
            <div className="gtr-bro-chips">
              {MODES.map(([id, name, note]) => (
                <button
                  key={id}
                  className={`gtr-bro-chip${mode === id ? " on" : ""}`}
                  onClick={() => {
                    setMode(id);
                    metric(`bro.mode.${id}`);
                    if (live) void begin(voice, id);
                  }}
                >
                  {name}
                  <i>{note}</i>
                </button>
              ))}
            </div>

            <div className="gtr-bro-tune-t">Голос</div>
            <div className="gtr-bro-chips">
              {VOICES.map(([id, name]) => (
                <button
                  key={id}
                  className={`gtr-bro-chip${voice === id ? " on" : ""}`}
                  onClick={() => {
                    setVoice(id);
                    metric(`bro.voice.${id}`);
                    if (live) void begin(id, mode);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>

            {boss && (
              <>
                <div className="gtr-bro-tune-t">Voice Lab</div>
                <div className="gtr-bro-note">
                  Пять одинаковых реплик выбранным голосом — сравнивается голос, а не текст.
                </div>
                <button className="gtr-bro-btn" disabled={lab && live} onClick={() => void runLab()}>
                  Прогнать {VOICES.find(([v]) => v === voice)?.[1]}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {ask && (
        <div className="gtr-bro-confirm" role="alertdialog" aria-label="Подтверждение">
          <div className="gtr-bro-confirm-box">
            <div className="gtr-bro-confirm-t">Подтверди действие</div>
            <div className="gtr-bro-confirm-s">{ask.summary}</div>
            <div className="gtr-bro-bar">
              <button
                className="gtr-bro-btn"
                onClick={() => {
                  ask.resolve(false);
                  setAsk(null);
                }}
              >
                Отмена
              </button>
              <button
                className="gtr-bro-btn go"
                onClick={() => {
                  ask.resolve(true);
                  setAsk(null);
                }}
              >
                Да, делаем
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const VERIF_RU: Record<string, string> = {
  confirmed: "подтверждено",
  likely: "с сайта площадки",
  unknown: "не подтверждено",
  sold_out: "продано",
  cancelled: "отменено",
};

function BroCardView({
  card,
  onNavigate,
}: {
  card: BroCard;
  onNavigate: (route: string, entityId?: string) => void;
}) {
  const d = card.data as Record<string, unknown>;

  if (card.kind === "route") {
    const legs = (d.legs as Record<string, unknown>[] | undefined) ?? [];
    return (
      <div className="gtr-bro-card">
        <div className="gtr-bro-card-k">Маршрут вечера</div>
        {legs.map((l, i) => (
          <div key={i} className="gtr-bro-leg">
            <b>{String(l.arrive_hour).padStart(2, "0")}:00</b> {String(l.venue)}
            <i>{String(l.area ?? "")}</i>
          </div>
        ))}
      </div>
    );
  }

  const vid = String(d.venue_id ?? "");
  const verif = String(d.verification_status ?? "unknown");
  return (
    <button className="gtr-bro-card act" onClick={() => onNavigate("venueCard", vid)}>
      <div className="gtr-bro-card-k">{String(d.venue ?? d.title ?? "")}</div>
      {Boolean(d.title) && card.kind === "event" && <div className="gtr-bro-card-t">{String(d.title)}</div>}
      <div className="gtr-bro-card-m">
        {d.start_at ? <span>{String(d.start_at)}</span> : null}
        {typeof d.distance_km === "number" ? <span>{d.distance_km} км</span> : null}
        <span className={`gtr-bro-verif v-${verif}`}>{VERIF_RU[verif] ?? verif}</span>
      </div>
      {/* Наличие мест и цену мы не знаем — так и пишем, чтобы человек не
          приехал к закрытой двери с нашей уверенностью в кармане. */}
      {d.availability_status === "unknown" && (
        <div className="gtr-bro-card-n">места и цену уточняем у площадки</div>
      )}
    </button>
  );
}
