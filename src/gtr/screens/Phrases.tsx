// Разговорник с официантом: гость показывает экран, официант читает.
//
// Боль, из-за которой экран существует: тайский официант часто не понимает
// ни русского, ни английского, и заказ приезжает не тот. Голосом это не
// решается — произношение гостя без тонов тайцу не разобрать. Решается
// глазами: крупная тайская строка на весь экран, которую официант читает
// как записку.
//
// Реплики — закрытый выверенный список, а не перевод на лету. Ограничения
// в еде это медицинский вопрос: «без арахиса», переведённое приблизительно,
// отправляет человека в больницу. Модель сюда не допущена.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import raw from "../data/waiter-phrases.json";
import { Card, Chip, Eyebrow } from "../ui";

type Item = {
  id: string;
  ru: string;
  en: string;
  thM: string;
  thF: string;
  note?: string;
};
type Group = {
  id: string;
  ru: string;
  en: string;
  th: string;
  critical?: boolean;
  note?: string;
  items: Item[];
};
const BOOK = raw as unknown as { groups: Group[] };

const RED = "#E5231B";
const AMBER = "#F5A623";

/** Пол говорящего: от него зависит частица вежливости, и ошибка слышна
 *  тайцу сразу — мужчина, сказавший ค่ะ, звучит нелепо. Спрашиваем один
 *  раз и запоминаем. */
type Voice = "m" | "f";
const VOICE_KEY = "gtr-phrase-voice";
const loadVoice = (): Voice => {
  try {
    return localStorage.getItem(VOICE_KEY) === "f" ? "f" : "m";
  } catch {
    return "m";
  }
};

// ---------- карточка на весь экран ----------
/** То, ради чего экран и сделан: официант читает с расстояния вытянутой
 *  руки, в клубном полумраке. Поэтому тайская строка крупная и на светлом
 *  фоне — тёмная тема продукта здесь мешает, а не помогает. */
function Show({ item, voice, onClose }: { item: Item; voice: Voice; onClose: () => void }) {
  const { t } = useTranslation();
  const th = voice === "f" ? item.thF : item.thM;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 4000,
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "28px 22px",
        cursor: "pointer",
      }}
    >
      <div
        className="gtr-mono"
        style={{
          font: "600 11px/1 'JetBrains Mono',monospace",
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color: "rgba(0,0,0,.42)",
          marginBottom: 22,
          textAlign: "center",
        }}
      >
        {t("Покажите экран официанту")}
      </div>
      <div
        lang="th"
        style={{
          font: "600 clamp(26px, 7vw, 44px)/1.5 'Golos Text',sans-serif",
          color: "#000",
          textAlign: "center",
          maxWidth: 720,
        }}
      >
        {th}
      </div>
      <div
        style={{
          marginTop: 26,
          paddingTop: 18,
          borderTop: "1px solid rgba(0,0,0,.12)",
          maxWidth: 640,
          textAlign: "center",
        }}
      >
        <div style={{ font: "500 15px/1.5 'Golos Text',sans-serif", color: "rgba(0,0,0,.7)" }}>
          {item.ru}
        </div>
        <div style={{ marginTop: 5, font: "500 14px/1.5 'Golos Text',sans-serif", color: "rgba(0,0,0,.45)" }}>
          {item.en}
        </div>
      </div>
      <div
        className="gtr-mono"
        style={{ marginTop: 26, font: "500 12px/1 'JetBrains Mono',monospace", color: "rgba(0,0,0,.35)" }}
      >
        {t("Нажмите, чтобы закрыть")}
      </div>
    </div>
  );
}

