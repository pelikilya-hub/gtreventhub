// Паспорт площадки берётся из её собственной разметки, а не сочиняется.
import { describe, expect, it } from "vitest";

import { factsFromHtml, looksLocal, readAddress, readHours } from "../venue-harvest";

const wrap = (obj: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body>x</body></html>`;

const NOW = "2026-08-27";
const SRC = "https://example.com";

describe("часы из разметки", () => {
  it("читает строковый формат", () => {
    // Диапазон дней разворачивается: Mo-Th это пн ПО чт.
    expect(readHours({ openingHours: ["Mo-Th 18:00-02:00", "Fr-Sa 18:00-04:00"] })).toBe(
      "пн–чт 18:00–02:00; пт, сб 18:00–04:00",
    );
  });

  it("читает объектный формат и переводит дни", () => {
    const h = readHours({
      openingHoursSpecification: [
        { dayOfWeek: ["Friday", "Saturday"], opens: "18:00:00", closes: "04:00:00" },
      ],
    });
    expect(h).toBe("пт, сб 18:00–04:00");
  });

  it("одинаковое расписание всю неделю не перечисляет семь раз", () => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const h = readHours({
      openingHoursSpecification: days.map((d) => ({
        dayOfWeek: [d],
        opens: "11:00:00",
        closes: "23:00:00",
      })),
    });
    expect(h).toBe("11:00–23:00 · ежедневно");
  });

  it("вся неделя одним узлом тоже становится «ежедневно»", () => {
    // Так пишет большинство сайтов: один объект, семь дней в dayOfWeek.
    // Раньше это попадало в паспорт перечислением всех семи — читалось
    // как выгрузка, а не как ответ.
    const h = readHours({
      openingHoursSpecification: [
        {
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          opens: "11:00:00",
          closes: "23:30:00",
        },
      ],
    });
    expect(h).toBe("11:00–23:30 · ежедневно");
  });

  it("подряд идущие дни в объектном формате сворачиваются в диапазон", () => {
    expect(
      readHours({
        openingHoursSpecification: [
          { dayOfWeek: ["Wednesday", "Monday", "Tuesday"], opens: "18:00:00", closes: "02:00:00" },
        ],
      }),
    ).toBe("пн–ср 18:00–02:00");
  });

  it("без часов возвращает ничего, а не пустую строку", () => {
    expect(readHours({})).toBeUndefined();
  });
});

describe("адрес", () => {
  it("собирается из частей", () => {
    expect(
      readAddress({
        address: { streetAddress: "118 Moo 3", addressLocality: "Kamala", addressRegion: "Phuket" },
      }),
    ).toBe("118 Moo 3, Kamala, Phuket");
  });

  it("готовая строка берётся как есть", () => {
    expect(readAddress({ address: "  Patong Beach Road  " })).toBe("Patong Beach Road");
  });
});

describe("паспорт со страницы", () => {
  it("собирает то, что площадка опубликовала о себе", () => {
    const html = wrap({
      "@type": "NightClub",
      name: "Test Club",
      telephone: "+66 76 000 000",
      email: "mailto:book@test.com",
      address: { streetAddress: "1 Beach Rd", addressLocality: "Patong" },
      openingHoursSpecification: [
        { dayOfWeek: ["Friday"], opens: "21:00:00", closes: "04:00:00" },
      ],
    });
    const f = factsFromHtml(html, SRC, NOW);
    expect(f).not.toBeNull();
    expect(f!.hours).toBe("пт 21:00–04:00");
    expect(f!.address).toBe("1 Beach Rd, Patong");
    expect(f!.phone).toBe("+6676000000");
    expect(f!.email).toBe("book@test.com");
    // Без источника факт непроверяем, а значит бесполезен.
    expect(f!.source).toBe(SRC);
    expect(f!.fetchedAt).toBe(NOW);
  });

  it("из нескольких узлов берёт самый содержательный", () => {
    const html =
      wrap({ "@type": "Organization", name: "Holding" }) +
      wrap({
        "@type": "Restaurant",
        name: "Real Venue",
        telephone: "+66 76 111 111",
        openingHours: "Mo-Su 11:00-23:00",
      });
    const f = factsFromHtml(html, SRC, NOW);
    expect(f!.hours).toBe("11:00–23:00 · ежедневно");
    expect(f!.phone).toBe("+6676111111");
  });

  it("страница без разметки площадки не даёт ничего", () => {
    expect(factsFromHtml("<html><body>Добро пожаловать</body></html>", SRC, NOW)).toBeNull();
    // Разметка есть, но это статья, а не заведение.
    expect(factsFromHtml(wrap({ "@type": "Article", name: "Про нас" }), SRC, NOW)).toBeNull();
  });

  it("битая разметка не роняет разбор", () => {
    const html = `<script type="application/ld+json">{сломано</script>` +
      wrap({ "@type": "Bar", telephone: "+66 76 222 222" });
    expect(factsFromHtml(html, SRC, NOW)!.phone).toBe("+6676222222");
  });

  it("обрывок вместо телефона отбрасывается", () => {
    const f = factsFromHtml(wrap({ "@type": "Bar", telephone: "123", openingHours: "Mo 10:00-12:00" }), SRC, NOW);
    expect(f!.phone).toBeUndefined();
  });
});

describe("качество важнее полноты", () => {
  it("перечень дней без времени часами не считается", () => {
    // Так публикуют реальные сайты: дни есть, времени нет. В паспорте
    // площадки такая строка выглядит как знание, а пользы в ней ноль.
    expect(readHours({ openingHours: "Monday,Tuesday,Wednesday,Thursday,Friday" })).toBeUndefined();
    expect(readHours({ openingHours: ["Mo-Su"] })).toBeUndefined();
  });

  it("а со временем — считается", () => {
    expect(readHours({ openingHours: "Mo-Su 11:00-23:00" })).toBe("11:00–23:00 · ежедневно");
  });
});

describe("часы приводятся к одному виду", () => {
  it("полные английские дни становятся короткими русскими", () => {
    expect(readHours({ openingHours: "Monday,Tuesday,Wednesday,Thursday,Friday 18:00-02:00" })).toBe(
      "пн–пт 18:00–02:00",
    );
  });

  it("разрозненные дни остаются списком", () => {
    expect(readHours({ openingHours: "Mo,We,Fr 18:00-02:00" })).toBe("пн, ср, пт 18:00–02:00");
  });

  it("все семь дней сворачиваются в «ежедневно»", () => {
    expect(
      readHours({
        openingHours: "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday 0:00-03:00",
      }),
    ).toBe("00:00–03:00 · ежедневно");
  });

  it("круглые сутки называются словом, а не диапазоном", () => {
    // 00:00-23:59 — это «работает всегда», и читать его как расписание
    // значит показывать гостю мусор вместо факта.
    expect(readHours({ openingHours: "Mo-Su 00:00-23:59" })).toBe("круглосуточно");
  });

  it("одинаковые строки не повторяются", () => {
    expect(
      readHours({ openingHours: ["Mo 10:00-20:00", "Tu 10:00-20:00"] }),
    ).toBe("пн 10:00–20:00; вт 10:00–20:00");
  });
});

describe("чужое не выдаём за своё", () => {
  it("разметка головного офиса сети отбрасывается целиком", () => {
    // Hard Rock на общем домене публикует адрес и телефон Флориды.
    // Взять оттуда часы — значит отправить гостя в закрытую дверь.
    const html = wrap({
      "@type": "Restaurant",
      name: "Hard Rock Cafe",
      telephone: "+1 800 201 1949",
      address: { streetAddress: "5701 Stirling Road", addressLocality: "Davie", addressRegion: "FL", postalCode: "33314" },
      openingHours: "Mo-Su 11:00-23:00",
    });
    expect(factsFromHtml(html, SRC, NOW)).toBeNull();
  });

  it("адрес Пхукета проходит, а чужой — нет", () => {
    expect(looksLocal("1 Beach Rd, Patong")).toBe(true);
    expect(looksLocal("18/40 Moo 6, Nakalay Road, Kamala")).toBe(true);
    expect(looksLocal("5701 Stirling Road, Davie, FL, 33314")).toBe(false);
    // Адреса нет — не повод выбрасывать часы и телефон.
    expect(looksLocal(undefined)).toBe(true);
  });
});

describe("телефон пригоден для звонка", () => {
  it("местный номер с ведущим нулём становится международным", () => {
    const f = factsFromHtml(wrap({ "@type": "Bar", telephone: "076 645 999", address: "Patong" }), SRC, NOW);
    expect(f!.phone).toBe("+6676645999");
  });

  it("лишний ноль после кода страны убирается", () => {
    const f = factsFromHtml(wrap({ "@type": "Bar", telephone: "+66 076 337 300", address: "Kamala" }), SRC, NOW);
    expect(f!.phone).toBe("+6676337300");
  });

  it("номер чужой страны не берём", () => {
    const f = factsFromHtml(wrap({ "@type": "Bar", telephone: "+1 800 201 1949", address: "Patong", openingHours: "Mo 10:00-12:00" }), SRC, NOW);
    expect(f!.phone).toBeUndefined();
  });
});

describe("ночь не разрезается полуночью", () => {
  it("две записи вокруг полуночи становятся одной сменой", () => {
    // Формат требует резать смену на 20:30–00:00 и 00:00–03:00.
    // Гостю нужно «с 20:30 до 03:00», а не два расписания.
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const h = readHours({
      openingHoursSpecification: [
        { dayOfWeek: days, opens: "00:00:00", closes: "03:00:00" },
        { dayOfWeek: days, opens: "20:30:00", closes: "00:00:00" },
      ],
    });
    expect(h).toBe("20:30–03:00 · ежедневно");
  });

  it("круглые сутки не склеиваются ни с чем", () => {
    expect(readHours({ openingHours: "Mo-Su 00:00-23:59" })).toBe("круглосуточно");
  });
});

describe("адрес без мусора", () => {
  it("хвост, уже сказанный в начале, не повторяется", () => {
    // Так отдаёт разметка: город и индекс есть и внутри улицы, и
    // отдельными полями. В паспорте это читается как наша ошибка.
    expect(
      readAddress({
        address: {
          streetAddress: "33/1 Taweewong Road, Patong Beach, Kathu, Phuket 83150, Thailand",
          addressLocality: "Phuket",
          postalCode: "83150",
        },
      }),
    ).toBe("33/1 Taweewong Road, Patong Beach, Kathu, Phuket 83150, Thailand");
  });

  it("повторы и пустые значения выбрасываются", () => {
    expect(
      readAddress({
        address: {
          streetAddress: "18/40 Moo 6, Kamala, Phuket",
          addressLocality: "Phuket",
          addressRegion: "18/40 Moo 6, Kamala, Phuket",
          postalCode: "None",
        },
      }),
    ).toBe("18/40 Moo 6, Kamala, Phuket");
  });
});
