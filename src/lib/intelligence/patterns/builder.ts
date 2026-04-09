import { prisma } from "@/lib/db/prisma";

const DEFAULT_MIN_SAMPLES = 3;

interface BuildResult {
  patternsBuilt: number;
  patternsUpdated: number;
  roadsProcessed: number;
  duration: number;
}

/**
 * Group key string for a road + hour + dayOfWeek combination.
 */
function groupKey(normalised: string, hour: number, dayOfWeek: number): string {
  return `${normalised}||${hour}||${dayOfWeek}`;
}

/**
 * Build (or rebuild) TrafficPattern rows from all TrafficIncidents in the DB.
 *
 * Steps:
 *   1. Load all incidents.
 *   2. Group by normalised road + hour + dayOfWeek.
 *   3. Build a denominator map: total incidents per hour+dayOfWeek across all roads.
 *   4. For each group with count >= minSamples, compute probability + avgSeverity.
 *   5. Upsert into TrafficPattern.
 */
export async function buildPatterns(options?: {
  minSamples?: number;
  dryRun?: boolean;
}): Promise<BuildResult> {
  const minSamples = options?.minSamples ?? DEFAULT_MIN_SAMPLES;
  const dryRun = options?.dryRun ?? false;
  const start = Date.now();

  // -------------------------------------------------------------------------
  // Step 1: Load all incidents
  // -------------------------------------------------------------------------
  const incidents = await prisma.trafficIncident.findMany({
    select: {
      normalised: true,
      severity: true,
      reportedAt: true,
    },
  });

  if (incidents.length === 0) {
    return { patternsBuilt: 0, patternsUpdated: 0, roadsProcessed: 0, duration: Date.now() - start };
  }

  // -------------------------------------------------------------------------
  // Step 2: Group by normalised + hour + dayOfWeek
  // -------------------------------------------------------------------------
  // groupMap: key → { severities[], count }
  const groupMap = new Map<string, { normalised: string; hour: number; dayOfWeek: number; severities: number[] }>();

  // denominatorMap: "hour||dayOfWeek" → total incident count across all roads
  const denominatorMap = new Map<string, number>();

  for (const inc of incidents) {
    if (!inc.normalised) continue;

    const d = inc.reportedAt;
    const hour = d.getHours();
    const dayOfWeek = d.getDay(); // 0 = Sunday … 6 = Saturday

    const gk = groupKey(inc.normalised, hour, dayOfWeek);
    const dk = `${hour}||${dayOfWeek}`;

    // Group accumulation
    if (!groupMap.has(gk)) {
      groupMap.set(gk, { normalised: inc.normalised, hour, dayOfWeek, severities: [] });
    }
    groupMap.get(gk)!.severities.push(inc.severity);

    // Denominator accumulation
    denominatorMap.set(dk, (denominatorMap.get(dk) ?? 0) + 1);
  }

  // -------------------------------------------------------------------------
  // Steps 3–5: Compute metrics and upsert
  // -------------------------------------------------------------------------
  const uniqueRoads = new Set<string>();
  let patternsBuilt = 0;
  let patternsUpdated = 0;

  for (const [, group] of groupMap) {
    const count = group.severities.length;
    if (count < minSamples) continue;

    uniqueRoads.add(group.normalised);

    const dk = `${group.hour}||${group.dayOfWeek}`;
    const denominator = denominatorMap.get(dk) ?? count;
    const incidentProbability = Math.min(1.0, count / denominator);
    const avgSeverity = group.severities.reduce((a, b) => a + b, 0) / count;

    if (dryRun) {
      patternsBuilt++; // count as would-be-built in dry run
      continue;
    }

    // Check if this pattern already exists
    const existing = await prisma.trafficPattern.findFirst({
      where: {
        roadNormalised: group.normalised,
        hour: group.hour,
        dayOfWeek: group.dayOfWeek,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.trafficPattern.update({
        where: { id: existing.id },
        data: {
          incidentProbability,
          avgSeverity,
          sampleCount: count,
        },
      });
      patternsUpdated++;
    } else {
      await prisma.trafficPattern.create({
        data: {
          roadNormalised: group.normalised,
          hour: group.hour,
          dayOfWeek: group.dayOfWeek,
          incidentProbability,
          avgSeverity,
          sampleCount: count,
        },
      });
      patternsBuilt++;
    }
  }

  return {
    patternsBuilt,
    patternsUpdated,
    roadsProcessed: uniqueRoads.size,
    duration: Date.now() - start,
  };
}
