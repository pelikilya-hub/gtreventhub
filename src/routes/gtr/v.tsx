// Публичная страница подтверждения данных площадкой: /gtr/v?t=<токен>.
// Без регистрации — токен из персональной ссылки и есть доступ. Менеджер
// площадки проверяет вместимость и прайс, оставляет контакт, подтверждает.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { venueConfirmSubmitFn, venueFbConnectFn, venueLinkOpenFn } from "@/gtr/kv-api";
import { Eyebrow } from "@/gtr/ui";

export const Route = createFileRoute("/gtr/v")({
  validateSearch: (s: Record<string, unknown>) => ({ t: String(s.t ?? "") }),
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ deps }) => await venueLinkOpenFn({ data: { token: deps.t } }),
  component: VenueConfirmPage,
});

type Lang = "en" | "th" | "ru";

const T: Record<Lang, Record<string, string>> = {
  en: {
    eyebrow: "VENUE DATA CONFIRMATION",
    intro:
      "GTR Event brings events, artists and organizers to Phuket venues. Confirm your venue's details — organizers will see verified terms.",
    contact: "YOUR CONTACT",
    name: "Name *",
    role: "Position",
    phone: "Phone / WhatsApp *",
    email: "Email",
    venue: "VENUE DETAILS",
    capacity: "Capacity (guests)",
    price: "Event rate, THB",
    unit: "per",
    unitEvent: "event",
    unitDay: "day",
    unitHour: "hour",
    covers: "What's included",
    notes: "Notes (optional)",
    photos: "VENUE PHOTOS",
    photosNote: "Add 3–6 photos — organizers will see your venue at its best.",
    photosAdd: "Add photos",
    photosLimit: "Photo limit reached (6)",
    fb: "YOUR EVENTS IN THE APP",
    fbNote: "Connect your Facebook page — your events will appear automatically in the GTR Event app (thousands of Phuket guests, free promo).",
    fbSteps: "1) Open developers.facebook.com/tools/explorer  2) Get Page Access Token → choose your page  3) Copy the token and paste below.",
    fbPlaceholder: "Paste your page access token",
    fbConnect: "CONNECT EVENTS",
    fbOk: "Connected! Your events will appear within 6 hours.",
    fbFail: "Could not connect — check the token",
    submit: "CONFIRM DETAILS",
    done: "Thank you! Details confirmed.",
    doneSub: "Our team will be in touch. Update anytime via the same link.",
    bad: "This link is invalid or expired. Ask your GTR contact for a new one.",
    required: "Name and phone are required",
    fail: "Could not save — try again",
  },
  th: {
    eyebrow: "ยืนยันข้อมูลสถานที่",
    intro:
      "GTR Event นำงานอีเวนต์ ศิลปิน และผู้จัดงานมาสู่สถานที่ในภูเก็ต กรุณายืนยันข้อมูลของคุณ — ผู้จัดงานจะเห็นเงื่อนไขที่ยืนยันแล้ว",
    contact: "ข้อมูลติดต่อ",
    name: "ชื่อ *",
    role: "ตำแหน่ง",
    phone: "โทรศัพท์ / WhatsApp *",
    email: "อีเมล",
    venue: "ข้อมูลสถานที่",
    capacity: "ความจุ (จำนวนแขก)",
    price: "ราคาจัดงาน (บาท)",
    unit: "ต่อ",
    unitEvent: "งาน",
    unitDay: "วัน",
    unitHour: "ชั่วโมง",
    covers: "รวมอะไรบ้าง",
    notes: "หมายเหตุ",
    photos: "รูปภาพสถานที่",
    photosNote: "เพิ่มรูป 3–6 รูป เพื่อให้ผู้จัดงานเห็นสถานที่ของคุณอย่างดีที่สุด",
    photosAdd: "เพิ่มรูปภาพ",
    photosLimit: "ครบจำนวนรูปแล้ว (6)",
    fb: "อีเวนต์ของคุณในแอป",
    fbNote: "เชื่อมต่อเพจ Facebook — อีเวนต์ของคุณจะปรากฏในแอป GTR Event อัตโนมัติ (โปรโมตฟรีถึงแขกภูเก็ตหลายพันคน)",
    fbSteps: "1) เปิด developers.facebook.com/tools/explorer  2) Get Page Access Token → เลือกเพจ  3) คัดลอกโทเคนแล้ววางด้านล่าง",
    fbPlaceholder: "วางโทเคนเพจของคุณ",
    fbConnect: "เชื่อมต่ออีเวนต์",
    fbOk: "เชื่อมต่อแล้ว! อีเวนต์จะปรากฏภายใน 6 ชั่วโมง",
    fbFail: "เชื่อมต่อไม่ได้ — ตรวจสอบโทเคน",
    submit: "ยืนยันข้อมูล",
    done: "ขอบคุณ! ยืนยันข้อมูลเรียบร้อย",
    doneSub: "ทีมงานจะติดต่อกลับ แก้ไขได้ทุกเมื่อผ่านลิงก์เดิม",
    bad: "ลิงก์ไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่จากทีม GTR",
    required: "กรุณากรอกชื่อและโทรศัพท์",
    fail: "บันทึกไม่สำเร็จ ลองอีกครั้ง",
  },
  ru: {
    eyebrow: "ПОДТВЕРЖДЕНИЕ ДАННЫХ ПЛОЩАДКИ",
    intro:
      "GTR Event приводит события, артистов и организаторов на площадки Пхукета. Подтвердите данные — организаторы будут видеть проверенные условия.",
    contact: "ВАШ КОНТАКТ",
    name: "Имя *",
    role: "Должность",
    phone: "Телефон / WhatsApp *",
    email: "Email",
    venue: "ДАННЫЕ ПЛОЩАДКИ",
    capacity: "Вместимость (гостей)",
    price: "Стоимость события, THB",
    unit: "за",
    unitEvent: "событие",
    unitDay: "день",
    unitHour: "час",
    covers: "Что входит",
    notes: "Комментарий",
    photos: "ФОТО ПЛОЩАДКИ",
    photosNote: "Добавьте 3–6 фото — организаторы увидят площадку с лучшей стороны.",
    photosAdd: "Добавить фото",
    photosLimit: "Достигнут лимит фото (6)",
    fb: "ВАШИ СОБЫТИЯ В ПРИЛОЖЕНИИ",
    fbNote: "Подключите страницу Facebook — ваши события автоматически появятся в приложении GTR Event (тысячи гостей Пхукета, бесплатное промо).",
    fbSteps: "1) Откройте developers.facebook.com/tools/explorer  2) Get Page Access Token → выберите свою страницу  3) Скопируйте токен и вставьте ниже.",
    fbPlaceholder: "Вставьте токен вашей страницы",
    fbConnect: "ПОДКЛЮЧИТЬ СОБЫТИЯ",
    fbOk: "Подключено! События появятся в течение 6 часов.",
    fbFail: "Не удалось подключить — проверьте токен",
    submit: "ПОДТВЕРДИТЬ ДАННЫЕ",
    done: "Спасибо! Данные подтверждены.",
    doneSub: "Команда свяжется с вами. Обновить можно по той же ссылке.",
    bad: "Ссылка недействительна или истекла. Запросите новую у контакта GTR.",
    required: "Имя и телефон обязательны",
    fail: "Не сохранилось — попробуйте ещё раз",
  },
};

