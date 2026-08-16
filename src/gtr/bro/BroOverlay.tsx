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
import { EMPTY_LINE, fmtDetails, fmtEvents, fmtRoute, HELP_LINES, openerFor, planOf } from "./text";
import { VOICE_LAB_LINES, type PersonaMode } from "./prompt.ru";
import { GemSession } from "./gem";
import { BroSession, type BroCard, type BroState } from "./session";

type VoiceSession = BroSession | GemSession;
type VoiceProvider = "openai" | "gemini";

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

// Наборы голосов по провайдерам. Первый в списке — голос по умолчанию.
const VOICE_SETS: Record<VoiceProvider, [string, string][]> = {
  gemini: [
    ["Charon", "Харон · низкий"],
    ["Fenrir", "Фенрир · жёсткий"],
    ["Puck", "Пак · живой"],
  ],
  openai: [
    ["cedar", "Cedar"],
    ["marin", "Marin"],
    ["ash", "Ash"],
  ],
};

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
  provider = "gemini",
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  screen?: string;
  district?: string;
  boss?: boolean;
  provider?: VoiceProvider;
  onNavigate: (route: string, entityId?: string) => void;
}) {
  const [state, setState] = useState<BroState>("idle");
  const [detail, setDetail] = useState<string>();
  const [level, setLevel] = useState(0);
  // Табло: расшифровка разговора и служебные строки в одном потоке,
  // как лог терминала. Незавершённые реплики печатаются по мере
  // произнесения.
  type Row = { who: "user" | "bro" | "sys"; text: string; done: boolean };
  const [rows, setRows] = useState<Row[]>([]);
  const dosRef = useRef<HTMLDivElement | null>(null);
  const [cmd, setCmd] = useState("");
  // Последняя выдача поиска — для «детали N» и «маршрут».
  const lastEvents = useRef<Record<string, unknown>[]>([]);
  const [cards, setCards] = useState<BroCard[]>([]);
  const [mode, setMode] = useState<PersonaMode>("bro");
  const VOICES = VOICE_SETS[provider];
  const [voice, setVoice] = useState<string>(VOICES[0][0]);
  const [muted, setMuted] = useState(false);
  const [tune, setTune] = useState(false);
  // Рация по умолчанию: в клубе авто-детектор речи слышит толпу, а не
  // человека. Свободный разговор остаётся выбором в настройках.
  const [hands, setHands] = useState(false);
  const [holding, setHolding] = useState(false);
  const held = useRef(false);
  const [lab, setLab] = useState(false);
  const [ask, setAsk] = useState<{ tool: string; summary: string; resolve: (v: boolean) => void } | null>(
    null,
  );
  // Мини-режим: разговор жив, оверлей сложен в таблетку поверх приложения.
  // Микрофон при этом ВИДЕН — скрытой записи в продукте нет.
  const [mini, setMini] = useState(false);
  const ses = useRef<VoiceSession | null>(null);
  const starting = useRef(false);
  const metric = useMetrics();

  const reset = () => {
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
    async (v: string, m: PersonaMode) => {
      // Два быстрых нажатия рождали две параллельные сессии — двойной
      // звук и двойной счёт. Вторая попытка ждёт, пока первая не решится.
      if (starting.current) return;
      starting.current = true;
      ses.current?.stop("restart");
      reset();
      const S = provider === "gemini" ? GemSession : BroSession;
      const s = new S({
        onState: (st, d) => {
          setState(st);
          setDetail(d);
          // Соединение поднялось, а палец всё ещё на кнопке — открываем
          // микрофон сразу, без второго нажатия.
          if (st === "listening" && held.current && ses.current?.isPtt) ses.current.holdStart();
        },
        onLevel: setLevel,
        onLog: (t) =>
          setRows((p) => [...p.slice(-120), { who: "sys" as const, text: t, done: true }]),
        onPartial: (who, delta) =>
          setRows((p) => {
            const last = p[p.length - 1];
            if (last && last.who === who && !last.done)
              return [...p.slice(0, -1), { ...last, text: last.text + delta }];
            return [...p.slice(-120), { who, text: delta, done: false }];
          }),
        onLine: (l) =>
          setRows((p) => {
            // Финал заменяет НЕДОПЕЧАТАННУЮ строку того же автора, где бы
            // она ни стояла: реплики двух сторон перемежаются, и «последняя
            // строка» — не всегда та.
            for (let i = p.length - 1; i >= 0; i--) {
              if (p[i].who === l.who && !p[i].done) {
                const next = [...p];
                next[i] = { who: l.who, text: l.text, done: true };
                return next.slice(-120);
              }
            }
            return [...p.slice(-120), { who: l.who, text: l.text, done: true }];
          }),
        onCard: (c) => {
          if (c.kind === "navigate") {
            // Навигация больше не убивает разговор: приложение открывает
            // экран, а BRO складывается в таблетку и продолжает слушать.
            onNavigate(String(c.data.route), c.data.entityId);
            setMini(true);
            return;
          }
          setCards((p) => [c, ...p].slice(0, 6));
        },
        onMetric: metric,
        onConfirm: (a) => new Promise<boolean>((resolve) => setAsk({ ...a, resolve })),
      });
      ses.current = s;
      try {
        await s.start({ voice: v, personaMode: m, screen, district, ptt: !handsRef.current });
      } finally {
        starting.current = false;
      }
    },
    [district, metric, onNavigate, provider, screen],
  );
  // Актуальный режим для begin() без пересоздания колбэка.
  const handsRef = useRef(hands);
  handsRef.current = hands;

  // Закрытие оверлея всегда рвёт соединение: забытая в фоне сессия — это
  // открытый микрофон и счёт по времени.
  useEffect(() => {
    if (!open && ses.current) stop();
  }, [open, stop]);
  useEffect(() => () => ses.current?.stop("unmount"), []);

  // Табло всегда прокручено к последней строке — как настоящий терминал.
  useEffect(() => {
    const el = dosRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;

  if (mini) {
    const liveMini = ses.current !== null && !["closed", "idle", "error"].includes(state);
    return (
      <div className="gtr-bro-pill-wrap">
        <button className="gtr-bro-pill" onClick={() => setMini(false)} aria-label="Развернуть BRO">
          <span
            className={`gtr-bro-pill-dot${liveMini ? " on" : ""}`}
            style={{ transform: `scale(${0.8 + level * 1.2})` }}
          />
          <span className="gtr-bro-pill-t">BRO · {STATE_RU[state]}</span>
        </button>
        <button
          className="gtr-bro-pill-x"
          aria-label="Завершить разговор"
          onClick={() => {
            stop();
            setMini(false);
            onClose();
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  const live = ses.current !== null && state !== "closed" && state !== "idle" && state !== "error";
  const busy = state === "connecting" || state === "requesting_permission";
  const ptt = !hands;

  // Рация: держишь — говоришь. Отпустил где угодно — реплика ушла.
  const pttDown = (e: { preventDefault: () => void }) => {
    if (!ptt) return;
    e.preventDefault();
    held.current = true;
    setHolding(true);
    if (!live && !busy) void begin(voice, mode);
    else ses.current?.holdStart();
  };
  const pttUp = () => {
    if (!ptt || !held.current) return;
    held.current = false;
    setHolding(false);
    if (live) ses.current?.holdEnd();
  };
  const err = state === "error" ? (ERROR_RU[detail ?? ""] ?? "Не получилось. Попробуй ещё раз.") : null;

  const say = (who: Row["who"], text: string) =>
    setRows((p) => [...p.slice(-120), { who, text, done: true }]);

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const r = await fetch("/api/gtr-bro-tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name, args, callId: "text" }),
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await r.json()) as { result?: { ok?: boolean; data?: Record<string, unknown>; error?: string } };
    return data.result ?? { ok: false as const, error: `HTTP ${r.status}` };
  };

  // Текстовый режим: без нейросети вовсе. Разбор команды — правила,
  // факты — только из инструментов. Работает, даже когда у голосового
  // провайдера кончились деньги, и не может выдумать событие.
  const runText = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    metric("bro.text.cmd");
    say("user", q);
    const plan = planOf(q);

    // Живые фразы сначала идут в самохостный мозг (Qwen на сервере GTR).
    // Мозг не настроен или упал — молча откатываемся на разбор правилами:
    // деградация, а не отказ.
    if (plan.kind === "search" || plan.kind === "unknown") {
      const history = rows
        .filter((r) => r.who !== "sys" && r.done)
        .slice(-6)
        .map((r) => ({ who: r.who, text: r.text }));
      try {
        say("sys", "думаю…");
        const r = await fetch("/api/gtr-bro-text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ text: q, history }),
          signal: AbortSignal.timeout(95_000),
        });
        const data = (await r.json()) as { ok?: boolean; reply?: string; cards?: BroCard[]; error?: string };
        if (data.ok && data.reply) {
          metric("bro.text.brain");
          say("bro", data.reply);
          const evs = (data.cards ?? []).filter((c) => c.kind === "event");
          if (evs.length) lastEvents.current = evs.map((c) => c.data as Record<string, unknown>);
          for (const c of (data.cards ?? []).slice(0, 4)) setCards((p) => [c, ...p].slice(0, 6));
          return;
        }
        if (data.error && data.error !== "no-brain") say("sys", `мозг: ${data.error}`);
      } catch {
        say("sys", "мозг не ответил — работаю по правилам");
      }
    }

    if (plan.kind === "help" || plan.kind === "unknown") {
      if (plan.kind === "unknown") say("bro", "Не разобрал. Вот что умею без голоса:");
      for (const l of HELP_LINES) say("sys", l);
      return;
    }

    if (plan.kind === "open") {
      say("bro", "Открываю.");
      onNavigate(plan.route);
      return;
    }

    if (plan.kind === "search") {
      say("bro", openerFor(q));
      const r = await callTool("search_events", {
        dateFrom: plan.dateFrom,
        dateTo: plan.dateTo,
        district: plan.district,
        limit: 5,
      });
      if (!r.ok) return say("bro", `Афиша не ответила: ${String(r.error ?? "")}`);
      const events = (r.data?.events as Record<string, unknown>[] | undefined) ?? [];
      if (!events.length) return say("bro", EMPTY_LINE);
      lastEvents.current = events;
      for (const l of fmtEvents(events, plan.label)) say(l.startsWith("  ") ? "sys" : "bro", l);
      for (const ev of events.slice(0, 3)) setCards((p) => [{ kind: "event" as const, data: ev }, ...p].slice(0, 6));
      return;
    }

    if (plan.kind === "details") {
      const ev = lastEvents.current[plan.index - 1];
      if (!ev) return say("bro", "Такого номера в последней выдаче нет. Сначала спроси события.");
      const r = await callTool("get_event_details", { eventId: String(ev.event_id ?? "") });
      if (!r.ok || !r.data) return say("bro", "Деталей не достал.");
      for (const l of fmtDetails(r.data)) say(l.startsWith("  ") ? "sys" : "bro", l);
      return;
    }

    if (plan.kind === "route") {
      const vids = [...new Set(lastEvents.current.map((e) => String(e.venue_id ?? "")))].filter(Boolean).slice(0, 3);
      if (!vids.length) return say("bro", "Маршрут строю из последней выдачи — сначала спроси события.");
      const r = await callTool("build_night_route", { stops: vids, startHour: 20 });
      if (!r.ok || !r.data) return say("bro", "Маршрут не собрался.");
      const legs = (r.data.legs as Record<string, unknown>[] | undefined) ?? [];
      for (const l of fmtRoute(legs)) say(l.startsWith("  ") ? "sys" : "bro", l);
      setCards((p) => [{ kind: "route" as const, data: r.data as Record<string, unknown> }, ...p].slice(0, 6));
    }
  };

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
          <span className={`gtr-bro-state s-${state}`}>
            {STATE_RU[state]}
            {state === "closed" && detail ? ` · ${detail}` : ""}
          </span>
          <button className="gtr-bro-x" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        {/* Табло: что услышал, что ответил, что случилось со связью.
            Стиль старого терминала — это не украшение, а честность:
            каждая строка лога видна, ошибки не прячутся. */}
        <div className="gtr-bro-dos" ref={dosRef} aria-live="polite">
          <div className="gtr-bro-dos-h">GTR-BRO/9000 · ЭФИР · {STATE_RU[state]}</div>
          {rows.map((r, i) => (
            <div key={i} className={`gtr-bro-dos-l ${r.who}`}>
              {r.who === "user" ? "> " : r.who === "bro" ? "BRO: " : "· "}
              {r.text}
              {!r.done && <span className="gtr-bro-cursor">▮</span>}
            </div>
          ))}
          <form
            className="gtr-bro-dos-l prompt gtr-bro-cmdrow"
            onSubmit={(e) => {
              e.preventDefault();
              const q = cmd;
              setCmd("");
              void runText(q);
            }}
          >
            C:\GTR&gt;
            <input
              className="gtr-bro-cmd"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder="что сегодня в патонге"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-label="Команда BRO"
            />
            {!cmd && <span className="gtr-bro-cursor">▮</span>}
          </form>
        </div>

        {/* Визуализатор: единственная деталь, которая честно показывает,
            что микрофон открыт. Пока он живой — тебя слышат. */}
        <div className="gtr-bro-orb-wrap">
          <button
            className={`gtr-bro-orb${live ? " on" : ""}${busy ? " busy" : ""}${ptt && holding ? " hold" : ""}`}
            style={{ ["--gtr-bro-lvl" as string]: String(0.6 + level * 0.75), touchAction: "none" }}
            onPointerDown={ptt ? pttDown : undefined}
            onPointerUp={ptt ? pttUp : undefined}
            onPointerLeave={ptt ? pttUp : undefined}
            onPointerCancel={ptt ? pttUp : undefined}
            onContextMenu={(e) => e.preventDefault()}
            onClick={ptt ? undefined : () => (live ? stop() : void begin(voice, mode))}
            aria-label={ptt ? "Зажми и говори" : live ? "Остановить" : "Начать разговор"}
          >
            <img src="/raw-pulse/handle-logo.webp" alt="" aria-hidden draggable={false} />
          </button>
          <div className="gtr-bro-hint">
            {ptt
              ? live
                ? holding
                  ? "говори — отпусти, и отвечу"
                  : state === "speaking"
                    ? "зажми, чтобы перебить"
                    : state === "thinking"
                      ? "думаю"
                      : "зажми и говори"
                : busy
                  ? "секунду"
                  : "зажми и говори"
              : live
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
            <div className="gtr-bro-tune-t">Управление</div>
            <div className="gtr-bro-chips">
              {[
                [false, "Рация", "держишь — говоришь"],
                [true, "Свободно", "он слышит сам"],
              ].map(([v, name, note]) => (
                <button
                  key={String(v)}
                  className={`gtr-bro-chip${hands === v ? " on" : ""}`}
                  onClick={() => {
                    setHands(v as boolean);
                    metric(v ? "bro.ctl.hands" : "bro.ctl.ptt");
                    if (live) {
                      handsRef.current = v as boolean;
                      void begin(voice, mode);
                    }
                  }}
                >
                  {name as string}
                  <i>{note as string}</i>
                </button>
              ))}
            </div>

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
