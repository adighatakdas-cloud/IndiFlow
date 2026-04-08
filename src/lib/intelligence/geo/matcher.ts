import {prisma} from "@/lib/db/prisma";
import { roadAliases } from "@/lib/intelligence/nlp/keywords/aliases";
import { isWithinWestBengal, clampToWestBengal } from "./bounds";

export interface GeoResult {
  lat: number;
  lng: number;
  fromCache: boolean;
  normalised: string;
}

/** Nominatim TOS: maximum 1 request per second. Sleep 1100ms to be safe. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalise a raw road name for consistent cache keying and Nominatim querying:
 * 1. Lowercase + trim
 * 2. Remove punctuation (keep letters, digits, spaces)
 * 3. Resolve against Kolkata road aliases → canonical form
 */
export function normaliseRoadName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0980-\u09ff\s]/g, " ") // keep Bengali block too
    .replace(/\s+/g, " ")
    .trim();

  // Greedy alias match — sorted longest-first so "em bypass" beats "bypass"
  const sortedKeys = Object.keys(roadAliases).sort(
    (a, b) => b.length - a.length
  );
  for (const alias of sortedKeys) {
    if (cleaned.includes(alias)) {
      // Return the canonical form, also lowercased for cache key consistency
      return roadAliases[alias].toLowerCase();
    }
  }

  return cleaned;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    state?: string;
    country?: string;
  };
}

async function queryNominatim(
  normalisedName: string
): Promise<{ lat: number; lng: number } | null> {
  // Rate-limit guard — must precede every Nominatim HTTP call
  await sleep(1100);

  const query = encodeURIComponent(
    `${normalisedName}, Kolkata, West Bengal, India`
  );
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&addressdetails=1`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "IndiFlow/1.0 (fleet management, West Bengal)",
        "Accept-Language": "en",
      },
    });
  } catch (err) {
    console.error("[geo/matcher] Nominatim fetch failed:", err);
    return null;
  }

  if (!response.ok) {
    console.error(
      "[geo/matcher] Nominatim returned HTTP",
      response.status,
      "for query:",
      normalisedName
    );
    return null;
  }

  let results: NominatimResult[];
  try {
    results = (await response.json()) as NominatimResult[];
  } catch (err) {
    console.error("[geo/matcher] Failed to parse Nominatim JSON:", err);
    return null;
  }

  if (!results || results.length === 0) {
    return null;
  }

  const top = results[0];
  const lat = parseFloat(top.lat);
  const lng = parseFloat(top.lon);

  if (isNaN(lat) || isNaN(lng)) {
    return null;
  }

  // Validate the result falls within West Bengal
  if (!isWithinWestBengal(lat, lng)) {
    console.warn(
      "[geo/matcher] Nominatim result out of West Bengal bounds for:",
      normalisedName,
      { lat, lng }
    );
    return null;
  }

  return clampToWestBengal(lat, lng); // returns { lat, lng } or null
}

/**
 * Resolve a raw road name to a lat/lng coordinate.
 *
 * Flow:
 *   1. Normalise the name via aliases.
 *   2. Check GeoCache (exact match on normalised query).
 *   3. On cache miss: call Nominatim (with mandatory 1100ms sleep before call).
 *   4. Validate result is within West Bengal.
 *   5. On valid result: write to GeoCache.
 *   6. Return GeoResult or null.
 */
export async function resolveRoadName(rawName: string): Promise<GeoResult | null> {
  const normalised = normaliseRoadName(rawName);

  // 1. Cache lookup
  const cached = await prisma.geoCache.findFirst({
    where: { normalised },
  });

  if (cached) {
    return {
      lat: cached.lat,
      lng: cached.lng,
      fromCache: true,
      normalised,
    };
  }

  // 2. Nominatim lookup (sleep is inside queryNominatim)
  const coords = await queryNominatim(normalised);

  if (!coords) {
    return null;
  }

  // 3. Write to cache
  try {
    await prisma.geoCache.create({
      data: {
        query: rawName.trim(),
        normalised,
        lat: coords.lat,
        lng: coords.lng,
      },
    });
  } catch (err) {
    // Cache write failure is non-fatal — still return the result
    console.error("[geo/matcher] Failed to write GeoCache entry:", err);
  }

  return {
    lat: coords.lat,
    lng: coords.lng,
    fromCache: false,
    normalised,
  };
}
