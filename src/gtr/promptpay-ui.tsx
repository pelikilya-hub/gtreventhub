// Модал оплаты PromptPay: сумма → QR, который сканируется любым тайским
// банковским приложением. Деньги идут напрямую на реквизит из настроек BOSS.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toDataURL } from "qrcode";
import { useTranslation } from "react-i18next";

import { promptpayPayload } from "./promptpay";
import { Eyebrow } from "./ui";
import type { PromptpayCfg } from "./kv-api";

export function PromptpayModal({
  cfg,
  title,
  defaultAmount,
  onClose,
}: {
  cfg: PromptpayCfg;
  title: string;
  defaultAmount?: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState<number>(defaultAmount ?? 0);
  const [qr, setQr] = useState<string>("");

  useEffect(() => {
    const payload = promptpayPayload(cfg.id, amount > 0 ? amount : undefined);
    toDataURL(payload, { margin: 1, width: 320, color: { dark: "#0A0B0D", light: "#FFFFFF" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [cfg.id, amount]);

  // портал на body: у контента приложения есть transform-анимации,
  // внутри которых position:fixed перестаёт быть фиксированным
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(6,7,9,.82)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(360px, 94vw)",
          background: "var(--gtr-bg2, #101114)",
          border: "1px solid rgba(255,255,255,.14)",
          padding: "20px 22px 22px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <Eyebrow>PROMPTPAY</Eyebrow>
          <button
            onClick={onClose}
            className="gtr-mono"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "rgba(255,255,255,.5)",
              cursor: "pointer",
              font: "700 13px/1 'JetBrains Mono',monospace",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ font: "600 13px/1.5 'Golos Text',sans-serif", marginBottom: 10 }}>{title}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input
            className="gtr-input"
            style={{ flex: 1 }}
            type="number"
            min={0}
            step={50}
            value={amount || ""}
            placeholder={t("Сумма, ฿ (можно пустую)")}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <span className="gtr-mono" style={{ font: "700 12px/1 'JetBrains Mono',monospace" }}>
            THB
          </span>
        </div>
        {qr ? (
          <img
            src={qr}
            alt="PromptPay QR"
            style={{ width: "100%", display: "block", border: "6px solid #fff" }}
          />
        ) : null}
        <div
          style={{
            marginTop: 10,
            font: "500 13px/1.5 'Golos Text',sans-serif",
            color: "var(--gtr-t2)",
          }}
        >
          {t("Получатель")}: {cfg.name || "GTR Event"}
        </div>
        <div
          className="gtr-mono"
          style={{
            marginTop: 6,
            font: "500 11px/1.5 'JetBrains Mono',monospace",
            color: "var(--gtr-t3)",
          }}
        >
          {t("Отсканируйте QR в приложении вашего банка (SCB, Kasikorn, Bangkok Bank…). Платёж уходит напрямую получателю.")}
        </div>
      </div>
    </div>,
    document.body,
  );
}
