import { prisma } from "@/lib/db/prisma";
import { classify } from "@/lib/intelligence/nlp/classifier";
import { resolveRoadName } from "@/lib/intelligence/geo/matcher";
import { ClassificationResult, IncidentType } from "@/lib/intelligence/nlp/types";
import { RawArticle } from "./types";

import { scrape as scrapeGoogleNews } from "./sources/googleNews";
import { scrape as scrapeAbpAnanda } from "./sources/abpAnanda";
import { scrape as scrapeEisamay } from "./sources/eisamay";
import { scrape as scrapeToi } from "./sources/toi";
import { scrape as scrapeTelegraph } from "./sources/telegraph";
import { scrape as scrapeNitter } from "./sources/nitter";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ScraperItemResult {
  headline: string;
  source: string;
  language: "en" | "bn";
  classification: ClassificationResult;
  geo: { lat: number | null; lng: number | null; fromCache: boolean } | null;
  stored: boolean;
  skipReason?: string;
}

export interface ScraperRunResult {
  source: string;
  duration: number;
  itemsScraped: number;
  itemsClassified: number;
  itemsStored: number;
  items: ScraperItemResult[];
}

// ---------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------

interface SourceDef {
  name: string;
  scrape: () => Promise<RawArticle[]>;
}

const ALL_SOURCES: SourceDef[] = [
  { name: "google_news",            scrape: scrapeGoogleNews },
  { name: "abp_ananda",             scrape: scrapeAbpAnanda },
  { name: "eisamay",                scrape: scrapeEisamay },
  { name: "times_of_india",         scrape: scrapeToi },
  { name: "telegraph_india",        scrape: scrapeTelegraph },
  { name: "nitter_kolkata_traffic", scrape: scrapeNitter },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.25;
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Returns expiresAt based on incident type. */
function getExpiresAt(type: IncidentType, reportedAt: Date): Date {
  const longExpiry: IncidentType[] = [IncidentType.ACCIDENT, IncidentType.FLOODING];
  const hoursToAdd = longExpiry.includes(type) ? 8 : 4;
  return new Date(reportedAt.getTime() + hoursToAdd * 60 * 60 * 1000);
}

/**
 * Check TrafficIncident table for a duplicate within the last 2 hours.
 * Duplicate = same normalised road name + same incident type.
 */
async function isDuplicate(
  normalised: string | null,
  type: IncidentType
): Promise<boolean> {
  if (!normalised) return false;

  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existing = await prisma.trafficIncident.findFirst({
    where: {
      normalised,
      type,
      reportedAt: { gte: since },
    },
    select: { id: true },
  });

  return existing !== null;
}

/** Write a ScraperLog row for one source. Non-fatal — errors are swallowed. */
async function writeScraperLog(
  source: string,
  startedAt: Date,
  completedAt: Date,
  success: boolean,
  itemsScraped: number,
  itemsClassified: number,
  itemsStored: number,
  error?: string
): Promise<void> {
  try {
    await prisma.scraperLog.create({
      data: {
        source,
        startedAt,
        completedAt,
        success,
        itemsScraped,
        itemsClassified,
        itemsStored,
        error: error ?? null,
      },
    });
  } catch (err) {
    console.error("[scraper/index] Failed to write ScraperLog:", source, err);
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runScraper(options?: {
  sources?: string[];
  dryRun?: boolean;
}): Promise<ScraperRunResult> {
  const dryRun = options?.dryRun ?? false;
  const sourceFilter = options?.sources ?? null;
  const orchestratorStart = Date.now();

  // Select which sources to run
  const activeSources = sourceFilter
    ? ALL_SOURCES.filter((s) => sourceFilter.includes(s.name))
    : ALL_SOURCES;

  // -------------------------------------------------------------------------
  // Step 1: Run all scrapers in parallel
  // -------------------------------------------------------------------------
  const sourceStartedAt = new Date();
  const settled = await Promise.allSettled(
    activeSources.map((s) => s.scrape())
  );

  // -------------------------------------------------------------------------
  // Step 2: Flatten + track per-source counts for ScraperLog
  // -------------------------------------------------------------------------
  const allArticles: (RawArticle & { _source: string })[] = [];
  const sourceItemCounts: Record<string, number> = {};

  settled.forEach((result, idx) => {
    const sourceDef = activeSources[idx];
    if (result.status === "fulfilled") {
      const articles = result.value;
      sourceItemCounts[sourceDef.name] = articles.length;
      for (const article of articles) {
        allArticles.push({ ...article, _source: sourceDef.name });
      }
    } else {
      sourceItemCounts[sourceDef.name] = 0;
      console.error(
        `[scraper/index] Source ${sourceDef.name} rejected:`,
        result.reason
      );
    }
  });

  // -------------------------------------------------------------------------
  // Step 3–8: Classify → filter → geo → dedup → store per article
  // -------------------------------------------------------------------------
  const itemResults: ScraperItemResult[] = [];
  const sourceClassifiedCounts: Record<string, number> = {};
  const sourceStoredCounts: Record<string, number> = {};

  // Initialise counters
  for (const s of activeSources) {
    sourceClassifiedCounts[s.name] = 0;
    sourceStoredCounts[s.name] = 0;
  }

  for (const article of allArticles) {
    // Step 3: NLP classification
    const nlpInput = {
      id: `${article._source}:${article.url}`,
      text: `${article.headline} ${article.rawText}`.trim(),
      publishedAt: article.publishedAt?.toISOString() ?? new Date().toISOString(),
      source: article._source,
      language: article.language,
    };

    const classification = classify(nlpInput);

    // Step 4: Confidence + unknown filter
    if (
      classification.confidence < CONFIDENCE_THRESHOLD ||
      classification.type === IncidentType.UNKNOWN
    ) {
      itemResults.push({
        headline: article.headline,
        source: article._source,
        language: article.language,
        classification,
        geo: null,
        stored: false,
        skipReason:
          classification.type === IncidentType.UNKNOWN
            ? "type=unknown"
            : `confidence=${classification.confidence.toFixed(2)}<${CONFIDENCE_THRESHOLD}`,
      });
      continue;
    }

    sourceClassifiedCounts[article._source]++;

    // Step 5: Geo resolution
    let geo: ScraperItemResult["geo"] = null;
    if (classification.roadName) {
      try {
        const geoResult = await resolveRoadName(classification.roadName);
        if (geoResult) {
          geo = {
            lat: geoResult.lat,
            lng: geoResult.lng,
            fromCache: geoResult.fromCache,
          };
        }
      } catch (err) {
        console.error("[scraper/index] Geo resolution failed:", err);
      }
    }

    // Step 6: Deduplication
    const isDup = await isDuplicate(
      classification.roadName
        ? classification.roadName.toLowerCase()
        : null,
      classification.type
    );

    if (isDup) {
      itemResults.push({
        headline: article.headline,
        source: article._source,
        language: article.language,
        classification,
        geo,
        stored: false,
        skipReason: "duplicate within 2h window",
      });
      continue;
    }

    // Step 7: Write to TrafficIncident (unless dryRun)
    let stored = false;
    if (!dryRun) {
      try {
        const reportedAt = article.publishedAt ?? new Date();
        const expiresAt = getExpiresAt(classification.type, reportedAt);

        await prisma.trafficIncident.create({
          data: {
            roadName: classification.roadName ?? article.headline.slice(0, 120),
            normalised: classification.roadName?.toLowerCase() ?? "",
            lat: geo?.lat ?? null,
            lng: geo?.lng ?? null,
            type: classification.type,
            severity: confidenceToSeverityInt(classification.confidence),
            confidence: classification.confidence,
            source: article._source,
            headline: article.headline.slice(0, 500),
            reportedAt,
            expiresAt,
          },
        });
        stored = true;
        sourceStoredCounts[article._source]++;
      } catch (err) {
        console.error("[scraper/index] Failed to store TrafficIncident:", err);
      }
    }

    itemResults.push({
      headline: article.headline,
      source: article._source,
      language: article.language,
      classification,
      geo,
      stored,
      skipReason: dryRun ? "dryRun=true" : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Step 8: Write ScraperLog per source
  // -------------------------------------------------------------------------
  const completedAt = new Date();

  await Promise.allSettled(
    activeSources.map((s, idx) => {
      const succeeded = settled[idx].status === "fulfilled";
      return writeScraperLog(
        s.name,
        sourceStartedAt,
        completedAt,
        succeeded,
        sourceItemCounts[s.name] ?? 0,
        sourceClassifiedCounts[s.name] ?? 0,
        sourceStoredCounts[s.name] ?? 0,
        succeeded
          ? undefined
          : (settled[idx] as PromiseRejectedResult).reason?.message
      );
    })
  );

  // -------------------------------------------------------------------------
  // Step 9: Return ScraperRunResult
  // -------------------------------------------------------------------------
  const totalScraped = allArticles.length;
  const totalClassified = Object.values(sourceClassifiedCounts).reduce(
    (a, b) => a + b,
    0
  );
  const totalStored = Object.values(sourceStoredCounts).reduce(
    (a, b) => a + b,
    0
  );

  return {
    source: activeSources.map((s) => s.name).join(","),
    duration: Date.now() - orchestratorStart,
    itemsScraped: totalScraped,
    itemsClassified: totalClassified,
    itemsStored: totalStored,
    items: itemResults,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Map confidence score to a numeric severity (1 = low, 2 = medium, 3 = high).
 * Matches the Int type declared in the Prisma schema for TrafficIncident.severity.
 */
function confidenceToSeverityInt(confidence: number): number {
  if (confidence >= 0.8) return 3;
  if (confidence >= 0.5) return 2;
  return 1;
}
