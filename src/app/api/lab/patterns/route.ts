import { NextRequest } from "next/server";
import { z } from "zod";
import { requireLabAuth } from "../_auth";
import { prisma } from "@/lib/db/prisma";
import { buildPatterns } from "@/lib/intelligence/patterns/builder";
import { Prisma } from "@prisma/client";

const postSchema = z.object({
  dryRun:     z.boolean().optional().default(false),
  minSamples: z.number().int().min(1).optional().default(3),
});

export async function GET(request: NextRequest) {
  if (!requireLabAuth(request)) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const roadNormalised = sp.get("roadNormalised") ?? undefined;
  const hour           = sp.has("hour") ? Number(sp.get("hour")) : undefined;
  const dayOfWeek      = sp.has("dayOfWeek") ? Number(sp.get("dayOfWeek")) : undefined;
  const minSamples     = Number(sp.get("minSamples") ?? 3);

  const where: Prisma.TrafficPatternWhereInput = {
    ...(roadNormalised ? { roadNormalised: { contains: roadNormalised } } : {}),
    ...(hour !== undefined ? { hour } : {}),
    ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
    ...(minSamples > 0 ? { sampleCount: { gte: minSamples } } : {}),
  };

  try {
    const [patterns, totalPatterns] = await Promise.all([
      prisma.trafficPattern.findMany({
        where,
        orderBy: [{ incidentProbability: "desc" }, { sampleCount: "desc" }],
      }),
      prisma.trafficPattern.count({ where }),
    ]);

    // Coverage stats across all patterns (not just filtered)
    const allStats = await prisma.trafficPattern.aggregate({
      _count: { id: true },
      _avg: { sampleCount: true },
    });

    const totalRoads = await prisma.trafficPattern.groupBy({
      by: ["roadNormalised"],
      _count: true,
    });

    return Response.json({
      patterns,
      coverage: {
        totalRoads:            totalRoads.length,
        totalPatterns:         allStats._count.id,
        avgSamplesPerPattern:  Math.round((allStats._avg.sampleCount ?? 0) * 10) / 10,
      },
    });
  } catch (err) {
    console.error("[lab/patterns] GET error:", err);
    return Response.json({ error: "Failed to query patterns", code: "DB_ERROR" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!requireLabAuth(request)) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body", code: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten().formErrors[0] ?? "Validation error", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  try {
    const result = await buildPatterns({
      dryRun:     parsed.data.dryRun,
      minSamples: parsed.data.minSamples,
    });
    return Response.json(result);
  } catch (err) {
    console.error("[lab/patterns] POST error:", err);
    return Response.json({ error: "Pattern build failed", code: "BUILD_ERROR" }, { status: 500 });
  }
}
