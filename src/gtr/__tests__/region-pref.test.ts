// Рабочий регион переживает перезагрузку и совпадает на соседних экранах.
//
// Карта свой выбор помнила, база площадок — нет: она всегда открывалась
// на Пхукете. Менеджеру одного региона это стоило клика при каждом
// заходе и секунды сомнения «я в своём регионе или смотрю чужие
// площадки». Теперь памятью владеет один модуль, а экраны к нему ходят.
//
// Сторожим три вещи, каждая из которых уже ломалась в похожем коде:
// мусор в хранилище не должен ронять экран, исчезнувший код региона не
// должен открывать пустую базу, и запись региона не должна стирать
// выбранную категорию (и наоборот).
import { beforeEach, describe, expect, it } from "vitest";

import { loadRegion, loadTag, saveRegion, saveTag } from "../region-pref";
import { REGIONS } from "../data/app-data";

const KEY = "gtr-map-view";

/** Хранилище браузера на минимуме: ключ-значение и ничего больше. */
const fakeStorage = () => {
  const box = new Map<string, string>();
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => void box.set(k, v),
    removeItem: (k: string) => void box.delete(k),
    clear: () => box.clear(),
    key: (i: number) => [...box.keys()][i] ?? null,
    get length() {
      return box.size;
    },
  } as Storage;
};

describe("память рабочего региона", () => {
  beforeEach(() => {
    globalThis.localStorage = fakeStorage();
  });

  it("возвращает Пхукет, когда человек ещё ничего не выбирал", () => {
    expect(loadRegion(REGIONS)).toBe("phuket");
  });

  it("помнит выбранный регион", () => {
    saveRegion("smu");
    expect(loadRegion(REGIONS)).toBe("smu");
  });

  it("сохраняет только существующие коды регионов", () => {
    // Регион могли переименовать или убрать из продукта. Открыть базу на
    // коде, которого больше нет, — это пустой экран без объяснения.
    localStorage.setItem(KEY, JSON.stringify({ region: "atlantis" }));
    expect(loadRegion(REGIONS)).toBe("phuket");
  });

  it("не падает на мусоре в хранилище", () => {
    localStorage.setItem(KEY, "это не json");
    expect(loadRegion(REGIONS)).toBe("phuket");
    localStorage.setItem(KEY, "null");
    expect(loadRegion(REGIONS)).toBe("phuket");
  });

  it("регион и категория не стирают друг друга", () => {
    // Оба лежат в одном ключе. Наивная запись вида setItem({region})
    // обнуляла бы категорию, и на карте молча слетал бы фильтр.
    saveTag("Клубы");
    saveRegion("pty");
    expect(loadTag()).toBe("Клубы");
    expect(loadRegion(REGIONS)).toBe("pty");
    saveTag("Бары");
    expect(loadRegion(REGIONS)).toBe("pty");
  });

  it("работает там, где хранилища нет вовсе", () => {
    // Приватный режим Safari, выключенные куки, сервер при отрисовке:
    // доступ к localStorage бросает исключение. Выбор не запомнится —
    // это неприятно, но экран должен открыться.
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    globalThis.localStorage = broken;
    expect(loadRegion(REGIONS)).toBe("phuket");
    expect(() => saveRegion("smu")).not.toThrow();
  });
});
