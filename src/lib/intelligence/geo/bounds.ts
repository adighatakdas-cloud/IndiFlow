export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export const WEST_BENGAL_BOUNDS: BoundingBox = {
  minLat: 21.5,
  maxLat: 27.2,
  minLng: 85.8,
  maxLng: 89.9,
};

export const KOLKATA_BOUNDS: BoundingBox = {
  minLat: 22.4,
  maxLat: 22.7,
  minLng: 88.2,
  maxLng: 88.5,
};

export function isWithinWestBengal(lat: number, lng: number): boolean {
  return (
    lat >= WEST_BENGAL_BOUNDS.minLat &&
    lat <= WEST_BENGAL_BOUNDS.maxLat &&
    lng >= WEST_BENGAL_BOUNDS.minLng &&
    lng <= WEST_BENGAL_BOUNDS.maxLng
  );
}

export function isWithinKolkata(lat: number, lng: number): boolean {
  return (
    lat >= KOLKATA_BOUNDS.minLat &&
    lat <= KOLKATA_BOUNDS.maxLat &&
    lng >= KOLKATA_BOUNDS.minLng &&
    lng <= KOLKATA_BOUNDS.maxLng
  );
}

/**
 * If the coordinate is within West Bengal, returns it unchanged.
 * If it falls outside, returns null — do not clamp to a fake position.
 */
export function clampToWestBengal(
  lat: number,
  lng: number
): { lat: number; lng: number } | null {
  if (isWithinWestBengal(lat, lng)) {
    return { lat, lng };
  }
  return null;
}
