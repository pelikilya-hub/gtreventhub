// Доставка обновлений во все профили.
//
// Приложение — одностраничное, и вкладка (а тем более иконка с домашнего
// экрана) живёт неделями. Человек «заходит», видит вчерашнюю сборку и
// сообщает, что обновлений нет. Сервер тут ни при чём: HTML отдаётся без
// кэша, ассеты хэшированы — просто никто не перезагружал страницу.
//
// Поэтому сборка носит отпечаток. Мы сверяем свой с тем, что отдаёт
// /api/version, и когда они разошлись — говорим об этом человеку.
// Перезагружаем не молча: он может стоять в брифе события или в брони,
// и потерянная форма хуже устаревшей вёрстки. Исключение — экран, где
// терять нечего: там обновляемся сами при возврате на вкладку.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

declare const __GTR_BUILD__: string;

const MINE = typeof __GTR_BUILD__ === "string" ? __GTR_BUILD__ : "";
const EVERY_MS = 4 * 60_000;

const fetchBuild = async (): Promise<string> => {
  try {
    const r = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return "";
    const d = (await r.json()) as { build?: string };
    return String(d.build ?? "");
  } catch {
    return "";
  }
};

export function UpdateGate() {
  const { t } = useTranslation();
  const [stale, setStale] = useState(false);
  // Форма в работе — молчаливая перезагрузка недопустима. Считаем занятым
  // экран, где есть непустой ввод: бриф, бронь, заявка.
  const busy = useRef(false);

  const check = useCallback(async (silentOk: boolean) => {
    if (!MINE) return;
    const live = await fetchBuild();
    if (!live || live === MINE) return;
    // Возврат на вкладку с пустыми полями — лучший момент забрать новую
    // версию молча: человек ещё ничего не начал и подмены не заметит.
    // Но не чаще раза в три минуты: если устройство упрямо держит старый
    // HTML (iOS это умеет), без предохранителя перезагрузка зациклится —
    // экран мигает, и человек читает это как «всё сломалось».
    if (silentOk && !busy.current) {
      const K = "gtr.upd.last";
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(K) ?? 0);
      } catch {
        /* приватный режим */
      }
      if (Date.now() - last > 3 * 60_000) {
        try {
          sessionStorage.setItem(K, String(Date.now()));
        } catch {
          /* приватный режим */
        }
        window.location.reload();
        return;
      }
    }
    setStale(true);
  }, []);

  useEffect(() => {
    const scan = () => {
      busy.current = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
      ).some((el) => el.value.trim().length > 0);
    };

    void check(false);
    const id = window.setInterval(() => void check(false), EVERY_MS);
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      scan();
      void check(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [check]);

  if (!stale) return null;

  return (
    <div className="gtr-upd" role="status">
      <span className="gtr-upd-t">{t("Вышла новая версия GTR")}</span>
      <button className="gtr-upd-b" onClick={() => window.location.reload()}>
        {t("Обновить")}
      </button>
    </div>
  );
}
