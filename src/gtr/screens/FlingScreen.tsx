// GTR FLING — видео-рулетка тусовки.
//
// Видео и звук идут напрямую между телефонами по WebRTC; сервер видит
// только рукопожатие. Здесь нет записи и нет скриншотов с нашей стороны
// — и это не фича, а конструкция: медиапоток через нас не проходит.
//
// SDP уходит целиком, со всеми кандидатами (без trickle): рукопожатие —
// это ровно два сообщения, оффер и ответ, что позволяет жить на KV без
// очередей. Плата — пара лишних секунд на установку. Честная цена.

import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { useGtr } from "../store";
import { Card, Eyebrow, Stk } from "../ui";

type Phase = "gate" | "idle" | "searching" | "connecting" | "live" | "peer-left" | "error";

const API = "/api/gtr-fling";
const AGREE_KEY = "gtr-fling-agree";

const post = async (body: Record<string, unknown>) => {
  const r = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  return (await r.json()) as Record<string, unknown>;
};

/** Полный SDP: ждём конца сбора кандидатов, но не дольше трёх секунд —
 *  дальше едем с тем, что собралось (обычно этого достаточно). */
const fullSdp = (pc: RTCPeerConnection): Promise<string> =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve(pc.localDescription?.sdp ?? "");
      return;
    }
    const done = () => resolve(pc.localDescription?.sdp ?? "");
    const t = setTimeout(done, 3000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        done();
      }
    });
  });

