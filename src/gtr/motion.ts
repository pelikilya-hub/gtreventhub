// Сенсоры движения: наклон телефона двигает атмосферный свет (параллакс
// как в игре). beta/gamma сглаживаются lerp-ом и попадают в CSS-переменные
// --gtr-tilt-x/y на корне — CSS решает, кто и насколько сдвигается.
// iOS требует явного разрешения из жеста: спрашиваем на первом касании,
// ответ запоминаем, чтобы не приставать.
import { useEffect } from "react";

const CONSENT_KEY = "gtr-motion";

type OrientationCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function useDeviceTilt() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // сенсоры есть только на устройствах с ориентацией
    if (typeof DeviceOrientationEvent === "undefined") return;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let running = false;

    const apply = () => {
      // lerp: свет плывёт за наклоном, а не дёргается
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      const r = document.documentElement;
      r.style.setProperty("--gtr-tilt-x", `${curX.toFixed(2)}px`);
      r.style.setProperty("--gtr-tilt-y", `${curY.toFixed(2)}px`);
      raf = requestAnimationFrame(apply);
    };

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      // gamma: влево/вправо (-90..90), beta: вперёд/назад (-180..180)
      const g = Math.max(-30, Math.min(30, e.gamma));
      const b = Math.max(-30, Math.min(30, e.beta - 40)); // 40° — естественный хват
      targetX = (g / 30) * 22;
      targetY = (b / 30) * 16;
      if (!running) {
        running = true;
        raf = requestAnimationFrame(apply);
      }
    };

    const start = () => {
      window.addEventListener("deviceorientation", onOrient);
    };

    const ctor = DeviceOrientationEvent as OrientationCtor;
    const needsPermission = typeof ctor.requestPermission === "function";
    const consent = localStorage.getItem(CONSENT_KEY);

    let gestureBound = false;
    const askOnGesture = () => {
      ctor.requestPermission!()
        .then((res) => {
          localStorage.setItem(CONSENT_KEY, res);
          if (res === "granted") start();
        })
        .catch(() => localStorage.setItem(CONSENT_KEY, "denied"));
      window.removeEventListener("touchend", askOnGesture);
      window.removeEventListener("click", askOnGesture);
      gestureBound = false;
    };

    if (!needsPermission) {
      start(); // Android и десктоп-браузеры с сенсором — без диалога
    } else if (consent === "granted") {
      // разрешение уже давали: requestPermission из не-жеста вернёт granted
      ctor.requestPermission!()
        .then((res) => res === "granted" && start())
        .catch(() => {});
    } else if (consent !== "denied") {
      gestureBound = true;
      window.addEventListener("touchend", askOnGesture, { once: true });
      window.addEventListener("click", askOnGesture, { once: true });
    }

    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      if (gestureBound) {
        window.removeEventListener("touchend", askOnGesture);
        window.removeEventListener("click", askOnGesture);
      }
      cancelAnimationFrame(raf);
      const r = document.documentElement;
      r.style.removeProperty("--gtr-tilt-x");
      r.style.removeProperty("--gtr-tilt-y");
    };
  }, []);
}
