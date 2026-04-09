import { StopProximity } from "./types";

const MAX_STOP_RADIUS_M  = 300;
const AT_STOP_RADIUS_M   = 50;
const APPROACHING_RADIUS_M = 150;

const EARTH_RADIUS_M = 6_371_000;

/**
 * Haversine formula — returns great-circle distance in metres.
 * Exported so kalman.ts and eta.ts can use the same implementation
 * without circular imports (they each keep a private copy for that reason,
 * but this is the canonical public version).
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest stop to the given position.
 * Returns null if no stop is within MAX_STOP_RADIUS_M (300 m).
 */
export function findNearestStop(
  lat: number,
  lng: number,
  stops: { id: string; name: string; lat: number; lng: number; order: number }[]
): StopProximity | null {
  if (stops.length === 0) return null;

  let nearest: StopProximity | null = null;

  for (const stop of stops) {
    const dist = haversineDistance(lat, lng, stop.lat, stop.lng);
    if (dist > MAX_STOP_RADIUS_M) continue;
    if (!nearest || dist < nearest.distanceMetres) {
      nearest = {
        stopId: stop.id,
        stopName: stop.name,
        distanceMetres: dist,
        order: stop.order,
      };
    }
  }

  return nearest;
}

/**
 * True if the vehicle is considered to be at the stop (within 50 m).
 */
export function isAtStop(proximity: StopProximity | null): boolean {
  return proximity !== null && proximity.distanceMetres < AT_STOP_RADIUS_M;
}

/**
 * True if the vehicle is approaching the stop (within 150 m).
 */
export function isApproachingStop(proximity: StopProximity | null): boolean {
  return proximity !== null && proximity.distanceMetres < APPROACHING_RADIUS_M;
}
