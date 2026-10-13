'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useHub } from '@/lib/HubContext';
import { onSfxChange, setSfxEnabled, sfxEnabled, unlockSfx } from '@/lib/sfx';

export function Topbar() {
  const { t, lang, setLang, journey, auth, openAuth } = useHub();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [snd, setSnd] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the stored preference once
    setSnd(sfxEnabled());
    return onSfxChange(setSnd);
  }, []);
  const ru = lang === 'ru';
  const live = journey.phase === 'live';

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = menu ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menu]);

  const status = journey.phase === 'live'
    ? (ru ? 'ДЕНЬ ' : 'DAY ') + journey.day + '/' + journey.totalDays
    : journey.phase === 'countdown' ? 'T-' + journey.cd.d + (ru ? ' ДН' : 'D')
      : journey.phase === 'done' ? t.statusDone : t.statusSoon;
  const me = auth.me;

  return (
    <>
      <header className={'top' + (scrolled ? ' scrolled' : '')}>
        <div className="top-in">
          <a href="#top" className="logo" onClick={() => setMenu(false)}>BANGTAOSTYLE<i>.COM</i></a>
          <nav className="nav">
            {t.nav.map(([id, label]) => <a key={id} href={'#' + id}>{label}</a>)}
          </nav>
          <div className="top-sp" />
          <span className="chip" title={journey.datesLabel}>
            <span className={'dot' + (live ? ' live' : '')} />
            {live ? 'LIVE · ' : ''}{status}
          </span>
          <div className="seg hide-sm" style={{ padding: 3 }}>
            <button className={ru ? 'on' : ''} onClick={() => setLang('ru')} style={{ height: 30, minHeight: 30, padding: '0 10px' }}>RU</button>
            <button className={!ru ? 'on' : ''} onClick={() => setLang('en')} style={{ height: 30, minHeight: 30, padding: '0 10px' }}>EN</button>
          </div>
          <button className="chip hide-sm" style={{ cursor: 'pointer', height: 30 }} title={ru ? 'Звуки интерфейса' : 'UI sounds'} onClick={() => { unlockSfx(); setSfxEnabled(!snd); }}><span className={'sfx-ico' + (snd ? ' on' : '')} aria-hidden />{ru ? 'ЗВУКИ' : 'SFX'}</button>
          <button className="btn btn-sm hide-sm" onClick={() => openAuth()} style={{ minHeight: 38 }}>
            {me ? me.nick.toUpperCase().slice(0, 12) : ru ? 'Войти' : 'Sign in'}
          </button>
          <button className="burger" aria-label="menu" onClick={() => setMenu((v) => !v)}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
              {menu ? <path d="M3 3l12 12M15 3L3 15" /> : <path d="M2 5h14M2 9h14M2 13h14" />}
            </svg>
          </button>
        </div>
      </header>
      {menu && (
        <div className="sheet" onClick={() => setMenu(false)}>
          {t.nav.map(([id, label]) => <a key={id} href={'#' + id}>{label}</a>)}
          <a href="#" onClick={(e) => { e.preventDefault(); setMenu(false); openAuth(); }}>{me ? me.nick : ru ? 'Войти' : 'Sign in'}</a>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }} onClick={(e) => e.stopPropagation()}>
            <div className="seg">
              <button className={ru ? 'on' : ''} onClick={() => setLang('ru')}>RU</button>
              <button className={!ru ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            </div>
            <button className="chip" style={{ height: 38, cursor: 'pointer' }} onClick={() => { unlockSfx(); setSfxEnabled(!snd); }}>{ru ? 'Звук' : 'Sound'}</button>
          </div>
          <Link href="/console/" style={{ fontSize: 18, color: 'var(--red-2)', border: 0, marginTop: 18 }}>{ru ? 'Консоль экипажа →' : 'Crew console →'}</Link>
        </div>
      )}
    </>
  );
}
