'use client';
import { HubProvider } from '@/lib/HubContext';
import { VendorScripts } from '@/components/VendorScripts';
import { Boot } from '@/components/Boot';
import { Toast } from '@/components/Toast';
import { Topbar } from '@/components/Topbar';
import { AuthModal } from '@/components/AuthModal';
import { Hero } from '@/components/Hero';
import { RouteSection } from '@/components/RouteSection';
import { LiveSection } from '@/components/LiveSection';
import { Cars } from '@/components/Cars';
import { Rig } from '@/components/Rig';
import { Realty } from '@/components/Realty';
import { RouteEvents } from '@/components/RouteEvents';
import { Logbook } from '@/components/Logbook';
import { Tiers } from '@/components/Tiers';
import { Scales } from '@/components/Scales';
import { Crew } from '@/components/Crew';
import { GtrReality } from '@/components/GtrReality';
import { ContentLines } from '@/components/ContentLines';
import { Places } from '@/components/Places';
import { Invite } from '@/components/Invite';
import { Sponsors } from '@/components/Sponsors';
import { AudioBar } from '@/components/AudioBar';
import { Footer } from '@/components/Footer';
import { RevealObserver } from '@/components/ui/Motion';
import { StoryBackdrop } from '@/components/fx/StoryBackdrop';
import { SfxBinder } from '@/components/fx/SfxBinder';
import { ScrollFX } from '@/components/fx/ScrollFX';
import { ButtonFX } from '@/components/fx/ButtonFX';
import { AppInstall } from '@/components/AppInstall';
import { AgeGate } from '@/components/AgeGate';

// Client-only (app/page.tsx loads it with ssr:false): everything here is live —
// countdown, GPS, chat, shared state — and has no SEO value server-rendered.
export default function HomeClient() {
  return (
    <HubProvider>
      <VendorScripts />
      <RevealObserver />
      <SfxBinder />
      <ScrollFX />
      <ButtonFX />
      <StoryBackdrop />
      <div className="hub">
        <Boot />
        <Toast />
        <Topbar />
        <AuthModal />
        <main>
          <Hero />
          <RouteSection />
          <RouteEvents />
          <Rig />
          <LiveSection />
          <Cars />
          <Realty />
          <ContentLines />
          <Scales />
          <Places />
          <Logbook />
          <GtrReality />
          <Crew />
          <Tiers />
          <Invite />
          <Sponsors />
        </main>
        <Footer />
        <AudioBar />
        <AppInstall />
        <AgeGate />
      </div>
    </HubProvider>
  );
}
