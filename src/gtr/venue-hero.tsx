import { useEffect, useRef, useState, type ReactNode } from "react";

import { useContent } from "./content";
import { EditableImage } from "./EditableImage";

// Геро паспорта площадки.
//
// Что было не так. Фото лежало фоном под текстом карточки высотой 140
// точек, поверх — горизонтальная заливка почти в ноль. Кадр работал
// тусклой текстурой, а имя, чипы и кнопки шли прямо по нему: текст
// перекрывал геро, и от фотографии не оставалось ничего.
//
// Что теперь. Кадр во всю ширину колонки и в полный рост, текст живёт в
// нижней полосе поверх ВЕРТИКАЛЬНОЙ заливки — верх кадра остаётся чистым,
// низ уходит в фон приложения, и подпись читается, не съедая картинку.
//
// Движение. Видео площадки, если оно есть; если нет — медленный наплыв по
// её же фотографиям (Ken Burns + перекрёстное затухание), чтобы паспорт
// дышал даже там, где снято только на телефон. Плюс параллакс: кадр уходит
// вверх медленнее страницы. Всё это выключается при prefers-reduced-motion —
// движение здесь украшение, а не смысл.

const SHOT_MS = 7000; // сколько держится один кадр наплыва

const still = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function VenueHero({
  vid,
  name,
  video,
  poster,
  shots = [],
  children,
}: {
  vid: string;
  name: string;
  /** видео площадки: главный вариант геро, когда оно есть */
  video?: string;
  /** главный кадр — он же постер под видео и фолбэк */
  poster?: string;
  /** прочие кадры площадки для наплыва, когда видео нет */
  shots?: string[];
  children: ReactNode;
}) {
  const { contentOf } = useContent();
  // Кадр, загруженный руками через режим правки, важнее наших слайдшоу:
  // человек выбрал главное фото — значит, показываем именно его.
  const custom = Boolean(contentOf(vid).hero?.url);

  const calm = still();
  const reel = custom || video ? [] : shots.filter(Boolean).slice(0, 5);
  const [shot, setShot] = useState(0);
  useEffect(() => {
    if (calm || reel.length < 2) return;
    const id = window.setInterval(() => setShot((i) => (i + 1) % reel.length), SHOT_MS);
    return () => window.clearInterval(id);
  }, [calm, reel.length]);

  // Параллакс: считаем в rAF от положения самого блока, а не от общего
  // скролла страницы — карточка живёт не в начале документа.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (calm) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const box = boxRef.current;
      const media = mediaRef.current;
      if (!box || !media) return;
      const r = box.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return; // за экраном не считаем
      // Кадр смещается на четверть пройденного пути — глубина, но без
      // отрыва от страницы.
      media.style.transform = `translate3d(0, ${Math.round(-r.top * 0.18)}px, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [calm]);

  return (
    <div className="gtr-vhero" ref={boxRef}>
      <div className="gtr-vhero-media" ref={mediaRef}>
        {/* Базовый слой — редактируемое фото: даёт режим правки, ручную
            замену кадра и генеративный ИМПУЛЬС там, где фото ещё нет. */}
        <EditableImage vid={vid} fallback={poster} alt={name} />

        {/* Наплыв по кадрам площадки поверх базового слоя */}
        {reel.length > 1
          ? reel.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                aria-hidden
                loading={i === 0 ? "eager" : "lazy"}
                className={`gtr-vhero-shot${i === shot ? " on gtr-vhero-ken" : ""}`}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ))
          : null}

        {video && !calm ? (
          <video
            src={video}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden
            className="gtr-vhero-video"
          />
        ) : null}
      </div>

      <div className="gtr-vhero-scrim" aria-hidden />
      <div className="gtr-laser" style={{ zIndex: 2, ["--gtr-run" as string]: "300px" }} />
      <div className="gtr-vhero-in">{children}</div>
    </div>
  );
}
