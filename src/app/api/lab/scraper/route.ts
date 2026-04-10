import { NextRequest } from "next/server";
import { z } from "zod";
import { requireLabAuth } from "../_auth";
import { prisma } from "@/lib/db/prisma";
import { runScraper } from "@/lib/intelligence/scraper";

const postSchema = z.object({
  source: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
});

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

  const { source, dryRun } = parsed.data;

  try {
    const result = await runScraper({
      sources: source && source !== "all" ? [source] : undefined,
      dryRun,
    });
    return Response.json(result);
  } catch (err) {
    console.error("[lab/scraper] POST error:", err);
    return Response.json({ error: "Scraper run failed", code: "SCRAPER_ERROR" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!requireLabAuth(request)) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // All scraper logs
    const allLogs = await prisma.scraperLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 500,
    });

    // Group by source — last run per source
    const sourceMap = new Map<string, typeof allLogs[number]>();
    for (const log of allLogs) {
      if (!sourceMap.has(log.source)) sourceMap.set(log.source, log);
    }

    // Compute 7-day success rate per source
    const sources = await Promise.all(
      Array.from(sourceMap.entries()).map(async ([sourceName, lastRun]) => {
        const recent = allLogs.filter(
          (l) => l.source === sourceName && l.startedAt >= sevenDaysAgo
        );
        const successRate7d =
          recent.length > 0
            ? Math.round((recent.filter((l) => l.success).length / recent.length) * 100)
            : null;

        return {
          name: sourceName,
          lastRun,
          successRate7d,
        };
      })
    );

    const recentRuns = allLogs.slice(0, 20);

    return Response.json({ sources, recentRuns });
  } catch (err) {
    console.error("[lab/scraper] GET error:", err);
    return Response.json({ error: "Failed to load scraper status", code: "DB_ERROR" }, { status: 500 });
  }
}
