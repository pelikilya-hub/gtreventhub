'use client';
import { useEffect } from 'react';

const KEYS = '.btn, a.chip, button.chip, .seg button, .key';

/**
 * BMW climate-panel keys (styles: hub.css «BMW E36 / E39 / E46 climate keys»), by delegation:
 * - ignition: the first time a key scrolls into view its backlight flickers on, keys that appear
 *   together light up one after another (like the dash after the ignition key turns);
 * - press: CSS :active moves the key down; iOS only applies :active with a touch listener present,
 *   Android gets a short haptic tick.
 */
export function ButtonFX() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seen = new WeakSet<Element>();
    let batch = 0, batchT = 0;
    const io = reduce ? null : new IntersectionObserver((es) => {
      const now = performance.now();
      if (now - batchT > 400) batch = 0;
      batchT = now;
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        io!.unobserve(el);
        el.style.setProperty('--ign-d', Math.min(batch++, 8) * 70 + 'ms');
        el.classList.add('ign');
        el.addEventListener('animationend', () => { el.classList.remove('ign'); el.style.removeProperty('--ign-d'); }, { once: true });
      }
    }, { threshold: 0.6 });
    const scan = (root: ParentNode) => {
      if (!io) return;
      root.querySelectorAll(KEYS).forEach((k) => { if (!seen.has(k)) { seen.add(k); io.observe(k); } });
    };
    scan(document);
    let pending = 0;
    const mo = new MutationObserver(() => { if (!pending) pending = window.setTimeout(() => { pending = 0; scan(document); }, 250); });
    mo.observe(document.body, { childList: true, subtree: true });

    const onTouch = () => {};
    const onDown = (e: PointerEvent) => {
      const k = (e.target as HTMLElement | null)?.closest?.(KEYS) as HTMLButtonElement | null;
      if (!k || k.disabled) return;
      if (e.pointerType === 'touch' && 'vibrate' in navigator) try { navigator.vibrate(8); } catch { /* ignore */ }
    };
    document.addEventListener('touchstart', onTouch, { passive: true });
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      io?.disconnect(); mo.disconnect(); window.clearTimeout(pending);
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);
  return null;
}