function VenueConfirmPage() {
  const info = Route.useLoaderData();
  const { t: token } = Route.useSearch();
  const [lang, setLangRaw] = useState<Lang>("en");
  const t = T[lang];

  // На EN/TH русские предзаполнения из нашей базы неуместны: вместимость
  // сводим к числу, русское описание «что входит» убираем (плейсхолдер
  // подскажет на языке страницы). Названия площадок не трогаем.
  const setLang = (l: Lang) => {
    setLangRaw(l);
    if (l !== "ru") {
      setCapacity((c) => {
        const digits = c.match(/\d[\d\s–-]*/)?.[0]?.trim();
        return /[а-яА-ЯЁё]/.test(c) ? (digits ?? "") : c;
      });
      setCovers((c) => (/[а-яА-ЯЁё]/.test(c) ? "" : c));
    }
  };

  const ok = info.ok === true;
  const [name, setName] = useState(ok ? (info.contact?.name ?? "") : "");
  const [role, setRole] = useState(ok ? (info.contact?.role ?? "") : "");
  const [phone, setPhone] = useState(ok ? (info.contact?.phone ?? "") : "");
  const [email, setEmail] = useState(ok ? (info.contact?.email ?? "") : "");
  // стартовый язык — EN, поэтому кириллические подсказки чистим сразу
  const [capacity, setCapacity] = useState(() => {
    const c = ok ? info.capacity : "";
    return /[а-яА-ЯЁё]/.test(c) ? (c.match(/\d[\d\s–-]*/)?.[0]?.trim() ?? "") : c;
  });
  const [amount, setAmount] = useState(ok && info.rate ? String(info.rate.amount) : "");
  const [unit, setUnit] = useState(ok && info.rate ? info.rate.unit : "событие");
  const [covers, setCovers] = useState(() => {
    const c = ok && info.rate ? info.rate.covers : "";
    return /[а-яА-ЯЁё]/.test(c) ? "" : c;
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);

  // клиентское сжатие до 1600px — фото с телефона уходят быстро
  const compress = (f: File) =>
    new Promise<Blob | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 1600 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * sc);
        cv.height = Math.round(img.height * sc);
        cv.getContext("2d")?.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        cv.toBlob((b) => resolve(b), "image/jpeg", 0.82);
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(f);
    });

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = 6 - photos.length;
    const list = [...files].slice(0, Math.max(0, room));
    setUploading((u) => u + list.length);
    for (const f of list) {
      try {
        const blob = await compress(f);
        if (!blob) continue;
        const res = await fetch(`/api/vphoto?t=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "content-type": "image/jpeg" },
          body: blob,
        });
        const j = (await res.json()) as { ok?: boolean; path?: string };
        if (j.ok && j.path) setPhotos((p) => [...p, j.path as string]);
      } catch {
        // одно не ушло — остальные продолжаем
      } finally {
        setUploading((u) => u - 1);
      }
    }
  };

  const [fbToken, setFbToken] = useState("");
  const [fbBusy, setFbBusy] = useState(false);
  const [fbState, setFbState] = useState<"" | "ok" | "fail">("");
  const connectFb = async () => {
    if (!token) return;
    setFbBusy(true);
    setFbState("");
    try {
      const r = await venueFbConnectFn({ data: { token, fbToken } });
      setFbState(r.ok ? "ok" : "fail");
      if (r.ok) setFbToken("");
    } catch {
      setFbState("fail");
    } finally {
      setFbBusy(false);
    }
  };

  const submit = async () => {
    if (!name.trim() || !phone.trim()) return setErr(t.required);
    setBusy(true);
    setErr("");
    try {
      const r = await venueConfirmSubmitFn({
        data: {
          token,
          contact: { name, role, phone, email },
          rate: { amount: parseInt(amount.replace(/[^\d]/g, ""), 10) || 0, unit, covers },
          capacity,
          notes,
        },
      });
      if (r.ok) setDone(true);
      else setErr(t.fail);
    } catch {
      setErr(t.fail);
    } finally {
      setBusy(false);
    }
  };

  const label = (s: string) => (
    <span
      className="gtr-mono"
      style={{
        display: "block",
        margin: "0 0 5px",
        font: "600 9.5px/1 'JetBrains Mono',monospace",
        color: "rgba(255,255,255,.5)",
        letterSpacing: ".08em",
        textTransform: "uppercase",
      }}
    >
      {s}
    </span>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "28px 16px 60px",
      }}
    >
      <div style={{ width: "min(560px, 100%)", display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src="/brand/GTR_primary_dark_clean.svg"
            alt="GTR"
            style={{ height: 40, width: "auto" }}
          />
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {(["en", "th", "ru"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className="gtr-mono"
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  font: "700 10px/1 'JetBrains Mono',monospace",
                  border: `1px solid ${lang === l ? "#E5231B" : "rgba(255,255,255,.15)"}`,
                  background: lang === l ? "rgba(229,35,27,.15)" : "transparent",
                  color: lang === l ? "#fff" : "rgba(255,255,255,.5)",
                }}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {!ok ? (
          <div className="gtr-card" style={{ padding: "26px 24px" }}>
            <div style={{ font: "500 13px/1.6 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
              {t.bad}
            </div>
          </div>
        ) : done ? (
          <div className="gtr-card" style={{ padding: "34px 26px", textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
            <div style={{ font: "700 18px/1.3 Oswald,sans-serif", textTransform: "uppercase" }}>
              {t.done}
            </div>
            <div
              style={{
                marginTop: 8,
                font: "500 12px/1.6 'Golos Text',sans-serif",
                color: "var(--gtr-t2)",
              }}
            >
              {t.doneSub}
            </div>
          </div>
        ) : (
          <>
            <div className="gtr-card" style={{ padding: "20px 22px" }}>
              <Eyebrow style={{ marginBottom: 8 }}>{t.eyebrow}</Eyebrow>
              <div
                className="gtr-oswald"
                style={{ font: "700 24px/1.15 Oswald,sans-serif", textTransform: "uppercase" }}
              >
                {info.name}
              </div>
              {info.area ? (
                <div
                  className="gtr-mono"
                  style={{
                    marginTop: 5,
                    font: "500 10.5px/1 'JetBrains Mono',monospace",
                    color: "var(--gtr-t3)",
                  }}
                >
                  {info.area}
                </div>
              ) : null}
              <div
                style={{
                  marginTop: 12,
                  font: "500 12px/1.6 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                }}
              >
                {t.intro}
              </div>
            </div>

            <div className="gtr-card" style={{ padding: "20px 22px", display: "grid", gap: 12 }}>
              <Eyebrow>{t.contact}</Eyebrow>
              <div>
                {label(t.name)}
                <input className="gtr-input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  {label(t.role)}
                  <input className="gtr-input" value={role} onChange={(e) => setRole(e.target.value)} />
                </div>
                <div>
                  {label(t.phone)}
                  <input
                    className="gtr-input"
                    value={phone}
                    inputMode="tel"
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>
              <div>
                {label(t.email)}
                <input
                  className="gtr-input"
                  value={email}
                  inputMode="email"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="gtr-card" style={{ padding: "20px 22px", display: "grid", gap: 12 }}>
              <Eyebrow>{t.venue}</Eyebrow>
              <div className="gtr-md-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  {label(t.capacity)}
                  <input
                    className="gtr-input"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                  />
                </div>
                <div>
                  {label(`${t.price} · ${t.unit}`)}
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="gtr-input"
                      value={amount}
                      inputMode="numeric"
                      style={{ flex: 1, minWidth: 0 }}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <select
                      className="gtr-input"
                      value={unit}
                      style={{ width: 110, flex: "none" }}
                      onChange={(e) => setUnit(e.target.value)}
                    >
                      <option value="событие">{t.unitEvent}</option>
                      <option value="день">{t.unitDay}</option>
                      <option value="час">{t.unitHour}</option>
                    </select>
                  </div>
                </div>
              </div>
              <div>
                {label(t.covers)}
                <input className="gtr-input" value={covers} onChange={(e) => setCovers(e.target.value)} />
              </div>
              <div>
                {label(t.notes)}
                <textarea
                  className="gtr-input"
                  value={notes}
                  rows={3}
                  style={{ resize: "vertical", height: "auto" }}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="gtr-card" style={{ padding: "20px 22px", display: "grid", gap: 10 }}>
              <Eyebrow>{t.photos}</Eyebrow>
              <div
                style={{
                  font: "500 11px/1.55 'Golos Text',sans-serif",
                  color: "var(--gtr-t2)",
                }}
              >
                {t.photosNote}
              </div>
              {photos.length ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {photos.map((p) => (
                    <img
                      key={p}
                      src={p}
                      alt=""
                      style={{
                        width: 76,
                        height: 76,
                        objectFit: "cover",
                        border: "1px solid rgba(255,255,255,.15)",
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <label
                className="gtr-btn"
                style={{
                  justifySelf: "start",
                  cursor: photos.length >= 6 ? "not-allowed" : "pointer",
                  opacity: photos.length >= 6 ? 0.5 : 1,
                }}
              >
                {uploading > 0
                  ? `… ${uploading}`
                  : photos.length >= 6
                    ? t.photosLimit
                    : `+ ${t.photosAdd} (${photos.length}/6)`}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={photos.length >= 6}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    void addPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            {/* FB-афиши: площадка подключает свою страницу — её события
                идут в календарь GTR официально, токен меняем на вечный */}
            <div style={{ display: "grid", gap: 8 }}>
              <Eyebrow>{t.fb}</Eyebrow>
              <div style={{ font: "500 12px/1.55 'Golos Text',sans-serif", color: "var(--gtr-t2)" }}>
                {t.fbNote}
              </div>
              <div
                className="gtr-mono"
                style={{ font: "500 10px/1.6 'JetBrains Mono',monospace", color: "var(--gtr-t3)" }}
              >
                {t.fbSteps}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  className="gtr-input"
                  style={{ flex: "1 1 220px" }}
                  placeholder={t.fbPlaceholder}
                  value={fbToken}
                  onChange={(e) => setFbToken(e.target.value)}
                />
                <button
                  className="gtr-btn"
                  disabled={fbBusy || !fbToken.trim()}
                  onClick={() => void connectFb()}
                >
                  {fbBusy ? "…" : t.fbConnect}
                </button>
              </div>
              {fbState ? (
                <div
                  style={{
                    font: "600 11.5px/1.4 'Golos Text',sans-serif",
                    color: fbState === "ok" ? "#3DDC84" : "#E5231B",
                  }}
                >
                  {fbState === "ok" ? t.fbOk : t.fbFail}
                </div>
              ) : null}
            </div>

            {err ? (
              <div
                style={{
                  font: "600 12px/1.4 'Golos Text',sans-serif",
                  color: "#E5231B",
                }}
              >
                {err}
              </div>
            ) : null}
            <button
              className="gtr-btn gtr-btn-primary"
              disabled={busy}
              onClick={submit}
              style={{ padding: "14px 18px", font: "700 13px/1 Oswald,sans-serif", letterSpacing: ".08em" }}
            >
              {busy ? "…" : t.submit}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
