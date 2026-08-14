// PromptPay: сборка EMVCo-payload для тайского QR-платежа. Деньги идут
// напрямую на счёт получателя (телефон / Tax ID / e-wallet) — без
// эквайринга и посредников. Алгоритм — открытый стандарт EMV QRCPS.

const tlv = (id: string, value: string) =>
  id + String(value.length).padStart(2, "0") + value;

// CRC16/CCITT-FALSE — обязательное поле 63 в конце payload
const crc16 = (s: string): string => {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

// Тип получателя по виду идентификатора: телефон (10 цифр, 0…),
// Tax ID / национальный ID (13 цифр), e-wallet (15 цифр)
const proxy = (raw: string): { sub: string; value: string } => {
  const d = raw.replace(/[^\d]/g, "");
  if (d.length === 13) return { sub: "02", value: d };
  if (d.length === 15) return { sub: "03", value: d };
  // телефон: 0812345678 → 0066812345678
  const ph = d.replace(/^0/, "");
  return { sub: "01", value: `0066${ph}`.padStart(13, "0") };
};

export const promptpayPayload = (target: string, amountThb?: number): string => {
  const p = proxy(target);
  const merchant = tlv("00", "A000000677010111") + tlv(p.sub, p.value);
  // порядок полей — как в боевой реализации dtinth/promptpay-qr,
  // которую гарантированно читают банковские приложения Таиланда
  let body =
    tlv("00", "01") + // формат
    tlv("01", amountThb ? "12" : "11") + // динамический / многоразовый
    tlv("29", merchant) +
    tlv("58", "TH") +
    tlv("53", "764") + // THB
    (amountThb && amountThb > 0 ? tlv("54", amountThb.toFixed(2)) : "");
  body += "6304";
  return body + crc16(body);
};
