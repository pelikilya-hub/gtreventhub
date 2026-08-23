// Прогон дымовых проверок. Живёт отдельно от маршрута намеренно:
// маршрут — это калитка, а не место для логики. Пока прогон был внутри
// него, позвать проверку можно было только по расписанию — то есть
// увидеть результат своей же правки удавалось через два часа.
import { addCmd, readQueue, writeQueue } from "./pult";
import { qaItems, qaMatch } from "./tools";
import { kvGetJson, kvListAll, type KvNs } from "../kv-ns";
import { diffChecks, smokeText, type Check, type SmokeState } from "./selfcheck";

export const SMOKE_KEY = "smoke:last";

/** Канарейки базы знаний.
 *
 *  Это вопросы, ответы на которые мы писали своими руками. Если хотя бы
 *  один перестал находиться — значит база до продукта не доехала: не
 *  выучилась, потерялась в KV или разъехалась с матчером. Именно так и
 *  вышло, когда 119 выученных тем лежали мёртвым грузом.
 *
 *  Три штуки из разных слоёв — чтобы отличить «сломался матчер» от
 *  «не доехал KV». */
const CANARIES = ["что такое GTR", "сколько давать чаевых", "можно ли курить в клубе"];

type Flags = { broEnabled?: boolean; broKill?: boolean; voiceProvider?: "openai" | "gemini" };

/** Прогнать проверки, записать исход и положить тревогу в пульт на
 *  переходе. Возвращает то, что увидел, — вызывающий решает, что с этим
 *  делать. */
export async function runSmoke(ns: KvNs): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [{ id: "kv", ok: true, note: "есть" }];
  const env = typeof process !== "undefined" ? process.env : undefined;

  // 1. Продукт вообще включён.
  const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
  checks.push({
    id: "bro",
    ok: Boolean(flags.broEnabled) && !flags.broKill,
    note: flags.broKill ? "рубильник опущен" : flags.broEnabled ? "включён" : "выключен",
  });

  // 2. Ключ того движка, который реально выбран. Проверять оба
  //    бессмысленно: молчит тот, чей ключ отсутствует, а не «какой-то».
  const voice = flags.voiceProvider ?? (env?.GEMINI_API_KEY ? "gemini" : "openai");
  const voiceKey = voice === "gemini" ? env?.GEMINI_API_KEY : env?.OPENAI_API_KEY;
  checks.push({
    id: "voice",
    ok: Boolean(voiceKey),
    note: voiceKey ? `${voice}: ключ на месте` : `${voice}: КЛЮЧА НЕТ`,
  });

  // 3. Текстовый мозг: основной движок и запасной.
  checks.push({
    id: "text",
    ok: Boolean(env?.GEMINI_API_KEY) || Boolean(await ns.get("setting:brain")),
    note: env?.GEMINI_API_KEY ? "Gemini" : "только запасной мозг",
  });

  // 4. База знаний доехала до продукта. Читаем тем же кодом, что и
  //    ответ гостю: KV, слои, матчер.
  try {
    const items = await qaItems(false, (k) => ns.get(k));
    const hit = CANARIES.filter((q) => qaMatch(q, items)).length;
    checks.push({
      id: "qa",
      ok: hit === CANARIES.length,
      note: `${hit} из ${CANARIES.length} канареек, тем в базе ${items.length}`,
    });
  } catch (e) {
    checks.push({ id: "qa", ok: false, note: String(e).slice(0, 80) });
  }

  // 5. Афиша: не «синхронизация прошла», а есть ли будущие события —
  //    именно на этом расхождении BRO не знал про сегодняшний вечер.
  try {
    const keys = await kvListAll(ns, "venueevents:");
    const today = new Date().toISOString().slice(0, 10);
    let upcoming = 0;
    for (const k of keys.slice(0, 160)) {
      const rec = await kvGetJson<{ events?: { dateIso: string }[] }>(ns, k);
      upcoming += (rec?.events ?? []).filter((e) => String(e.dateIso).slice(0, 10) >= today).length;
    }
    checks.push({
      id: "afisha",
      ok: upcoming > 0,
      note: `${upcoming} будущих событий на ${keys.length} площадках`,
    });
  } catch (e) {
    checks.push({ id: "afisha", ok: false, note: String(e).slice(0, 80) });
  }


  const prev = await kvGetJson<SmokeState>(ns, SMOKE_KEY);
  const diff = diffChecks(prev, checks);
  const now = Date.now();
  await ns.put(
    SMOKE_KEY,
    JSON.stringify({ at: now, bad: checks.filter((c) => !c.ok).map((c) => c.id) } satisfies SmokeState),
  );

  // Сообщаем только на переходе. Проверка, кричащая одно и то же каждые
  // два часа, обучает не чинить, а не читать.
  if (diff.broke.length || diff.fixed.length) {
    const queue = await readQueue(ns);
    await writeQueue(ns, addCmd(queue, "дым", smokeText(diff, checks), now));
  }

  return { ok: checks.every((c) => c.ok), checks };
}
