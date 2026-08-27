// GPS-трекер маршрута вечера: включается при подтверждении, выключается вручную.
// Хранит позицию юзера, чек-ины в местах маршрута, время прибытия/убытия.
import * as React from "react";

export interface TrackedLocation {
  lat: number;
  lon: number;
  accuracy: number; // метры
  timestamp: number; // ms since epoch
}

export interface VenueCheckIn {
  vid: string; // venue ID
  arrivedAt: number; // timestamp
  leftAt?: number; // timestamp (опционально — может быть не в зал, а просто рядом)
  rating?: number; // оценка 1–5
  notes?: string; // отзыв
}

export interface ActiveTrack {
  routeIds: string[]; // маршрут: какие места в каком порядке
  startedAt: number;
  endedAt?: number;
  locations: TrackedLocation[]; // история позиций
  checkIns: VenueCheckIn[]; // чек-ины и отзывы
  venueVisitOrder: string[]; // практический порядок посещения (может отличаться)
}

const TRACK_KEY = "gtr-active-track";
const LOC_HISTORY_MAX = 360; // хранить за 6 часов (при обновлении раз в минуту)

export const gpsTracker = {
  // Начать запись маршрута
  startTrack(routeIds: string[]): ActiveTrack {
    const track: ActiveTrack = {
      routeIds,
      startedAt: Date.now(),
      locations: [],
      checkIns: [],
      venueVisitOrder: [],
    };
    localStorage.setItem(TRACK_KEY, JSON.stringify(track));
    this.requestPermission();
    return track;
  },

  // Прекратить запись
  endTrack(): ActiveTrack | null {
    const track = this.getActiveTrack();
    if (!track) return null;
    track.endedAt = Date.now();
    localStorage.setItem(TRACK_KEY, JSON.stringify(track));
    return track;
  },

  // Получить текущий трек (если ведётся запись)
  getActiveTrack(): ActiveTrack | null {
    try {
      const data = localStorage.getItem(TRACK_KEY);
      if (!data) return null;
      const track = JSON.parse(data) as ActiveTrack;
      // Забываем запись, если она старше 12 часов
      if (Date.now() - track.startedAt > 12 * 3600 * 1000) {
        localStorage.removeItem(TRACK_KEY);
        return null;
      }
      return track;
    } catch {
      return null;
    }
  },

  // Запросить разрешение на геолокацию
  requestPermission(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => {}, // just checking permission
      () => {}, // user denied, that's ok
    );
  },

  // Добавить текущую позицию в историю (должен вызываться периодически)
  addLocation(lat: number, lon: number, accuracy: number): void {
    const track = this.getActiveTrack();
    if (!track) return;

    track.locations.push({
      lat,
      lon,
      accuracy,
      timestamp: Date.now(),
    });

    // Удалять старые позиции
    if (track.locations.length > LOC_HISTORY_MAX) {
      track.locations = track.locations.slice(-LOC_HISTORY_MAX);
    }

    localStorage.setItem(TRACK_KEY, JSON.stringify(track));
  },

  // Чек-ин в место маршрута
  checkInVenue(vid: string): VenueCheckIn {
    const track = this.getActiveTrack();
    if (!track) throw new Error("No active track");

    const checkIn: VenueCheckIn = {
      vid,
      arrivedAt: Date.now(),
    };

    const existing = track.checkIns.find((c) => c.vid === vid);
    if (existing) {
      // Если уже был чек-ин в это место, обновляем только время прихода
      existing.arrivedAt = Date.now();
      existing.leftAt = undefined;
    } else {
      track.checkIns.push(checkIn);
      if (!track.venueVisitOrder.includes(vid)) {
        track.venueVisitOrder.push(vid);
      }
    }

    localStorage.setItem(TRACK_KEY, JSON.stringify(track));
    return checkIn;
  },

  // Зафиксировать убытие из места
  checkOutVenue(vid: string): void {
    const track = this.getActiveTrack();
    if (!track) return;

    const checkIn = track.checkIns.find((c) => c.vid === vid);
    if (checkIn && !checkIn.leftAt) {
      checkIn.leftAt = Date.now();
    }

    localStorage.setItem(TRACK_KEY, JSON.stringify(track));
  },

  // Добавить оценку и отзыв к посещению
  rateVenue(vid: string, rating: number, notes?: string): void {
    const track = this.getActiveTrack();
    if (!track) return;

    const checkIn = track.checkIns.find((c) => c.vid === vid);
    if (checkIn) {
      checkIn.rating = Math.max(1, Math.min(5, rating));
      if (notes) checkIn.notes = notes;
    }

    localStorage.setItem(TRACK_KEY, JSON.stringify(track));
  },

  // Статистика маршрута
  getStats(): {
    elapsed: number; // сколько прошло времени
    distanceTraveled?: number; // примерное расстояние (мм)
    venuesVisited: number;
    avgTimePerVenue: number; // минут
  } {
    const track = this.getActiveTrack();
    if (!track) {
      return {
        elapsed: 0,
        venuesVisited: 0,
        avgTimePerVenue: 0,
      };
    }

    const now = track.endedAt || Date.now();
    const elapsed = now - track.startedAt;

    let distanceTraveled = 0;
    for (let i = 1; i < track.locations.length; i++) {
      const prev = track.locations[i - 1];
      const curr = track.locations[i];
      distanceTraveled += haversine(prev.lat, prev.lon, curr.lat, curr.lon);
    }

    const venuesVisited = track.checkIns.filter((c) => c.leftAt).length;
    const avgTimePerVenue = venuesVisited > 0 ? elapsed / venuesVisited / 60000 : 0;

    return {
      elapsed,
      distanceTraveled: Math.round(distanceTraveled),
      venuesVisited,
      avgTimePerVenue: Math.round(avgTimePerVenue * 10) / 10,
    };
  },

  // Очистить запись (отмена)
  clear(): void {
    localStorage.removeItem(TRACK_KEY);
  },
};

// Расстояние между двумя точками (формула Хаверсина, в км)
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// React hook для отслеживания позиции
export function useGpsTracking(enabled: boolean): {
  location: TrackedLocation | null;
  error: string | null;
  isTracking: boolean;
} {
  const [location, setLocation] = React.useState<TrackedLocation | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const watchIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!enabled || !navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc: TrackedLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
        };
        setLocation(loc);
        gpsTracker.addLocation(loc.lat, loc.lon, loc.accuracy);
        setError(null);
      },
      (err) => {
        setError(err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000, // обновлять максимум раз в 5 сек
        timeout: 10000,
      },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [enabled]);

  return {
    location,
    error,
    isTracking: enabled && watchIdRef.current !== null,
  };
}
