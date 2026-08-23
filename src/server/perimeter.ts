// Периметр и кроны воркера — внутри nitro-приложения, а не в обёртке.
//
// Раньше это жило в cron.mjs, который доклеивался скриптом после сборки.
// Автодеплой Cloudflare Builds собирает без пост-скриптов, и 18.08.2026
// прод уехал без периметра, кронов и KV. Теперь вход в приложение один —
// nitro index.mjs — и этот плагин часть сборки при любом пути деплоя.
import { HTTPError } from "h3";
import { definePlugin } from "nitro";

// Краулеры ИИ и скрейперы представляются честно — по User-Agent. Это не
// защита от целенаправленного копирования (агент подделает заголовок),
// но она снимает поток промышленного сбора данных и, вместе с robots.txt,
// фиксирует заявленную волю правообладателя.
const BOTS =
  /(GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Applebot-Extended|Bytespider|CCBot|Amazonbot|meta-externalagent|cohere-ai|Diffbot|omgili|Timpibot|ImagesiftBot|DataForSeoBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|scrapy|python-requests|python-urllib|Go-http-client|node-fetch|axios|libwww-perl|HTTrack|Wget|curl)/i;

const BOTS_REPLY =
  "GTR Event: автоматический сбор данных запрещён. Каталог площадок и артистов, база знаний и логика продукта защищены авторским правом. По вопросам доступа: pelikilya@gmail.com";

// Заголовки безопасности на каждый ответ. Главное здесь — frame-ancestors:
// без него чужой сайт может встроить продукт в iframe и выдать за свой.
const SECURITY: Record<string, string> = {
  "content-security-policy": "frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "interest-cohort=(), browsing-topics=()",
  "x-robots-tag": "noai, noimageai",
};

// Тот же ключ, что отдаёт afishaKey() в src/gtr/afisha.ts: кроны зовут
// собственные ручки под ним.
const deriveKey = async (secret: string | undefined) => {
  const base = secret || "gtr-dev";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`afisha:${base}`),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
};

// Расписание → ручка. Кроны объявлены в wrangler.jsonc в корне репозитория.
const CRON_ROUTES: Record<string, string> = {
  "0 13 * * *": "/api/sprint-report", // 20:00 Пхукета — вечерний отчёт спринта
  "0 2 * * *": "/api/villa-check", // 09:00 Пхукета — сверка цен вилл Private
  "0 10 * * *": "/api/community-digest", // 17:00 Пхукета — дайджест вечера
  "0 4 * * *": "/api/bro-learn", // 11:00 Пхукета — BRO учит новые темы
  "*/15 * * * *": "/api/brain-watch", // сторож мозга BOSS: тихий отказ не должен жить сутками
};

type ScheduledPayload = {
  controller: { cron?: string };
  env: Record<string, unknown>;
  context: { waitUntil: (p: Promise<unknown>) => void };
};

export default definePlugin((nitroApp) => {
  // ---- Периметр: отсечь ботов, надеть заголовки безопасности ------------
  // Оборачиваем h3 onRequest: синхронный throw отсюда становится ответом
  // ошибки, до маршрутизации дело не доходит. Хук nitro "request" не
  // годится — брошенное в нём глотает captureError, и запрос идёт дальше.
  const h3 = (
    nitroApp as unknown as {
      h3: { config: { onRequest?: (event: unknown) => unknown } };
    }
  ).h3;
  const prevOnRequest = h3.config.onRequest;
  h3.config.onRequest = (event) => {
    const req = (event as { req: Request }).req;
    const ua = req.headers.get("user-agent") || "";
    if (BOTS.test(ua)) throw new HTTPError({ status: 403, message: BOTS_REPLY });
    return prevOnRequest?.(event);
  };
  // Хук response видит готовый Response — заголовки здесь ещё мутабельны.
  nitroApp.hooks.hook("response", (res) => {
    try {
      for (const [k, v] of Object.entries(SECURITY)) res.headers.set(k, v);
    } catch {
      /* immutable-ответ (редкий проксированный случай) остаётся как есть */
    }
  });

  // ---- Кроны: зовём собственные ручки в процессе, без сети --------------
  // Раньше крон ходил на свой публичный адрес по HTTP: лишний контур, где
  // молча отваливается и ключ, и сам запрос. nitroApp.fetch — тот же
  // обработчик, но в процессе: ни DNS, ни TLS, ни самообращения.
  nitroApp.hooks.hook(
    // Хук объявляет cloudflare-пресет nitro; в типах ядра его нет.
    "cloudflare:scheduled" as never,
    (async ({ controller, env }: ScheduledPayload) => {
      const key = await deriveKey(env.GTR_SESSION_SECRET as string | undefined);
      const base = "https://gtr-event-hub.gtr-event.workers.dev";
      const route = CRON_ROUTES[controller.cron ?? ""];
      if (route) {
        await nitroApp.fetch(new Request(`${base}${route}?key=${key}`));
        return;
      }
      // Остальные расписания — сбор афиш. Исход прогона фиксируем в KV,
      // чтобы разбор «почему не синхронизировалось» занимал минуту.
      //
      // Заодно здесь же проверяем мозг. Сторож живёт на собственном
      // расписании в 15 минут, но собственное расписание — это ещё одна
      // вещь, которая может не зарегистрироваться при выкате, и тогда
      // молчание сторожа неотличимо от здоровья. Прицеп к давно
      // работающему крону даёт худший интервал (два часа вместо
      // пятнадцати минут) и гарантию, что отказ не проживёт неделю.
      // Проверка идемпотентна: два вызова подряд не поднимут две тревоги.
      const started = Date.now();
      let status = 0;
      let body = "";
      try {
        const res = await nitroApp.fetch(
          new Request(`${base}/api/afisha`, { headers: { "x-afisha-key": key } }),
        );
        status = res.status;
        body = (await res.text()).slice(0, 500);
      } catch (e) {
        body = "throw: " + String(e instanceof Error ? e.message : e);
      }
      try {
        const kv = env.GTR_KV as
          | { put: (k: string, v: string) => Promise<void> }
          | undefined;
        await kv?.put(
          "afisha:lastrun",
          JSON.stringify({ at: started, ms: Date.now() - started, status, body }),
        );
      } catch {
        /* журнал не важнее прогона */
      }
      try {
        await nitroApp.fetch(new Request(`${base}/api/brain-watch?key=${key}`));
      } catch {
        /* сторож не важнее прогона афиш */
      }
      // Разбор афиши моделью: медленный слой по площадкам, где ручек
      // нет. Отдельным вызовом, чтобы затупивший сайт не тянул за собой
      // сбор по рабочим источникам, и после него — он не срочный.
      try {
        await nitroApp.fetch(new Request(`${base}/api/afisha-llm?key=${key}`));
      } catch {
        /* разбор моделью не важнее прогона афиш */
      }
      // Дымовая проверка идёт последней и по той же причине прицеплена
      // сюда: собственное расписание — ещё одна вещь, которая может не
      // подняться, и тогда её молчание неотличимо от здоровья.
      try {
        await nitroApp.fetch(new Request(`${base}/api/smoke?key=${key}`));
      } catch {
        /* проверка не важнее прогона афиш */
      }
    }) as never,
  );
});
