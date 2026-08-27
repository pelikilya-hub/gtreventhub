// «Где я» — лёгкая геолокация для экранов, которые просто показывают точку.
//
// Отдельно от useGpsTracking намеренно: тот хук пишет каждую координату в
// активный трек вечера, и включить его ради синей точки на карте значит
// молча начать записывать чужую прогулку. Здесь позиция никуда не пишется
// и живёт только в памяти экрана.
//
// Разрешение спрашиваем по нажатию, а не при открытии карты: браузерный
// запрос геолокации в первую секунду знакомства с продуктом гость почти
// всегда отклоняет — и второго шанса система уже не даёт.
import { useCallback, useEffect, useRef, useState } from "react";

export type MyPos = { lat: number; lon: number; accuracy: number };

export type GeoState =
  /** ещё не спрашивали */
  | "idle"
  /** ждём ответа системы */
  | "asking"
  /** позиция получена и обновляется */
  | "on"
  /** гость отказал — просить повторно бессмысленно, нужны настройки */
  | "denied"
  /** нет датчика, нет сигнала или не защищённое соединение */
  | "unavailable";

export function useMyLocation(): {
  pos: MyPos | null;
  state: GeoState;
  error: string | null;
  ask: () => void;
  stop: () => void;
} {
  const [pos, setPos] = useState<MyPos | null>(null);
  const [state, setState] = useState<GeoState>("idle");
  const [error, setError] = useState<string | null>(null);
  const watch = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watch.current !== null) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    }
    setState("idle");
  }, []);

  const ask = useCallback(() => {
    if (watch.current !== null) return; // уже следим
    // navigator.geolocation отсутствует и на сервере при SSR, и на http://
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      setError("геолокация недоступна в этом браузере");
      return;
    }
    setState("asking");
    setError(null);
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
        setState("on");
        setError(null);
      },
      (e) => {
        // PERMISSION_DENIED === 1: отдельное состояние, потому что чинится
        // только в настройках браузера — повторная кнопка тут не поможет.
        setState(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable");
        setError(e.message);
        if (watch.current !== null) {
          navigator.geolocation.clearWatch(watch.current);
          watch.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
  }, []);

  // Уход с экрана обязан снимать слежение: забытый watchPosition держит
  // GPS включённым и жжёт батарею телефона в кармане.
  useEffect(
    () => () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    },
    [],
  );

  return { pos, state, error, ask, stop };
}
