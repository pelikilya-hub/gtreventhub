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
import { Stk, type StkName } from "../ui";
import { GAIN_MAX, GAIN_MIN, loadGain, routeAudio } from "./audio-out";
import {
  EGG_RE,
  EGG_REPLY,
  EMPTY_LINE,
  fmtDetails,
  fmtEvents,
  fmtRoute,
  fmtVenues,
  greetLines,
  HELP_LINES,
  HELP_TEAM_LINES,
  openerFor,
  planOf,
  fmtForecast,
  fmtPull,
} from "./text";
import { VOICE_LAB_LINES, type PersonaMode } from "./prompt.ru";
import { chatStale, touchChat } from "./chat-life";
import { isTeam } from "./roles";
import { safetyOf } from "./safety";
import { BroSmoke } from "./smoke";
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

/** Быстрые команды под табло: то, ради чего человек и открыл BRO.
 *  Значки — из фирменного пака, а не системные эмодзи: системные на
 *  каждом телефоне свои и рядом с нашей типографикой смотрятся чужими. */
// Быстрые команды разведены по контурам. Гость пришёл за движем, музыкой
// и артистами; команда за столом — за цифрами. Один и тот же ряд кнопок
// для обоих был бы враньём в обе стороны.
// tile — фирменный арт плитки от BOSS: подпись и рамка уже в картинке,
// поэтому такой плитке не рисуем ни скобок, ни текста. Команды без арта
// живут на стикерах, пока не приедет их картинка.
type Quick = { icon: StkName; t: string; q: string; tile?: string };

const QUICK_GUEST: Quick[] = [
  { icon: "champagne", t: "Пожрать", q: "столы в кафе дель мар" },
  { icon: "disco", t: "Нажраться", q: "что сегодня" },
  { icon: "palm", t: "Клубы рядом", q: "какие клубы в патонге" },
  { icon: "pin", t: "Маршрут", q: "маршрут" },
  { icon: "headphones", t: "Артисты", q: "открой артисты" },
  { icon: "vinyl", t: "Про стили", q: "что такое техно" },
  { icon: "door", t: "Такси", q: "вызови такси" },
  { icon: "star", t: "Что умею", q: "что ты умеешь" },
];

