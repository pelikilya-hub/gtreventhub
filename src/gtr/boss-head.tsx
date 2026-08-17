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
import { useEffect, useState } from "react";

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
        <div className="bosshead-stage">
          {/* Контровой свет: красный ободок GTR по краю силуэта. */}
          <img className="bosshead-rim" src={shown} alt="" />
          {/* Сам портрет. */}
          <img className="bosshead-img" src={shown} alt="" />
          {/* Спекуляр: блик скользит по лицу, как от движущегося прибора. */}
          <span className="bosshead-spec" />
          {/* Тень под подбородком — то, что отличает наклейку от объёма. */}
          <span className="bosshead-shadow" />
        </div>
      ) : null}
    </div>
  );
}
