'use client';
import { useEffect } from 'react';
import Lenis from 'lenis';

declare global {
  interface Window { __lenis?: Lenis }
}

/**
 * Cinematic scroll engine.
 * - Lenis inertia scrolling (anchors handled, chat/map/popups excluded).
 * - Every `main > section` gets CSS vars on each frame:
 *     --p  0→1 while the section travels through the viewport (parallax)
 *     --e  0→1 as the section enters (top edge from 100% → 35% of the viewport)
 *     --x  0→1 as the section leaves upwards (used by the hero dolly-out)
 * - --v (scroll velocity, 0..1) and --lb (letterbox bar height), written only on their consumers, for
 *   motion blur / chromatic split and cinematic bars during fast moves.
 */
/** Latest scroll progress per section id (JS readers use this instead of getComputedStyle, which forces a style flush). */
export const scrollP: Record<string, number> = {};

export function ScrollFX() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lenis = new Lenis({
      lerp: 0.085,
      smoothWheel: true,
      anchors: { offset: -70 },
      autoRaf: false,
      prevent: (node) => !!node.closest?.('.chat-list, .maplibregl-map, .maplibregl-popup, .sheet, [data-lenis-prevent]'),
    });
    window.__lenis = lenis;

    let raf = 0, vel = 0, lb = 0, lastV = '', lastLb = '';
    // touch devices: coarser steps → far fewer style recalcs while flinging
    const coarse = window.matchMedia('(hover: none), (max-width: 760px)').matches;
    const step = coarse ? 0.025 : 0.0005;
    const last = new WeakMap<HTMLElement, number[]>();
    // consumers of --v (velocity): story backdrop, hero title, section titles; re-collected every 2 s
    // because sections mount lazily
    let velEls: HTMLElement[] = [], velAt = 0;
    const velTargets = () => {
      const now = performance.now();
      if (now - velAt > 2000) { velAt = now; velEls = Array.from(document.querySelectorAll<HTMLElement>('.story-bg, .hero h1, .sec .sec-head .h2')); }
      return velEls;
    };
    const lbEls = Array.from(document.querySelectorAll<HTMLElement>('.lb'));
    const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      lenis.raf(t);
      if (reduce) return;
      const vh = window.innerHeight;
      // read every rect first, then write: interleaving forces a layout per section
      const secs = document.querySelectorAll<HTMLElement>('main > section');
      const rects = Array.from(secs, (s) => s.getBoundingClientRect());
      secs.forEach((s, i) => {
        const r = rects[i];
        if (r.bottom < -vh || r.top > vh * 2) return;
        const v = [clamp((vh - r.top) / (vh + r.height)), clamp((vh - r.top) / (vh * 0.65)), clamp(-r.top / Math.max(1, r.height))];
        if (s.id) scrollP[s.id] = v[0];
        // Every write restyles the whole section subtree. Phones keep only the entrance (--e, settles
        // at 1) and the hero dolly (--x); parallax (--p) stays parked at .5.
        if (coarse) { v[0] = 0.5; if (i > 0) v[2] = 0; }
        const prev = last.get(s);
        if (prev && Math.abs(prev[0] - v[0]) < step && Math.abs(prev[1] - v[1]) < step && Math.abs(prev[2] - v[2]) < step
          && !(v[1] === 1 && prev[1] !== 1) && !(v[1] === 0 && prev[1] !== 0)) return;
        last.set(s, v);
        s.style.setProperty('--p', v[0].toFixed(4));
        s.style.setProperty('--e', v[1].toFixed(4));
        s.style.setProperty('--x', v[2].toFixed(4));
      });
      const v = Math.min(1, Math.abs(lenis.velocity || 0) / 60);
      vel += (v - vel) * 0.12;
      lb += ((vel > 0.35 ? 1 : 0) - lb) * 0.06;
      const vs = vel.toFixed(coarse ? 2 : 3), ls = lb.toFixed(coarse ? 2 : 3);
      // Written only on the few elements that read them: a custom property on :root restyles the whole
      // document (that was ~13 ms per frame on a phone while scrolling).
      if (vs !== lastV) { lastV = vs; for (const el of velTargets()) el.style.setProperty('--v', vs); }
      if (ls !== lastLb) { lastLb = ls; for (const el of lbEls) el.style.setProperty('--lb', ls); }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); delete window.__lenis; };
  }, []);

  return (
    <>
      <div className="lb lb-top" aria-hidden />
      <div className="lb lb-bot" aria-hidden />
    </>
  );
}
