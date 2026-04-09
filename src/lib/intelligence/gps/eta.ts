import { prisma } from "@/lib/db/prisma";
import { ETAResult } from "./types";

const MIN_SPEED_KMH        = 15;   // floor when vehicle is momentarily stopped
const SLOW_THRESHOLD_KMH   = 3;    // below this, use MIN_SPEED_KMH
const DEFAULT_DISTANCE_FACTOR = 1.3;
const DEFAULT_CORRECTION_FACTOR = 1.0;
const SPEED_HISTORY_COUNT  = 10;
const MIN_TRIPS_FOR_UPDATE = 10;
const CORRECTION_TRIP_WINDOW = 30;

const EARTH_RADIUS_M = 6_371_000;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Confidence score based on how many speed readings are available.
 * 10 readings → 1.0, 1–2 readings → 0.4, scales linearly in between.
 */
function computeConfidence(readingCount: number): number {
  if (readingCount >= SPEED_HISTORY_COUNT) return 1.0;
  if (readingCount <= 2) return 0.4;
  // Linear interpolation between 0.4 (at 2) and 1.0 (at 10)
  return 0.4 + ((readingCount - 2) / (SPEED_HISTORY_COUNT - 2)) * 0.6;
}

/**
 * Compute median of a numeric array (sorted copy).
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Calculate ETA to the next stop and cumulative ETA across all remaining stops.
 *
 * Returns ETAResult for the *next* stop, including total distance to it and
 * the correction factor that was applied.
 * Returns null if there are no remaining stops or the route cannot be loaded.
 */
export async function calculateETA(
  vehicleId: string,
  currentLat: number,
  currentLng: number,
  currentSpeed: number,
  remainingStops: { id: string; name: string; lat: number; lng: number }[],
  routeId: string
): Promise<ETAResult | null> {
  if (remainingStops.length === 0) return null;

  // -------------------------------------------------------------------------
  // 1. Speed history — last N GPSTracks for this vehicle
  // -------------------------------------------------------------------------
  const tracks = await prisma.gPSTrack.findMany({
    where: { vehicleId },
    orderBy: { capturedAt: "desc" },
    take: SPEED_HISTORY_COUNT,
    select: { speed: true },
  });

  const speedReadings = tracks.map((t) => t.speed).filter((s) => s >= 0);
  const rollingAvg =
    speedReadings.length > 0
      ? speedReadings.reduce((a, b) => a + b, 0) / speedReadings.length
      : currentSpeed;

  const effectiveSpeed =
    rollingAvg < SLOW_THRESHOLD_KMH ? MIN_SPEED_KMH : rollingAvg;

  const confidence = computeConfidence(speedReadings.length);

  // -------------------------------------------------------------------------
  // 2. Route factors
  // -------------------------------------------------------------------------
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: { distanceFactor: true, etaCorrectionFactor: true },
  });

  const distanceFactor    = route?.distanceFactor    ?? DEFAULT_DISTANCE_FACTOR;
  const correctionFactor  = route?.etaCorrectionFactor ?? DEFAULT_CORRECTION_FACTOR;

  // -------------------------------------------------------------------------
  // 3. Stop dwell times — fetch avgDwellMinutes for all remaining stops
  // -------------------------------------------------------------------------
  const stopIds = remainingStops.map((s) => s.id);
  const stopRecords = await prisma.stop.findMany({
    where: { id: { in: stopIds } },
    select: { id: true, avgDwellMinutes: true },
  });
  const dwellMap = new Map<string, number>(
    stopRecords.map((s) => [s.id, s.avgDwellMinutes ?? 0])
  );

  // -------------------------------------------------------------------------
  // 4. Cumulative ETA calculation
  // -------------------------------------------------------------------------
  const nextStop = remainingStops[0];
  const straightLineToNext = haversine(
    currentLat, currentLng, nextStop.lat, nextStop.lng
  );
  const roadDistanceToNext = straightLineToNext * distanceFactor;

  // Travel time in minutes to next stop
  const effectiveSpeedMs = (effectiveSpeed * 1000) / 3600; // convert km/h → m/s
  let cumulativeMinutes =
    roadDistanceToNext / effectiveSpeedMs / 60 +
    (dwellMap.get(nextStop.id) ?? 0);

  // Add travel + dwell for subsequent stops
  for (let i = 1; i < remainingStops.length; i++) {
    const from = remainingStops[i - 1];
    const to   = remainingStops[i];
    const segDistance = haversine(from.lat, from.lng, to.lat, to.lng) * distanceFactor;
    const segMinutes  = segDistance / effectiveSpeedMs / 60;
    cumulativeMinutes += segMinutes + (dwellMap.get(to.id) ?? 0);
  }

  // Apply correction factor
  const correctedMinutes = cumulativeMinutes * correctionFactor;
  const etaSeconds = Math.round(correctedMinutes * 60);
  const etaMinutes = Math.round(correctedMinutes);

  return {
    nextStopId:              nextStop.id,
    nextStopName:            nextStop.name,
    etaMinutes,
    etaSeconds,
    distanceMetres:          Math.round(roadDistanceToNext),
    confidence,
    correctionFactorApplied: correctionFactor,
  };
}

