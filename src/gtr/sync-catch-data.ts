// Синхронизация данных Catch: цены, фото, доступность столов
// Запускается вручную при обновлении, или раз в неделю кроном

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

interface CatchPrice {
  id: string;
  name: string;
  price: number;
  currency: string;
  section: string;
}

interface CatchPhoto {
  zone: string;
  type: "zone" | "table";
  id: string;
  url: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// Парсинг меню со страниц завтрака, обеда, ужина
async function syncMenuPrices(): Promise<CatchPrice[]> {
  const prices: CatchPrice[] = [];

  // Завтрак
  try {
    const breakfast = await fetchText("https://www.catchbeachclub.com/breakfast/");
    const breakfastItems = breakfast.match(/(?:breakfast|item)[^<]*?(?:(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:THB|บาท|B))/gi);
    if (breakfastItems) {
      // Примерный парсинг с регулярными выражениями
      const titles = breakfast.match(/<h[3-4][^>]*>([^<]+)<\/h[3-4]>/gi) || [];
      for (let i = 0; i < Math.min(titles.length, breakfastItems.length); i++) {
        const title = titles[i].replace(/<[^>]+>/g, "");
        const priceMatch = breakfastItems[i].match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          prices.push({
            id: `breakfast-${i}`,
            name: title,
            price: parseInt(priceMatch[1].replace(/,/g, ""), 10),
            currency: "THB",
            section: "breakfast",
          });
        }
      }
    }
  } catch (e) {
    console.log("Завтрак не спарсен:", String(e).slice(0, 50));
  }

  // Обед
  try {
    const lunch = await fetchText("https://www.catchbeachclub.com/lunch/");
    const lunchItems = lunch.match(/(?:dish|item)[^<]*?(?:(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:THB|บาท|B))/gi);
    if (lunchItems) {
      const titles = lunch.match(/<h[3-4][^>]*>([^<]+)<\/h[3-4]>/gi) || [];
      for (let i = 0; i < Math.min(titles.length, lunchItems.length); i++) {
        const title = titles[i].replace(/<[^>]+>/g, "");
        const priceMatch = lunchItems[i].match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          prices.push({
            id: `lunch-${i}`,
            name: title,
            price: parseInt(priceMatch[1].replace(/,/g, ""), 10),
            currency: "THB",
            section: "lunch",
          });
        }
      }
    }
  } catch (e) {
    console.log("Обед не спарсен:", String(e).slice(0, 50));
  }

  // Ужин
  try {
    const dinner = await fetchText("https://www.catchbeachclub.com/dinner/");
    const dinnerItems = dinner.match(/(?:course|item)[^<]*?(?:(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:THB|บาท|B))/gi);
    if (dinnerItems) {
      const titles = dinner.match(/<h[3-4][^>]*>([^<]+)<\/h[3-4]>/gi) || [];
      for (let i = 0; i < Math.min(titles.length, dinnerItems.length); i++) {
        const title = titles[i].replace(/<[^>]+>/g, "");
        const priceMatch = dinnerItems[i].match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (priceMatch) {
          prices.push({
            id: `dinner-${i}`,
            name: title,
            price: parseInt(priceMatch[1].replace(/,/g, ""), 10),
            currency: "THB",
            section: "dinner",
          });
        }
      }
    }
  } catch (e) {
    console.log("Ужин не спарсен:", String(e).slice(0, 50));
  }

  return prices;
}

// Поиск фотографий зон и столов
async function findCatchPhotos(): Promise<CatchPhoto[]> {
  const photos: CatchPhoto[] = [];

  try {
    const gallery = await fetchText("https://www.catchbeachclub.com/gallery/");

    // Фото зон: beach, pool, restaurant, bar
    const beachPhotos = gallery.match(/(?:beach|beachfront)[^<]*?src=["']([^"']+\.(?:jpg|png|webp))/gi);
    if (beachPhotos) {
      beachPhotos.slice(0, 3).forEach((url, i) => {
        const cleanUrl = url.match(/src=["']([^"']+)/)?.[1];
        if (cleanUrl) {
          photos.push({
            zone: "beachfront",
            type: "zone",
            id: `beachfront-${i}`,
            url: cleanUrl,
          });
        }
      });
    }

    const poolPhotos = gallery.match(/(?:pool|daybed)[^<]*?src=["']([^"']+\.(?:jpg|png|webp))/gi);
    if (poolPhotos) {
      poolPhotos.slice(0, 3).forEach((url, i) => {
        const cleanUrl = url.match(/src=["']([^"']+)/)?.[1];
        if (cleanUrl) {
          photos.push({
            zone: "pool",
            type: "zone",
            id: `pool-${i}`,
            url: cleanUrl,
          });
        }
      });
    }

    const restaurantPhotos = gallery.match(/(?:restaurant|dining)[^<]*?src=["']([^"']+\.(?:jpg|png|webp))/gi);
    if (restaurantPhotos) {
      restaurantPhotos.slice(0, 2).forEach((url, i) => {
        const cleanUrl = url.match(/src=["']([^"']+)/)?.[1];
        if (cleanUrl) {
          photos.push({
            zone: "restaurant",
            type: "zone",
            id: `restaurant-${i}`,
            url: cleanUrl,
          });
        }
      });
    }
  } catch (e) {
    console.log("Фотогалерея не получена:", String(e).slice(0, 50));
  }

  return photos;
}

// Парсинг цен на столы и депозиты
async function syncTablePrices(): Promise<{ id: string; deposit: number; credit: number }[]> {
  const tables: { id: string; deposit: number; credit: number }[] = [];

  try {
    const reserve = await fetchText("https://www.catchbeachclub.com/reserve/");

    // Ищем таблицы с ценами типа "12,000 THB deposit, 8,000 THB credit"
    const tableMatches = [...reserve.matchAll(/(?:Beach Daybed|Pool Daybed|Cabana|VIP Lounge)[^<]*?(\d+(?:,\d{3})*)\s*(?:THB|B)[^<]*?(\d+(?:,\d{3})*)\s*(?:THB|B)/gi)];

    const tableNames = ["beach-daybed", "pool-daybed", "pool-cabana", "bar-vip"];
    tableMatches.slice(0, 4).forEach((match, i) => {
      if (match[1] && match[2]) {
        tables.push({
          id: tableNames[i] || `table-${i}`,
          deposit: parseInt(match[1].replace(/,/g, ""), 10),
          credit: parseInt(match[2].replace(/,/g, ""), 10),
        });
      }
    });
  } catch (e) {
    console.log("Цены столов не получены:", String(e).slice(0, 50));
  }

  return tables;
}

export async function syncCatchData() {
  console.log("🐠 Синхронизация данных Catch Beach Club...");

  const prices = await syncMenuPrices();
  console.log(`✓ Найдено ${prices.length} позиций меню`);

  const photos = await findCatchPhotos();
  console.log(`✓ Найдено ${photos.length} фотографий`);

  const tables = await syncTablePrices();
  console.log(`✓ Синхронизировано ${tables.length} таблиц с ценами`);

  return { prices, photos, tables };
}
