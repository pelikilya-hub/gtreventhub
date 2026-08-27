// Разбор скрипта мозга на домашнем GPU.
//
// Скрипт исполняется на чужой машине, куда мы не заглядываем: единственный
// отчёт о нём — слова BOSS «запустил, не работает». 26.08.2026 он неделю
// не запускался вовсе из-за незакрытой кавычки: PowerShell разбирает файл
// целиком до первой команды, поэтому опечатка в середине не ломает часть
// работы — она отменяет её всю. Снаружи это неотличимо от выключенного
// компьютера. Дешёвый разбор здесь ловит ровно этот класс опечаток.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  new URL("../../../infra/bro-brain/gpu/setup-brain-gpu.ps1", import.meta.url),
  "utf8",
);
/** Тело без метки порядка байтов — её наличие проверяется отдельно. */
const src = raw.replace(/^\uFEFF/, "");

type State = "code" | "sq" | "dq" | "line" | "block" | "hereSq" | "hereDq";

type Scan = {
  state: State;
  /** Строка, на которой открылось незакрытое — по ней и ищут опечатку. */
  openedAt: number;
  depth: { curly: number; paren: number; square: number };
  /** Первая закрывающая скобка, которой нечего закрывать. */
  extra: string;
};

// Разбор ровно той глубины, какая нужна для вопроса «файл вообще
// дочитывается до конца». Не эмулятор PowerShell: приоритет — не путаться
// в кавычках внутри комментариев и в скобках внутри строк.
const scan = (text: string): Scan => {
  const depth = { curly: 0, paren: 0, square: 0 };
  const open: Record<string, keyof typeof depth> = {
    "{": "curly",
    "(": "paren",
    "[": "square",
  };
  const close: Record<string, keyof typeof depth> = {
    "}": "curly",
    ")": "paren",
    "]": "square",
  };
  let state: State = "code";
  let openedAt = 0;
  let extra = "";
  let line = 1;
  const atLineStart = (i: number) => i === 0 || text[i - 1] === "\n";

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "\n") line++;

    if (state === "line") {
      if (c === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (c === "#" && next === ">") {
        state = "code";
        i++;
      }
      continue;
    }
    if (state === "hereDq" || state === "hereSq") {
      const mark = state === "hereDq" ? '"' : "'";
      if (atLineStart(i) && c === mark && next === "@") {
        state = "code";
        i++;
      }
      continue;
    }
    if (state === "dq") {
      if (c === "`") i++;
      else if (c === '"' && next === '"') i++;
      else if (c === '"') state = "code";
      continue;
    }
    if (state === "sq") {
      if (c === "'" && next === "'") i++;
      else if (c === "'") state = "code";
      continue;
    }

    // state === "code"
    if (c === "`") {
      i++;
      continue;
    }
    if (c === "<" && next === "#") {
      state = "block";
      openedAt = line;
      i++;
      continue;
    }
    if (c === "#") {
      state = "line";
      continue;
    }
    if (c === "@" && (next === '"' || next === "'")) {
      state = next === '"' ? "hereDq" : "hereSq";
      openedAt = line;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      state = c === '"' ? "dq" : "sq";
      openedAt = line;
      continue;
    }
    if (open[c]) depth[open[c]]++;
    else if (close[c]) {
      depth[close[c]]--;
      if (depth[close[c]] < 0 && !extra) extra = `${c} на строке ${line}`;
    }
  }
  return { state, openedAt, depth, extra };
};

describe("скрипт мозга на домашнем GPU", () => {
  const s = scan(src);

  it("дочитывается до конца: ни одной незакрытой кавычки", () => {
    // Пустая строка в ожидании — чтобы падение называло строку файла,
    // а не сообщало «true не равно false».
    const unclosed =
      s.state === "code" ? "" : `${s.state}, открыто на строке ${s.openedAt}`;
    expect(unclosed).toBe("");
  });

  it("скобки сходятся", () => {
    expect(s.extra).toBe("");
    expect(s.depth).toEqual({ curly: 0, paren: 0, square: 0 });
  });

  it("ловит ту самую опечатку, ради которой написан", () => {
    const broken = src.replace(
      'Write-Host ">> Видеопамять: $vram МБ -> слотов $slots, контекст $ctx"',
      'Write-Host ">> Видеопамять: $vram МБ -> слотов $slots, контекст $ctx',
    );
    expect(broken).not.toBe(src);
    expect(scan(broken).state).not.toBe("code");
  });

  // Windows PowerShell 5.1 читает .ps1 как ANSI (cp1251), если нет метки
  // порядка байтов. Кириллица тогда рассыпается — само по себе полбеды, но
  // тире «—» в UTF-8 это байты E2 80 94, а байт 94 в cp1251 — это символ
  // «”», настоящая закрывающая кавычка. Она обрывает строку, и разбор
  // валится каскадом. 27.08.2026 скрипт ровно так и не запустился у BOSS.
  it("начинается с метки UTF-8 — иначе PowerShell 5.1 прочтёт его как cp1251", () => {
    expect(raw.charCodeAt(0)).toBe(0xfeff);
  });

  // llama-server, запущенный из-под другой учётной записи, не убивается:
  // прямой Stop-Process бросает «Отказано в доступе», и при
  // $ErrorActionPreference = "Stop" на этом падал весь скрипт.
  it("чужой процесс не роняет скрипт", () => {
    const raw = src.split("\n").filter((l) => /Stop-Process\s+-(?:Name|Id)/.test(l));
    for (const line of raw) {
      const safe =
        /-ErrorAction (?:Stop|SilentlyContinue)/.test(line) || line.includes("Write-Host");
      expect(`${line} :: защищён=${safe}`).toContain("защищён=true");
    }
    // Остановка своих процессов идёт одной функцией, которая переживает отказ.
    expect(src).toContain("function Stop-Brain");
  });

  it("параметры объявлены до первой команды", () => {
    const code = src
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(code[0]).toBe("param(");
  });

  // Флаги, каждый из которых уже отсутствовал и стоил отдельного разбора.
  it("сервер поднимается с инструментами и под токеном", () => {
    expect(src).toContain('"--jinja"');
    expect(src).toContain('"--api-key", $token');
    expect(src).toContain('"--parallel", "$slots"');
  });

  it("адрес уезжает в продукт сам, а не через человека", () => {
    expect(src).toContain('action = "pult.brain"');
    // Адрес меняется у quick-туннеля молча — присмотр обязан его заметить.
    expect(src).toContain("Get-TunnelUrl");
  });

  it("постоянным адрес зовётся только с живой DNS-записью", () => {
    // tunnel create проходит и без зоны в Cloudflare, поэтому наличие
    // туннеля ничего не доказывает — доказывает только резолв имени.
    expect(src).toMatch(/if\s*\(Test-PublicDns \$brainHost\)\s*\{\s*\$named = \$true/);
    // И ни одного другого места, где адрес объявляется постоянным.
    expect((src.match(/\$named = \$true/g) ?? []).length).toBe(1);
  });

  // cloudflared пишет обычный лог в stderr, а при $ErrorActionPreference
  // = "Stop" перенаправление 2>&1 делает из такой строки терминирующую
  // ошибку. 27.08.2026 скрипт так упал на «INF Added CNAME …» — то есть
  // на сообщении об УСПЕХЕ.
  it("cloudflared зовётся только через обёртку, гасящую stderr", () => {
    const direct = src.match(/&\s*\$cf\s+\S/g) ?? [];
    // Единственное допустимое прямое обращение — внутри самой обёртки.
    expect(direct.length).toBe(1);
    expect(src).toContain('$ErrorActionPreference = "Continue"');
  });
});