export function FlingScreen() {
  const { t } = useTranslation();
  const { user } = useGtr();
  const [phase, setPhase] = useState<Phase>(
    typeof localStorage !== "undefined" && localStorage.getItem(AGREE_KEY) ? "idle" : "gate",
  );
  const [note, setNote] = useState("");
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<string>("");
  const stopRef = useRef(false);

  const cleanupCall = useCallback(() => {
    try {
      pcRef.current?.close();
    } catch {
      /* уже закрыт */
    }
    pcRef.current = null;
    if (remoteRef.current) remoteRef.current.srcObject = null;
  }, []);

  const fullStop = useCallback(() => {
    stopRef.current = true;
    if (roomRef.current) void post({ action: "leave", room: roomRef.current }).catch(() => {});
    roomRef.current = "";
    cleanupCall();
    for (const tr of mediaRef.current?.getTracks() ?? []) tr.stop();
    mediaRef.current = null;
    if (localRef.current) localRef.current.srcObject = null;
    setPhase("idle");
  }, [cleanupCall]);

  // Уход с экрана всегда гасит камеру: рулетка не живёт в фоне.
  useEffect(() => () => fullStop(), [fullStop]);

  const ensureMedia = async (): Promise<MediaStream | null> => {
    if (mediaRef.current) return mediaRef.current;
    try {
      const ms = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 1280 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaRef.current = ms;
      if (localRef.current) {
        localRef.current.srcObject = ms;
        localRef.current.muted = true;
        void localRef.current.play().catch(() => {});
      }
      return ms;
    } catch {
      setPhase("error");
      setNote(t("Камера закрыта. Разреши доступ в настройках браузера."));
      return null;
    }
  };

  const newPc = (ms: MediaStream) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
      ],
    });
    for (const tr of ms.getTracks()) pc.addTrack(tr, ms);
    pc.ontrack = (e) => {
      if (remoteRef.current && e.streams[0]) {
        remoteRef.current.srcObject = e.streams[0];
        void remoteRef.current.play().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setPhase("live");
      if (pc.connectionState === "failed") {
        setNote(t("Связь не пробилась — бывает на мобильных сетях. Жми «Дальше»."));
        setPhase("peer-left");
      }
    };
    pcRef.current = pc;
    return pc;
  };

  const search = useCallback(async () => {
    const ms = await ensureMedia();
    if (!ms) return;
    stopRef.current = false;
    cleanupCall();
    setNote("");
    setPhase("searching");

    const joined = await post({ action: "join" }).catch(() => null);
    if (!joined?.ok || stopRef.current) {
      if (!stopRef.current) {
        setPhase("error");
        setNote(t("Сервер не ответил. Попробуй ещё раз."));
      }
      return;
    }
    const room = String(joined.room);
    roomRef.current = room;

    if (joined.role === "offer") {
      // Мы пришли вторыми: собираем оффер и ждём ответ.
      setPhase("connecting");
      const pc = newPc(ms);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = await fullSdp(pc);
      await post({ action: "signal", room, sdp }).catch(() => {});
      for (let i = 0; i < 25 && !stopRef.current && roomRef.current === room; i++) {
        const p = (await post({ action: "poll", room }).catch(() => null)) as
          | { answer?: string | null; bye?: boolean; peerGone?: boolean; gone?: boolean }
          | null;
        if (!p || p.gone || p.bye || p.peerGone) break;
        if (p.answer) {
          await pc.setRemoteDescription({ type: "answer", sdp: p.answer });
          return; // дальше судьбу решает onconnectionstatechange
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (!stopRef.current && roomRef.current === room) {
        setNote(t("Собеседник сорвался. Ищем следующего?"));
        setPhase("peer-left");
      }
      return;
    }

    // Мы ждём: сидим в комнате, пока не прилетит оффер.
    for (let i = 0; i < 50 && !stopRef.current && roomRef.current === room; i++) {
      const p = (await post({ action: "poll", room }).catch(() => null)) as
        | { offer?: string | null; matched?: boolean; bye?: boolean; peerGone?: boolean; gone?: boolean }
        | null;
      if (!p || p.gone) break;
      if (p.offer) {
        setPhase("connecting");
        const pc = newPc(ms);
        await pc.setRemoteDescription({ type: "offer", sdp: p.offer });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        const sdp = await fullSdp(pc);
        await post({ action: "signal", room, sdp }).catch(() => {});
        // Присутствие продолжаем отмечать, пока не соединимся.
        for (let j = 0; j < 15 && pcRef.current === pc && pc.connectionState !== "connected"; j++) {
          await new Promise((r) => setTimeout(r, 1500));
          await post({ action: "poll", room }).catch(() => {});
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!stopRef.current && roomRef.current === room) {
      setNote(t("Пока никого. Народ подтянется ближе к вечеру."));
      setPhase("peer-left");
    }
  }, [cleanupCall, t]);

  // Пульс присутствия в живом разговоре + чуткость к «собеседник ушёл».
  useEffect(() => {
    if (phase !== "live") return;
    const id = window.setInterval(async () => {
      const room = roomRef.current;
      if (!room) return;
      const p = (await post({ action: "poll", room }).catch(() => null)) as
        | { bye?: boolean; peerGone?: boolean; gone?: boolean }
        | null;
      if (p && (p.bye || p.peerGone || p.gone)) {
        cleanupCall();
        setNote(t("Собеседник ушёл."));
        setPhase("peer-left");
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [phase, cleanupCall, t]);

  const next = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = "";
    cleanupCall();
    if (room) await post({ action: "leave", room }).catch(() => {});
    void search();
  }, [cleanupCall, search]);

  const report = useCallback(async () => {
    const room = roomRef.current;
    if (room) await post({ action: "report", room, reason: "user-report" }).catch(() => {});
    void next();
  }, [next]);

  // ------------------------------------------------------------- экраны

  if (phase === "gate")
    return (
      <div className="gtr-fling-gate">
        <Card>
          <Eyebrow>GTR FLING</Eyebrow>
          <div className="gtr-fling-gate-t">{t("Видео-рулетка тусовки")}</div>
          <div className="gtr-fling-rules">
            <p>{t("Случайные видео-встречи с теми, кто сегодня в движе. Камера в камеру, как на districts до эпохи лент.")}</p>
            <p>
              {t("Правила простые: тебе есть 18; без обнажёнки и агрессии; «Дальше» решает всё; жалоба уводит собеседника в разбор. Видео никуда не записывается — оно идёт напрямую между телефонами.")}
            </p>
          </div>
          <button
            className="gtr-fling-agree"
            onClick={() => {
              localStorage.setItem(AGREE_KEY, "1");
              setPhase("idle");
            }}
          >
            {t("Мне есть 18 — погнали")}
          </button>
        </Card>
      </div>
    );

  const live = phase === "live";
  const busy = phase === "searching" || phase === "connecting";

  return (
    <div className="gtr-fling">
      <div className="gtr-fling-stage">
        <video ref={remoteRef} className="gtr-fling-remote" playsInline autoPlay />
        <video ref={localRef} className="gtr-fling-self" playsInline autoPlay muted />
        {!live && (
          <div className="gtr-fling-veil">
            <Stk name="camera" />
            <div className="gtr-fling-status">
              {phase === "searching"
                ? t("Ищу, кто сегодня в эфире…")
                : phase === "connecting"
                  ? t("Соединяю…")
                  : phase === "peer-left"
                    ? note || t("Собеседник ушёл.")
                    : phase === "error"
                      ? note
                      : t("Жми «Старт» — и посмотрим, кто выходит сегодня.")}
            </div>
          </div>
        )}
      </div>

      <div className="gtr-fling-bar">
        {phase === "idle" || phase === "error" ? (
          <button className="gtr-fling-btn go" onClick={() => void search()}>
            {t("Старт")}
          </button>
        ) : (
          <>
            <button className="gtr-fling-btn go" disabled={busy && phase === "connecting"} onClick={() => void next()}>
              {t("Дальше")}
            </button>
            <button className="gtr-fling-btn" onClick={fullStop}>
              {t("Стоп")}
            </button>
            <button className="gtr-fling-btn danger" disabled={!live} onClick={() => void report()}>
              {t("Жалоба")}
            </button>
          </>
        )}
      </div>
      <div className="gtr-fling-hint">
        {t("Видео идёт напрямую между телефонами и не записывается.")}
        {user.role === "visitor" ? "" : " · " + t("Ты в эфире как гость GTR")}
      </div>
    </div>
  );
}
