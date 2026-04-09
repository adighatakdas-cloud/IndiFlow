import { prisma } from "@/lib/db/prisma";
import { haversineDistance } from "@/lib/intelligence/gps/stopDetector";
import { NearbyIncident, RouteScore, StopScore } from "./types";

const INCIDENT_RADIUS_KM   = 0.5;
const MAX_NEARBY_INCIDENTS = 5;
const MAX_DELAY_PER_STOP   = 8; // minutes at combinedScore = 1.0

/**
 * Return a recommendation string based on overall route severity.
 */
function severityToRecommendation(severity: number): string {
  if (severity < 0.2) return "Route looks clear. Normal departure time recommended.";
  if (severity < 0.4) return "Light traffic expected on some stops. Allow 5 extra minutes.";
  if (severity < 0.6) return "Moderate congestion expected. Depart 10 minutes early.";
  if (severity < 0.8) return "Heavy traffic on multiple stops. Depart 15-20 minutes early.";
  return "Severe congestion. Consider alternate timing or route.";
}

/**
 * Score a route for traffic severity at a given departure time.
 *
 * For each stop:
 *   1. Load active TrafficIncidents within 0.5 km.
 *   2. Load TrafficPatterns matching hour + dayOfWeek for roads near this stop.
 *   3. Compute StopScore.
 *
 * Route-level:
 *   - overallSeverity = weighted average (later stops weighted higher).
 *   - estimatedDelayMinutes = sum of stop.combinedScore * MAX_DELAY_PER_STOP.
 *   - recommendation = string from severity bucket.
 */
export async function scoreRoute(
  stops: { id: string; name: string; lat: number; lng: number }[],
  departureTime?: Date
): Promise<RouteScore> {
  const now = new Date();
  const refTime = departureTime ?? now;
  const hour = refTime.getHours();
  const dayOfWeek = refTime.getDay(); // 0 = Sunday

  // -------------------------------------------------------------------------
  // Load all active incidents once — filter per stop in memory
  // -------------------------------------------------------------------------
  const activeIncidents = await prisma.trafficIncident.findMany({
    where: { expiresAt: { gt: now } },
    select: {
      id: true,
      roadName: true,
      normalised: true,
      type: true,
      severity: true,
      headline: true,
      reportedAt: true,
      lat: true,
      lng: true,
    },
  });

  // -------------------------------------------------------------------------
  // Load all TrafficPatterns for this hour + dayOfWeek once
  // -------------------------------------------------------------------------
  const patterns = await prisma.trafficPattern.findMany({
    where: { hour, dayOfWeek },
    select: {
      roadNormalised: true,
      incidentProbability: true,
      avgSeverity: true,
    },
  });

  // Index patterns by roadNormalised for O(1) lookup
  const patternIndex = new Map<
    string,
    { incidentProbability: number; avgSeverity: number }[]
  >();
  for (const p of patterns) {
    const existing = patternIndex.get(p.roadNormalised) ?? [];
    existing.push({
      incidentProbability: p.incidentProbability,
      avgSeverity: p.avgSeverity,
    });
    patternIndex.set(p.roadNormalised, existing);
  }

  // -------------------------------------------------------------------------
  // Score each stop
  // -------------------------------------------------------------------------
  const stopScores: StopScore[] = [];

  for (const stop of stops) {
    // Step 1: Find active incidents within 0.5 km
    const nearby: (typeof activeIncidents[number] & { distanceKm: number })[] = [];

    for (const inc of activeIncidents) {
      if (inc.lat === null || inc.lng === null) continue;
      const distM = haversineDistance(stop.lat, stop.lng, inc.lat, inc.lng);
      const distKm = distM / 1000;
      if (distKm <= INCIDENT_RADIUS_KM) {
        nearby.push({ ...inc, distanceKm: distKm });
      }
    }

    // Sort by severity desc, distance asc as tiebreaker
    nearby.sort((a, b) => b.severity - a.severity || a.distanceKm - b.distanceKm);

    const incidentCount = nearby.length;
    const maxSeverity =
      nearby.length > 0 ? nearby[0].severity : 0;

    // Normalise severity from Int (1-3) to float (0-1)
    const normalisedMaxSeverity = maxSeverity / 3;

    // Step 2: Pattern severity — collect patterns for roads near this stop
    const roadNormalisedSet = new Set(
      nearby.map((n) => n.normalised).filter(Boolean) as string[]
    );

    let patternSeverity = 0;
    for (const roadNorm of roadNormalisedSet) {
      const roadPatterns = patternIndex.get(roadNorm) ?? [];
      for (const p of roadPatterns) {
        const ps = p.incidentProbability * p.avgSeverity;
        if (ps > patternSeverity) patternSeverity = ps;
      }
    }

    // Normalise patternSeverity (avgSeverity is on 1-3 scale)
    const normalisedPatternSeverity = Math.min(1.0, patternSeverity / 3);

    // Step 3: Combined score
    const combinedScore =
      normalisedMaxSeverity * 0.7 + normalisedPatternSeverity * 0.3;

    // Step 4: Build NearbyIncident array (max 5, sorted by severity desc)
    const nearbyIncidents: NearbyIncident[] = nearby
      .slice(0, MAX_NEARBY_INCIDENTS)
      .map((n) => ({
        roadName:   n.roadName,
        type:       n.type,
        severity:   n.severity,
        distanceKm: Math.round(n.distanceKm * 1000) / 1000,
        headline:   n.headline,
        reportedAt: n.reportedAt,
      }));

    stopScores.push({
      stopId:           stop.id,
      stopName:         stop.name,
      lat:              stop.lat,
      lng:              stop.lng,
      incidentCount,
      maxSeverity:      normalisedMaxSeverity,
      patternSeverity:  normalisedPatternSeverity,
      combinedScore:    Math.min(1.0, combinedScore),
      nearbyIncidents,
    });
  }

  // -------------------------------------------------------------------------
  // Route-level aggregation
  // -------------------------------------------------------------------------
  const n = stopScores.length;

  let overallSeverity = 0;
  let estimatedDelayMinutes = 0;

  if (n > 0) {
    // Later stops get higher weight: weight[i] = (i + 1) / sum(1..n)
    const weightSum = (n * (n + 1)) / 2;
    let weightedSum = 0;

    for (let i = 0; i < n; i++) {
      const weight = (i + 1) / weightSum;
      weightedSum += stopScores[i].combinedScore * weight;
      estimatedDelayMinutes += stopScores[i].combinedScore * MAX_DELAY_PER_STOP;
    }

    overallSeverity = Math.min(1.0, weightedSum);
    estimatedDelayMinutes = Math.round(estimatedDelayMinutes * 10) / 10;
  }

  return {
    overallSeverity,
    recommendation: severityToRecommendation(overallSeverity),
    stops:          stopScores,
    estimatedDelayMinutes,
  };
}