export function PhrasesScreen() {
  const { t } = useTranslation();
  const [voice, setVoice] = useState<Voice>(loadVoice);
  const [groupId, setGroupId] = useState(BOOK.groups[0]?.id ?? "");
  const [open, setOpen] = useState<Item | null>(null);
  const [q, setQ] = useState("");

  const setVoiceSaved = (v: Voice) => {
    setVoice(v);
    try {
      localStorage.setItem(VOICE_KEY, v);
    } catch {
      /* приватный режим — просто не запомним */
    }
  };

  // Поиск идёт по всем группам сразу: гость ищет «арахис», а не раздел.
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const hits: { group: Group; item: Item }[] = [];
    for (const g of BOOK.groups)
      for (const it of g.items)
        if (`${it.ru} ${it.en}`.toLowerCase().includes(needle)) hits.push({ group: g, item: it });
    return hits;
  }, [q]);

  const group = BOOK.groups.find((g) => g.id === groupId) ?? BOOK.groups[0];

  const row = (it: Item, g: Group) => (
    <button
      key={it.id}
      className="gtr-btn"
      onClick={() => setOpen(it)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "11px 13px",
        borderColor: g.critical ? "rgba(229,35,27,.35)" : undefined,
      }}
    >
      <span style={{ display: "block", font: "600 14px/1.4 'Golos Text',sans-serif" }}>{it.ru}</span>
      <span
        lang="th"
        style={{ display: "block", marginTop: 4, font: "500 14px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}
      >
        {voice === "f" ? it.thF : it.thM}
      </span>
      {it.note ? (
        <span
          style={{ display: "block", marginTop: 5, font: "500 12px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}
        >
          {it.note}
        </span>
      ) : null}
    </button>
  );

  return (
    <div style={{ maxWidth: 780, margin: "0 auto" }}>
      <h1 className="gtr-oswald gtr-h1" style={{ marginBottom: 6 }}>
        {t("Разговорник с официантом")}
      </h1>
      <div
        style={{
          font: "500 13px/1.6 'Golos Text',sans-serif",
          color: "var(--gtr-t2)",
          marginBottom: 14,
          maxWidth: 60 + "ch",
        }}
      >
        {t("Выберите фразу и покажите экран официанту — он прочитает её по-тайски. Произносить вслух не нужно: без тонов фраза меняет смысл.")}
      </div>

      {/* Пол говорящего: частица вежливости в тайском зависит от него */}
      <Card style={{ padding: "12px 15px", marginBottom: 12 }}>
        <Eyebrow style={{ marginBottom: 8 }}>{t("КАК ВЫ ГОВОРИТЕ О СЕБЕ")}</Eyebrow>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className={`gtr-map-chip${voice === "m" ? " on" : ""}`}
            onClick={() => setVoiceSaved("m")}
            aria-pressed={voice === "m"}
          >
            {t("Мужчина")} · ครับ
          </button>
          <button
            className={`gtr-map-chip${voice === "f" ? " on" : ""}`}
            onClick={() => setVoiceSaved("f")}
            aria-pressed={voice === "f"}
          >
            {t("Женщина")} · ค่ะ
          </button>
          <span style={{ font: "500 12.5px/1.5 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
            {t("В тайском вежливая частица зависит от того, кто говорит, а не к кому обращаются.")}
          </span>
        </div>
      </Card>

      <input
        className="gtr-input"
        style={{ maxWidth: 320, marginBottom: 12 }}
        placeholder={t("Поиск: арахис, счёт, не острое…")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {found ? (
        <div style={{ display: "grid", gap: 8 }}>
          {found.length ? (
            found.map(({ group: g, item }) => row(item, g))
          ) : (
            <div style={{ font: "500 13px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t3)" }}>
              {t("Ничего не нашли. Попробуйте другое слово или выберите раздел ниже.")}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="gtr-map-row" style={{ marginBottom: 12 }}>
            {BOOK.groups.map((g) => (
              <button
                key={g.id}
                className={`gtr-map-chip${g.id === group.id ? " on" : ""}`}
                onClick={() => setGroupId(g.id)}
                aria-pressed={g.id === group.id}
              >
                {g.ru}
                {g.critical ? <span style={{ color: RED }}> ●</span> : null}
              </button>
            ))}
          </div>

          {group.critical ? (
            <div style={{ marginBottom: 10 }}>
              <Chip color={AMBER}>{t("ПОКАЗЫВАЙТЕ ДО ЗАКАЗА")}</Chip>
            </div>
          ) : null}
          {group.note ? (
            <div
              style={{
                marginBottom: 10,
                font: "500 12.5px/1.6 'Golos Text',sans-serif",
                color: "var(--gtr-t3)",
                maxWidth: 60 + "ch",
              }}
            >
              {group.note}
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 8 }}>{group.items.map((it) => row(it, group))}</div>
        </>
      )}

      {open ? <Show item={open} voice={voice} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
