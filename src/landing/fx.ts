// Моушен витрины: один хук, без библиотек.
//
// Язык движения взят у bangtaostyle.com — текст проявляется из глифового
// шума, цифры набегают, кнопки дышат и отдают импульс от точки касания,
// герой уезжает в глубину при прокрутке. Но витрина — страница для поиска
// и для телефона на 4G, поэтому правила жёстче, чем там:
//   • сервер отдаёт настоящий текст; шум рисуется только поверх уже
//     прочитанной страницы и только пока элемент проявляется;
//   • если скрипт не доехал, страница целиком видна — скрывать элементы
//     до появления разрешено лишь под классом .fx, который ставит этот хук;
//   • prefers-reduced-motion выключает всё, кроме часов.
import { useEffect, type RefObject } from "react";

const NOISE = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@$/<>{}[]=+*ЖЩЫЮЯФДЛБ";

function decode(el: HTMLElement, speed = 1) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: { n: Text; orig: string; last: string; at: number }[] = [];
  let total = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.nodeValue?.trim()) continue;
    nodes.push({ n, orig: n.nodeValue, last: n.nodeValue, at: total });
    total += n.nodeValue.length;
  }
  if (!total) return;
  if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", el.textContent ?? "");
  const t0 = performance.now();
  const dur = (380 + total * 22) / speed;
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / dur);
    const k = Math.floor(p * total);
    const f = Math.floor(t / 45);
    for (const o of nodes) {
      // React переписал узел — не трогаем.
      if (o.n.nodeValue !== o.last) continue;
      const v =
        p >= 1
          ? o.orig
          : [...o.orig]
              .map((ch, i) => {
                const pos = o.at + i;
                if (pos < k || ch === " " || ch === " ") return ch;
                return NOISE[(pos * 31 + f * 17) % NOISE.length];
              })
              .join("");
      o.n.nodeValue = v;
      o.last = v;
    }
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function countUp(el: HTMLElement) {
  const to = Number(el.dataset.count);
  if (!Number.isFinite(to) || to <= 0) return;
  const suffix = el.dataset.suffix ?? "";
  const t0 = performance.now();
  const dur = 1100;
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = `${Math.round(to * e)}${suffix}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bangkokClock(els: HTMLElement[]) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  });
  const tick = () => {
    const s = fmt.format(new Date());
    for (const el of els) el.textContent = s;
  };
  tick();
  return window.setInterval(tick, 20_000);
}

export function useLandingFx(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const clock = bangkokClock([...el.querySelectorAll<HTMLElement>("[data-clock]")]);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return () => window.clearInterval(clock);
    }
    const cleanups: (() => void)[] = [() => window.clearInterval(clock)];

    // ---------- проявление при прокрутке ----------
    const targets = [...el.querySelectorAll<HTMLElement>("[data-rv]")];
    const vh = window.innerHeight;
    // То, что уже на экране, не прячем: иначе первый кадр мигнёт пустотой.
    for (const t of targets) {
      const r = t.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) t.classList.add("in");
    }
    el.classList.add("fx");
    const fire = (t: HTMLElement) => {
      t.classList.add("in");
      if (t.hasAttribute("data-decode")) decode(t);
      for (const d of t.querySelectorAll<HTMLElement>("[data-decode]")) decode(d);
      for (const c of t.querySelectorAll<HTMLElement>("[data-count]")) countUp(c);
      if (t.hasAttribute("data-count")) countUp(t);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          fire(e.target as HTMLElement);
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    for (const t of targets) {
      // Видимое с порога тоже проявляем кодом — это и есть «загрузка».
      if (t.classList.contains("in")) fire(t);
      else io.observe(t);
    }
    cleanups.push(() => io.disconnect());

    // ---------- герой уезжает в глубину, шапка густеет ----------
    const hero = el.querySelector<HTMLElement>(".lp-hero");
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        if (hero) {
          const h = hero.offsetHeight || 1;
          el.style.setProperty("--hp", Math.min(1, Math.max(0, y / h)).toFixed(3));
        }
        el.classList.toggle("scrolled", y > 24);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    });

    // ---------- знак GTR EVENT сбоит раз в несколько секунд ----------
    const mark = el.querySelector<HTMLElement>(".lp-mark");
    if (mark) {
      let timer = 0;
      const glitch = () => {
        mark.classList.add("glitch");
        window.setTimeout(() => mark.classList.remove("glitch"), 420);
        timer = window.setTimeout(glitch, 3800 + Math.random() * 4200);
      };
      timer = window.setTimeout(glitch, 1600);
      cleanups.push(() => window.clearTimeout(timer));
    }

    // ---------- кнопки: магнит, шум в подписи, импульс от касания ----------
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const btnOf = (t: EventTarget | null) =>
      (t as HTMLElement | null)?.closest?.(".lp-btn") as HTMLElement | null;
    const busy = new WeakSet<HTMLElement>();
    const onOver = (e: PointerEvent) => {
      const b = btnOf(e.target);
      if (!b || !fine || b.contains(e.relatedTarget as Node | null) || busy.has(b)) return;
      busy.add(b);
      decode(b, 2.4);
      window.setTimeout(() => busy.delete(b), 500);
    };
    const onMove = (e: PointerEvent) => {
      if (!fine) return;
      const b = btnOf(e.target);
      if (!b) return;
      const r = b.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      b.style.setProperty("--mx", `${(dx * 10).toFixed(1)}px`);
      b.style.setProperty("--my", `${(dy * 8).toFixed(1)}px`);
    };
    const onOut = (e: PointerEvent) => {
      const b = btnOf(e.target);
      if (!b || b.contains(e.relatedTarget as Node | null)) return;
      b.style.removeProperty("--mx");
      b.style.removeProperty("--my");
    };
    const onDown = (e: PointerEvent) => {
      const b = btnOf(e.target);
      if (!b) return;
      const r = b.getBoundingClientRect();
      const s = document.createElement("span");
      s.className = "lp-burst";
      s.style.left = `${e.clientX - r.left}px`;
      s.style.top = `${e.clientY - r.top}px`;
      b.appendChild(s);
      b.classList.remove("kick");
      void b.offsetWidth;
      b.classList.add("kick");
      window.setTimeout(() => {
        s.remove();
        b.classList.remove("kick");
      }, 620);
    };
    el.addEventListener("pointerover", onOver);
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerout", onOut);
    el.addEventListener("pointerdown", onDown, { passive: true });
    cleanups.push(() => {
      el.removeEventListener("pointerover", onOver);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerout", onOut);
      el.removeEventListener("pointerdown", onDown);
    });

    return () => {
      for (const c of cleanups) c();
    };
  }, [root]);
}