/**
 * Record ETA prediction accuracy after a trip completes.
 * Writes etaAccuracySeconds = (predicted arrival − actual arrival) in seconds.
 * Positive = arrived early, negative = arrived late.
 */
export async function recordAccuracy(
  tripId: string,
  predictedEtaMinutes: number,
  actualCompletionTime: Date
): Promise<void> {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { scheduledAt: true },
    });
    if (!trip) return;

    // Predicted arrival = scheduledAt + predictedEtaMinutes
    const predictedArrival = new Date(
      trip.scheduledAt.getTime() + predictedEtaMinutes * 60 * 1000
    );
    const accuracySeconds = Math.round(
      (predictedArrival.getTime() - actualCompletionTime.getTime()) / 1000
    );

    await prisma.trip.update({
      where: { id: tripId },
      data: { etaAccuracySeconds: accuracySeconds },
    });
  } catch (err) {
    console.error("[gps/eta] recordAccuracy failed:", err);
  }
}

/**
 * Recompute and persist Route.etaCorrectionFactor from the last 30 completed trips.
 * Only updates if at least MIN_TRIPS_FOR_UPDATE trips have accuracy data.
 *
 * New correction factor = existing factor * (1 + medianAccuracySeconds / totalExpectedSeconds).
 * Clamped to [0.5, 2.0] to prevent runaway correction.
 */
export async function updateCorrectionFactor(routeId: string): Promise<void> {
  try {
    const trips = await prisma.trip.findMany({
      where: {
        routeId,
        status: "completed",
        etaAccuracySeconds: { not: null },
      },
      orderBy: { completedAt: "desc" },
      take: CORRECTION_TRIP_WINDOW,
      select: { etaAccuracySeconds: true },
    });

    if (trips.length < MIN_TRIPS_FOR_UPDATE) return;

    const accuracyValues = trips
      .map((t) => t.etaAccuracySeconds!)
      .filter((v) => v !== null);

    const medianAccuracy = median(accuracyValues); // seconds

    // Fetch current correction factor
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      select: { etaCorrectionFactor: true },
    });
    const currentFactor = route?.etaCorrectionFactor ?? DEFAULT_CORRECTION_FACTOR;

    // Adjust: if median is negative (arriving late), increase the factor
    // The adjustment is proportional to the median error as a fraction of
    // a reference journey time (30 minutes = 1800 seconds).
    const referenceSeconds = 1800;
    const adjustment = medianAccuracy / referenceSeconds;
    const newFactor = Math.min(2.0, Math.max(0.5, currentFactor * (1 - adjustment)));

    await prisma.route.update({
      where: { id: routeId },
      data: { etaCorrectionFactor: newFactor },
    });
  } catch (err) {
    console.error("[gps/eta] updateCorrectionFactor failed:", err);
  }
}
