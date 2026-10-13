'use client';
import { useEffect, useState } from 'react';

const KEY = 'gtrpht_age_ok';

/**
 * 18+ gate: the stream has strong language and adult content. Shown once per device on the first visit
 * (the answer is remembered); "нет 18" closes the site for this session. Full-bleed scene, climate-panel keys.
 */
export function AgeGate() {
  const [state, setState] = useState<'ok' | 'ask' | 'no'>('ok');

  useEffect(() => {
    let ok = false;
    try { ok = localStorage.getItem(KEY) === '1'; } catch { /* private mode: ask every time */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the answer lives in localStorage, unknown during SSR
    if (!ok) setState(sessionStorageNo() ? 'no' : 'ask');
  }, []);

  useEffect(() => {
    const open = state !== 'ok';
    document.documentElement.classList.toggle('age-locked', open);
    if (open) window.__lenis?.stop(); else window.__lenis?.start();
    return () => { document.documentElement.classList.remove('age-locked'); };
  }, [state]);

  if (state === 'ok') return null;
  const yes = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setState('ok'); };
  const no = () => { try { sessionStorage.setItem(KEY, '0'); } catch { /* ignore */ } setState('no'); };

  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-t">
      <div className="age-in">
        <div className="age-18" aria-hidden>18+</div>
        {state === 'ask' ? (
          <>
            <h2 id="age-t" className="age-t">Только для взрослых</h2>
            <p className="age-p">Прямой эфир без цензуры: нецензурная брань, алкоголь, ночные вечеринки и контент для лиц старше 18 лет.</p>
            <div className="age-keys">
              <button className="key on" onClick={yes}>Мне есть 18</button>
              <button className="key" onClick={no}>Мне нет 18</button>
            </div>
            <p className="age-s">Нажимая «Мне есть 18», ты подтверждаешь свой возраст. Ответ запомнится на этом устройстве.</p>
          </>
        ) : (
          <>
            <h2 id="age-t" className="age-t">Возвращайся позже</h2>
            <p className="age-p">Этот эфир — только для тех, кому исполнилось 18.</p>
          </>
        )}
      </div>
    </div>
  );
}

function sessionStorageNo() {
  try { return sessionStorage.getItem(KEY) === '0'; } catch { return false; }
}
