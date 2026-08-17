// Голова BOSS внутри эмблемы: портрет, притворяющийся объёмом.
//
// Настоящая полигональная модель здесь была бы честнее, но дороже во всех
// смыслах: её надо снять фотограмметрией, хранить, грузить и рисовать
// движком — на телефоне в клубе это секунды загрузки ради одного
// аватара. Поэтому объём собирается из слоёв: контровый свет по краю,
// подсветка от сцены, тень под подбородком, спекуляр и наклон по
// гироскопу. С двух шагов это читается как 3D, а весит как картинка.
//
// День и ночь — два разных снимка: в прозрачных очках и в тёмных.
// Переключает время Пхукета, а не устройства: BOSS может смотреть
// дашборд из любого часового пояса, но его вечер — здешний.
import { useEffect, useRef, useState } from "react";

export type BossHead = { day?: string; night?: string };

/** Час на Пхукете (UTC+7) — остров живёт по своему времени. */
export const phuketHour = (now = Date.now()): number =>
  new Date(now + 7 * 3_600_000).getUTCHours();

/** День на острове: 06:00–17:59. Дальше — ночная смена и тёмные очки. */
export const isDaylight = (now = Date.now()): boolean => {
  const h = phuketHour(now);
  return h >= 6 && h < 18;
};

export function BossHead3D({
  head,
  size = 120,
  /** Ручной перевод: null — по времени острова. */
  force = null,
}: {
  head?: BossHead | null;
  size?: number;
  force?: "day" | "night" | null;
}) {
  const [day, setDay] = useState(() => isDaylight());
  useEffect(() => {
    // Проверяем раз в минуту: смена дня и ночи не должна требовать
    // перезагрузки страницы.
    const id = window.setInterval(() => setDay(isDaylight()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // Голова провожает указатель: на компьютере — мышь, на телефоне —
  // палец. Гироскоп на iOS просыпается только после разрешения, и
  // держаться только на нём нельзя: без разрешения портрет замирает,
  // а неподвижное лицо выглядит сломанным.
  const stage = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stage.current;
    const root = el?.closest(".bosshead") as HTMLElement | null;
    if (!root) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    const tick = () => {
      cx += (tx - cx) * 0.12;
      cy += (ty - cy) * 0.12;
      root.style.setProperty("--bh-x", cx.toFixed(3));
      root.style.setProperty("--bh-y", cy.toFixed(3));
      raf =
        Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      // Ловим указатель в широкой зоне вокруг эмблемы, а не только
      // поверх неё: голова провожает взгляд, а не ждёт наведения.
      const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(260, r.width * 3);
      const dy = (e.clientY - (r.top + r.height / 2)) / Math.max(220, r.height * 3);
      tx = Math.max(-1, Math.min(1, dx));
      ty = Math.max(-1, Math.min(1, dy));
      kick();
    };
    const home = () => {
      tx = 0;
      ty = 0;
      kick();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", home);
    window.addEventListener("pointercancel", home);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", home);
      window.removeEventListener("pointercancel", home);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const mode = force ?? (day ? "day" : "night");
  const src = mode === "day" ? head?.day : head?.night;
  // Снимка на эту половину суток нет — берём тот, что есть: пустая
  // эмблема хуже, чем портрет в неподходящих очках.
  const shown = src || head?.night || head?.day || "";

  return (
    <div
      className={`boss3d bosshead${shown ? " on" : ""} ${mode}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div className="boss3d-spin">
        <span className="boss3d-plane p1" />
        <span className="boss3d-plane p2" />
        <span className="boss3d-plane p3" />
        <span className="boss3d-ring" />
        {!shown ? <span className="boss3d-core" /> : null}
      </div>
      {shown ? (
        <div className="bosshead-stage" ref={stage}>
          {/* Слой наклона живёт отдельно от собственной анимации головы:
              иначе одно transform затирает другое, и портрет замирает. */}
          <div className="bosshead-tilt">
            {/* Контровой свет: красный ободок GTR по краю силуэта. */}
            <img className="bosshead-rim" src={shown} alt="" />
            {/* Сам портрет: качается сам, без всяких сенсоров. */}
            <img className="bosshead-img" src={shown} alt="" />
            {/* Спекуляр: блик скользит по лицу, как от движущегося прибора. */}
            <span className="bosshead-spec" />
          </div>
          {/* Тень под подбородком — то, что отличает наклейку от объёма. */}
          <span className="bosshead-shadow" />
        </div>
      ) : null}
    </div>
  );
}