const QUICK_TEAM: Quick[] = [
  { icon: "hundred", t: "Прогноз явки", q: "прогноз illuzion", tile: "/bro/forecast.webp" },
  { icon: "equalizer", t: "Тяга артиста", q: "тяга lutang", tile: "/bro/pull.webp" },
  { icon: "calendar", t: "Афиша", q: "что сегодня", tile: "/bro/afisha.webp" },
  { icon: "map", t: "База площадок", q: "какие клубы в патонге", tile: "/bro/venues.webp" },
  { icon: "fader", t: "Экономика", q: "как считать юнит-экономику вечера", tile: "/bro/econ.webp" },
  { icon: "rocket", t: "Промо", q: "какие каналы промо работают на пхукете", tile: "/bro/promo.webp" },
  { icon: "mic", t: "Артисты", q: "открой артисты", tile: "/bro/artists.webp" },
  { icon: "star", t: "Что умею", q: "что ты умеешь", tile: "/bro/skills.webp" },
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
  userName,
  role,
  provider = "gemini",
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  screen?: string;
  district?: string;
  boss?: boolean;
  /** Имя из профиля: BRO зовёт человека по имени с первой секунды. */
  userName?: string;
  role?: string;
  provider?: VoiceProvider;
  onNavigate: (route: string, entityId?: string) => void;
}) {
  const [state, setState] = useState<BroState>("idle");
  const [detail, setDetail] = useState<string>();
  const [level, setLevel] = useState(0);
  // Табло: расшифровка разговора и служебные строки в одном потоке,
  // как лог терминала. Незавершённые реплики печатаются по мере
  // произнесения.
  type Row = { who: "user" | "bro" | "sys"; text: string; done: boolean; wait?: boolean };
  const [rows, setRows] = useState<Row[]>([]);
  const dosRef = useRef<HTMLDivElement | null>(null);
  const [cmd, setCmd] = useState("");
  // Вид разговора. По умолчанию чат: служебные строки — это отладка, а не
  // общение, и человеку в клубе они мешают читать ответ.
  const [chatView, setChatView] = useState<boolean>(() => {
    try {
      return localStorage.getItem("gtr.bro.view") !== "dos";
    } catch {
      return true;
    }
  });
  // Последняя выдача поиска — для «детали N» и «маршрут».
  const lastEvents = useRef<Record<string, unknown>[]>([]);
  const [cards, setCards] = useState<BroCard[]>([]);
  const [mode, setMode] = useState<PersonaMode>("bro");
  const VOICES = VOICE_SETS[provider];
  const [voice, setVoice] = useState<string>(VOICES[0][0]);
  const [muted, setMuted] = useState(false);
  // Громкость голоса. В клубе штатного уровня не хватает, а на iPhone
  // звук вдобавок уходит в разговорный динамик — держим свой усилитель.
  const [gain, setGain] = useState(() => loadGain());
  // Держим последнее значение в ref: begin() не должен пересобираться
  // при каждом повороте ручки громкости.
  const gainRef = useRef(gain);
  gainRef.current = gain;
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
  // Визитка — один раз на открытие оверлея: на табло текстом, голосом — репликой.
  const hello = useRef(false);
  const greeted = useRef(false);
  // Куски расшифровки прилетают десятки раз в секунду, и рендер всего
  // оверлея на каждую букву дерётся за телефон с WebRTC-звуком — голос
  // начинает заикаться и запаздывать. Копим буквы в буфере и печатаем
  // на доску пачками, несколько раз в секунду: глазу разницы нет,
  // процессору — есть.
  const partBuf = useRef<{ user: string; bro: string }>({ user: "", bro: "" });
  const partTimer = useRef(0);
  const metric = useMetrics();

  // Новое значение уходит в живой разговор сразу, без перезапуска.
  useEffect(() => {
    ses.current?.setGain(gain);
  }, [gain]);

  const reset = () => {
    setCards([]);
    setLevel(0);
    setDetail(undefined);
    clearTimeout(partTimer.current);
    partTimer.current = 0;
    partBuf.current = { user: "", bro: "" };
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
          // Голос знакомится сам: канал открылся — BRO говорит визитку
          // по имени, не дожидаясь, пока человек догадается что-то сказать.
          // Один раз за открытие оверлея, и только если человек не начал
          // говорить первым (палец на рации = у него уже есть вопрос).
          if (st === "listening" && !hello.current && !held.current) {
            hello.current = true;
            metric("bro.greet.voice");
            ses.current?.say(
              `Начни разговор визиткой по правилу «First reply». Имя человека: ${userName ?? "не указано"}.`,
            );
          }
        },
        onLevel: setLevel,
        onLog: (t) =>
          setRows((p) => [...p.slice(-60), { who: "sys" as const, text: t, done: true }]),
        onPartial: (who, delta) => {
          partBuf.current[who] += delta;
          if (partTimer.current) return;
          partTimer.current = window.setTimeout(() => {
            partTimer.current = 0;
            const buf = partBuf.current;
            partBuf.current = { user: "", bro: "" };
            setRows((p) => {
              let next = p;
              for (const w of ["user", "bro"] as const) {
                const chunk = buf[w];
                if (!chunk) continue;
                const last = next[next.length - 1];
                if (last && last.who === w && !last.done)
                  next = [...next.slice(0, -1), { ...last, text: last.text + chunk }];
                else next = [...next.slice(-60), { who: w, text: chunk, done: false }];
              }
              return next;
            });
          }, 130);
        },
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
            return [...p.slice(-60), { who: l.who, text: l.text, done: true }];
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
        s.setGain(gainRef.current);
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
    if (!open) {
      // Отмечаем момент выхода: три минуты считаются от него, а не от
      // последней реплики BRO.
      touchChat();
      hello.current = false;
      greeted.current = false;
    }
  }, [open, stop]);
  useEffect(() => () => ses.current?.stop("unmount"), []);

  // Табло всегда прокручено к последней строке — как настоящий терминал.
  useEffect(() => {
    const el = dosRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  // Визитка. Первое открытие за сеанс — BRO представляется по имени и
  // перечисляет, что реально умеет. Строки выпадают по одной: табло
  // должно ожить, а не выплюнуть простыню разом.
  useEffect(() => {
    if (!open || greeted.current) return;
    greeted.current = true;
    // Свежий разговор — просто продолжаем: ни чистки, ни повторной
    // визитки. Человек вышел на минуту, а не начал заново.
    const stale = chatStale();
    touchChat();
    if (!stale) return;
    setRows([]);
    setCards([]);
    lastEvents.current = [];
    // Случайный seed: одно и то же приветствие два вечера подряд — верный
    // способ надоесть. Детерминизм остаётся внутри greetLines для тестов.
    const lines = greetLines(userName, role, Math.floor(Math.random() * 1e6));
    const timers: number[] = [];
    lines.forEach((l, i) => {
      timers.push(
        window.setTimeout(() => {
          setRows((p) => [
            ...p.slice(-60),
            { who: l.startsWith("·") || l.startsWith("жми") ? "sys" : "bro", text: l, done: true },
          ]);
        }, 90 + i * 190),
      );
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [open, userName, role]);

  // Пока эфир открыт — фон продукта замирает. Атмосфера, лучи и танцор
  // не видны сквозь размытие скрима, но кадры на телефоне отъедают у
  // того, что действительно работает: микрофона и печати по табло.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("gtr-bro-live");
    return () => document.body.classList.remove("gtr-bro-live");
  }, [open]);

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

  const say = (who: Row["who"], text: string) => {
    touchChat();
    setRows((p) => [...p.filter((r) => !r.wait).slice(-60), { who, text, done: true }]);
  };

  // «Думаю» — это состояние, а не реплика: строка живёт, пока идёт
  // запрос, и исчезает вместе с ответом. Иначе в ленте копятся следы
  // ожидания, и разговор читается как лог отладки.
  const waitOn = (text: string) => {
    touchChat();
    setRows((p) => [...p.filter((r) => !r.wait).slice(-60), { who: "sys", text, done: false, wait: true }]);
  };
  const waitOff = () => setRows((p) => (p.some((r) => r.wait) ? p.filter((r) => !r.wait) : p));

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
    // Пасхалка отвечает мгновенно — за таким не ходят в нейросеть.
    if (EGG_RE.test(q)) {
      metric("bro.egg.volk");
      say("bro", EGG_REPLY);
      return;
    }
    // Безопасность идёт первой и не ходит ни в модель, ни в инструменты:
    // ответ обязан быть одинаковым в любую ночь и при любом состоянии
    // провайдера. Скорая не должна ждать, пока ответит чужой сервер.
    const risk = safetyOf(q);
    if (risk) {
      metric(`bro.safety.${risk.kind}`);
      say("bro", risk.reply);
      if (risk.hint) say("bro", risk.hint);
      if (risk.kind === "drunk_drive") {
        const r = await callTool("call_taxi", {});
        if (r.ok) setCards((p2) => [{ kind: "taxi" as const, data: r.data as Record<string, unknown> }, ...p2].slice(0, 6));
      }
      return;
    }

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
        waitOn("думаю…");
        // Полторы минуты ожидания на телефоне неотличимы от зависания.
        // Тридцати секунд хватает живому ответу, а всё что дольше —
        // это уже не разговор, и по правилам мы ответим быстрее.
        const r = await fetch("/api/gtr-bro-text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ text: q, history }),
          signal: AbortSignal.timeout(30_000),
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
        // Любая поломка мозга — наше внутреннее дело. Человек в клубе не
        // должен читать «brain-http 502»: для него это сбой продукта, хотя
        // ниже его вопрос отработают правила по нашей же базе. Причину
        // забираем в счётчики и молча идём дальше.
        if (data.error) metric(`bro.text.fail.${String(data.error).replace(/[^a-z0-9_.-]/gi, "")}`);
        waitOff();
      } catch {
        metric("bro.text.fail.timeout");
        waitOff();
      }
    }

    // База знаний: 50 тем про продукт, остров и заведения. Инструмент сам
    // выбирает вариант, который человек ещё не слышал, — поэтому дважды
    // одну формулировку он не получит. Не нашлось темы — идём в помощь.
    if (plan.kind === "faq") {
      metric("bro.text.faq");
      const r = await callTool("ask_gtr", { question: plan.question });
      if (r.ok) {
        say("bro", String((r.data as Record<string, unknown> | undefined)?.answer ?? ""));
        return;
      }
      say("bro", "Такого в базе знаний нет. Вот что могу прямо сейчас:");
      for (const l of HELP_LINES) say("sys", l);
      return;
    }

    if (plan.kind === "forecast" || plan.kind === "pull") {
      metric(`bro.text.${plan.kind}`);
      say("bro", openerFor(q));
      const r =
        plan.kind === "forecast"
          ? await callTool("forecast_attendance", { venue: plan.venue, date: plan.date })
          : await callTool("artist_pull", { artist: plan.artist });
      if (!r.ok) return say("bro", `Не посчитал: ${String(r.error ?? "")}`);
      const lines =
        plan.kind === "forecast"
          ? fmtForecast(r.data as Record<string, unknown>)
          : fmtPull(r.data as Record<string, unknown>);
      for (const l of lines) say(l.startsWith("  ") ? "sys" : "bro", l);
      return;
    }

    if (plan.kind === "greet") {
      metric("bro.greet.ask");
      const g = greetLines(userName, role, Math.floor(Math.random() * 1e6));
      say("bro", g[0]);
      for (const l of g.slice(1)) say(l.startsWith("·") || l.startsWith("жми") ? "sys" : "bro", l);
      return;
    }

    if (plan.kind === "help" || plan.kind === "unknown") {
      if (plan.kind === "unknown") say("bro", "Не разобрал. Вот что умею без голоса:");
      for (const l of HELP_LINES) say("sys", l);
      if (isTeam(role)) for (const l of HELP_TEAM_LINES) say("sys", l);
      return;
    }

    if (plan.kind === "venues") {
      metric("bro.text.venues");
      say("bro", openerFor(q));
      const r = await callTool("search_venues", {
        district: plan.district,
        kind: plan.kind2,
        limit: 5,
      });
      if (!r.ok) return say("bro", `По базе пусто: ${String(r.error ?? "")}`);
      const venues = (r.data?.venues as Record<string, unknown>[] | undefined) ?? [];
      for (const l of fmtVenues(venues, plan.label)) say(l.startsWith("  ") ? "sys" : "bro", l);
      for (const v of venues.slice(0, 3))
        setCards((p2) => [{ kind: "venue" as const, data: v }, ...p2].slice(0, 6));
      return;
    }

    if (plan.kind === "music") {
      metric("bro.text.music");
      const r = await callTool("open_music", { artist: plan.artist, source: plan.source });
      if (!r.ok)
        return say("bro", `Музыку не нашёл: ${String(r.error ?? "нет в базе GTR")}`);
      const d = (r.data ?? {}) as Record<string, unknown>;
      const primary = (d.open ?? {}) as { label?: string };
      say("bro", `${String(d.artist ?? plan.artist)} — держи. ${String(primary.label ?? "Ссылки ниже")}.`);
      setCards((p2) => [{ kind: "music" as const, data: d }, ...p2].slice(0, 6));
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
      if (!events.length) {
        // Пустой день — не тупик: сразу показываем ближайшее живое,
        // иначе человек решает, что поиск сломан.
        const near = (r.data?.nearest as Record<string, unknown>[] | undefined) ?? [];
        say("bro", EMPTY_LINE);
        if (near.length) {
          say("bro", "Ближайшее по базе:");
          for (const e of near)
            say("sys", `  ${String(e.start_at ?? "")} · ${String(e.venue ?? "")} — ${String(e.title ?? "")}`);
          lastEvents.current = near;
          for (const e of near.slice(0, 3))
            setCards((p2) => [{ kind: "event" as const, data: e }, ...p2].slice(0, 6));
        }
        return;
      }
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
        <BroSmoke />
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

        {/* Разговор. По умолчанию — обычный чат: реплики человека и BRO,
            без служебных строк. Терминал никуда не делся — он честнее
            показывает, что происходит со связью и инструментами, — но
            листать его каждый вечер незачем, и он ушёл под тумблер. */}
        {chatView ? (
          <div className="gtr-bro-chat" ref={dosRef} aria-live="polite">
            {rows.filter((r) => r.who !== "sys").length === 0 ? (
              <div className="gtr-bro-chat-empty">Напиши сообщение или нажми знак ниже</div>
            ) : null}
            {rows
              .filter((r) => r.who !== "sys")
              .map((r, i) => (
                <div key={i} className={`gtr-bro-msg ${r.who}`}>
                  {r.text}
                  {!r.done && <span className="gtr-bro-cursor">▮</span>}
                </div>
              ))}
          </div>
        ) : (
          <div className="gtr-bro-dos" ref={dosRef} aria-live="polite">
            <div className="gtr-bro-dos-h">GTR-BRO/9000 · ЭФИР · {STATE_RU[state]}</div>
            {rows.map((r, i) => (
              <div key={i} className={`gtr-bro-dos-l ${r.who}`}>
                {r.who === "user" ? "> " : r.who === "bro" ? "BRO: " : "· "}
                {r.text}
                {!r.done && <span className="gtr-bro-cursor">▮</span>}
              </div>
            ))}
          </div>
        )}

        {/* Строка ввода живёт отдельно от ленты: в чате она обычное поле
            сообщения, в терминале — приглашение командной строки. */}
        <form
          className={chatView ? "gtr-bro-say" : "gtr-bro-dos-l prompt gtr-bro-cmdrow"}
          onSubmit={(e) => {
            e.preventDefault();
            const q = cmd;
            setCmd("");
            void runText(q);
          }}
        >
          {chatView ? null : <span>C:\GTR&gt;</span>}
          <input
            className={chatView ? "gtr-bro-sayin" : "gtr-bro-cmd"}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder={chatView ? "Напиши сообщение" : "что сегодня в патонге"}
            autoCapitalize={chatView ? "sentences" : "off"}
            autoCorrect={chatView ? "on" : "off"}
            spellCheck={chatView}
            enterKeyHint="send"
            aria-label="Сообщение для BRO"
          />
          {chatView ? (
            <button className="gtr-bro-saygo" type="submit" aria-label="Отправить" disabled={!cmd.trim()}>
              ↑
            </button>
          ) : (
            !cmd && <span className="gtr-bro-cursor">▮</span>
          )}
        </form>

        {/* Тапы вместо набора: человек в клубе не печатает «что сегодня
            в патонге» одной рукой с коктейлем в другой. */}
        <div className="gtr-bro-quick">
          {(isTeam(role) ? QUICK_TEAM : QUICK_GUEST).map((q) =>
            q.tile ? (
              <button
                key={q.t}
                className="gtr-bro-q art"
                onClick={() => void runText(q.q)}
                aria-label={q.t}
              >
                <img src={q.tile} alt="" loading="lazy" draggable={false} />
              </button>
            ) : (
              <button key={q.t} className="gtr-bro-q" onClick={() => void runText(q.q)}>
                <Stk name={q.icon} size={30} x2 />
                <span>{q.t}</span>
              </button>
            ),
          )}
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
            <img src="/bro/ptt.webp" alt="" aria-hidden draggable={false} />
          </button>
          <div
            className="gtr-bro-hint"
            style={
              (ptt && !live && !busy) ? { visibility: "hidden" } : undefined
            }
          >
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
              <BroCardView key={i} card={c} onNavigate={onNavigate} onSay={say} />
            ))}
          </div>
        )}

        {/* Пульт — фирменные плашки BOSS. Состояние читается обработкой
            самой плашки: выключенный микрофон гаснет в серый, активное
            Табло горит красным, Стоп вне эфира тускнеет. */}
        <div className="gtr-bro-bar">
          <button
            className={`gtr-bro-bbtn${muted ? " off" : ""}`}
            disabled={!live}
            aria-label={muted ? "Микрофон выключен — включить" : "Микрофон включён — выключить"}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              ses.current?.mute(next);
            }}
          >
            <img src="/bro/btn-mic.webp" alt="" draggable={false} />
          </button>
          <button
            className={`gtr-bro-bbtn${chatView ? "" : " on"}`}
            aria-label={chatView ? "Открыть табло" : "Вернуться в чат"}
            onClick={() => {
              const next = !chatView;
              setChatView(next);
              try {
                localStorage.setItem("gtr.bro.view", next ? "chat" : "dos");
              } catch {
                // приватный режим: выбор просто не переживёт перезагрузку
              }
            }}
          >
            <img src="/bro/btn-tablo.webp" alt="" draggable={false} />
          </button>
          <button
            className={`gtr-bro-bbtn${tune ? " on" : ""}`}
            aria-label="Настройки"
            onClick={() => setTune((v) => !v)}
          >
            <img src="/bro/btn-tune.webp" alt="" draggable={false} />
          </button>
          <button className="gtr-bro-bbtn" disabled={!live} aria-label="Стоп" onClick={stop}>
            <img src="/bro/btn-stop.webp" alt="" draggable={false} />
          </button>
        </div>

        <div className="gtr-bro-sys">GTR SYSTEM v1.0</div>

        {tune && (
          <div className="gtr-bro-tune">
            <div className="gtr-bro-tune-t">Громкость голоса</div>
            <div className="gtr-bro-chips">
              {([1, 2, 3, 4, 6] as const).map((g) => (
                <button
                  key={g}
                  className={`gtr-bro-chip${Math.round(gain) === g ? " on" : ""}`}
                  onClick={() => {
                    setGain(g);
                    // Заодно возвращаем звук на громкий динамик: iOS мог
                    // увести его к уху, пока держали микрофон.
                    routeAudio("playback");
                    metric("bro.gain." + g);
                  }}
                >
                  {g === GAIN_MIN ? "как есть" : g === GAIN_MAX ? "макс" : `×${g}`}
                  <i>{g === GAIN_MAX ? "для клуба" : g >= 3 ? "громко" : "тихо"}</i>
                </button>
              ))}
            </div>
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
  onSay,
}: {
  card: BroCard;
  onNavigate: (route: string, entityId?: string) => void;
  onSay?: (who: "bro" | "sys", text: string) => void;
}) {
  const d = card.data as Record<string, unknown>;

  if (card.kind === "taxi") {
    // Заказ подтверждает сам человек в приложении такси — здесь только
    // маршрут с уже поставленной точкой.
    return (
      <div className="gtr-bro-card">
        <div className="gtr-bro-card-k">Такси → {String(d.venue ?? "")}</div>
        <div className="gtr-bro-card-n">{String(d.area ?? "")} · точка назначения уже в ссылке</div>
        <div className="gtr-bro-taxirow">
          <a className="gtr-bro-btn go" href={String(d.grab ?? "#")} target="_blank" rel="noreferrer">Grab</a>
          <a className="gtr-bro-btn go" href={String(d.bolt ?? "#")} target="_blank" rel="noreferrer">Bolt</a>
          <a className="gtr-bro-btn" href={String(d.maps ?? "#")} target="_blank" rel="noreferrer">Карта</a>
        </div>
      </div>
    );
  }

  if (card.kind === "music") {
    // Музыка открывается наружу: в приложении её нет, и подменять сет
    // экраном платформы — ровно тот баг, из-за которого «включи сеты»
    // приводил человека в список заведений.
    const links = Array.isArray(d.links)
      ? (d.links as { source: string; label: string; url: string }[])
      : [];
    const listen = (d.listen ?? null) as Record<string, string | null> | null;
    const rows = links.length
      ? links
      : listen
        ? ([
            ["youtube", "Сеты и клипы на YouTube", listen.youtube],
            ["spotify", "Треки в Spotify", listen.spotify],
            ["soundcloud", "Микстейпы на SoundCloud", listen.soundcloud],
          ] as [string, string, string | null][])
            .filter(([, , url]) => Boolean(url))
            .map(([source, label, url]) => ({ source, label, url: String(url) }))
        : [];
    if (!rows.length) return null;
    const who = String(d.artist ?? d.name ?? "");
    return (
      <div className="gtr-bro-card">
        <div className="gtr-bro-card-k">Слушать · {who}</div>
        {d.role ? <div className="gtr-bro-card-n">{String(d.role)}</div> : null}
        <div className="gtr-bro-taxirow">
          {rows.slice(0, 3).map((l) => (
            <a
              key={l.source}
              className={`gtr-bro-btn${l.source === "youtube" ? " go" : ""}`}
              href={l.url}
              target="_blank"
              rel="noreferrer"
            >
              {l.source === "youtube" ? "YouTube" : l.source === "spotify" ? "Spotify" : "SoundCloud"}
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (card.kind === "confirm") {
    // Единственная дверь для пишущих действий из текстовой петли.
    return (
      <div className="gtr-bro-card">
        <div className="gtr-bro-card-k">Подтверди действие</div>
        <div className="gtr-bro-card-t">{String(d.summary ?? "")}</div>
        <div className="gtr-bro-card-n">{JSON.stringify(d.args ?? {}).slice(0, 140)}</div>
        <div className="gtr-bro-taxirow">
          <button
            className="gtr-bro-btn go"
            onClick={() => {
              void (async () => {
                try {
                  const r = await fetch("/api/gtr-bro-tool", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    credentials: "same-origin",
                    body: JSON.stringify({ name: d.name, args: d.args ?? {}, callId: "confirm" }),
                    signal: AbortSignal.timeout(15_000),
                  });
                  const data = (await r.json()) as { result?: { ok?: boolean; data?: { note?: string }; error?: string } };
                  const res = data.result;
                  onSay?.(
                    "bro",
                    res?.ok
                      ? (res.data?.note ?? "Сделано.")
                      : `Не вышло: ${res?.error ?? "ошибка"}`,
                  );
                } catch {
                  onSay?.("sys", "подтверждение не дошло до сервера");
                }
              })();
            }}
          >
            Да, делаем
          </button>
          <button className="gtr-bro-btn" onClick={() => onSay?.("sys", "действие отменено")}>
            Отмена
          </button>
        </div>
      </div>
    );
  }

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
      <div className="gtr-bro-card-k">{String(d.venue ?? d.name ?? d.title ?? "")}</div>
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
