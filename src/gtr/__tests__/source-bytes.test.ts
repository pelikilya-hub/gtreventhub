// В исходниках не должно быть сырых управляющих байтов.
//
// В tools.ts регулярка для чистки текста была записана НАСТОЯЩИМИ байтами
// 0x00, 0x1F и 0x7F вместо escape-последовательностей. На поведении это не
// сказывалось никак — символьный класс получался тот же, — а вот git из-за
// одного NUL считал файл бинарным. Последствия вылезли только при слиянии:
// «Cannot merge binary files», конфликт всего файла целиком, без единого
// маркера. Ни diff, ни blame, ни ревью по строкам на таком файле не
// работают, и заметить это можно было только уперевшись.
//
// После замены на \x00 файл стал текстом, и то же слияние прошло без
// единого конфликта.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const files = execSync("git ls-files '*.ts' '*.tsx' '*.json' '*.md'", {
  cwd: new URL("../../..", import.meta.url).pathname,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

describe("исходники — текст, а не двоичные данные", () => {
  it("ни одного сырого управляющего байта", () => {
    const root = new URL("../../../", import.meta.url).pathname;
    const dirty: string[] = [];
    for (const f of files) {
      const b = readFileSync(root + f);
      for (const byte of b) {
        // Табуляция, перевод строки и возврат каретки — законные.
        if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
          dirty.push(f);
          break;
        }
      }
    }
    expect(dirty).toEqual([]);
  });
});
