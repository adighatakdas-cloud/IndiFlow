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
// Constants
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.25;
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map confidence to numeric severity matching Prisma schema Int field.
 * 1 = low, 2 = medium, 3 = high
 */
function confidenceToSeverity(confidence: number): number {
  if (confidence >= 0.8) return 3;
  if (confidence >= 0.5) return 2;
  return 1;
}

/**
 * expiresAt = reportedAt + 4h for jam/signal, + 8h for accident/flooding/diversion
 */
function getExpiresAt(type: IncidentType, reportedAt: Date): Date {
  const shortExpiry: IncidentType[] = [IncidentType.JAM, IncidentType.SIGNAL];
  const hours = shortExpiry.includes(type) ? 4 : 8;
  return new Date(reportedAt.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Check for a duplicate incident in the last 2 hours.
 * Duplicate = same normalised road name + same incident type.
 * Returns false immediately if normalised is empty.
 */
async function isDuplicate(
  normalised: string,
  type: IncidentType
): Promise<boolean> {
  if (!normalised) return false;
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existing = await prisma.trafficIncident.findFirst({
    where: { normalised, type, reportedAt: { gte: since } },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Write a ScraperLog row for one source.
 * Non-fatal — swallows its own errors.
 */
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
    console.error("[scraper] Failed to write ScraperLog for", source, err);
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
  const sourceStartedAt = new Date();

  // Select active sources
  const activeSources = sourceFilter
    ? ALL_SOURCES.filter((s) => sourceFilter.includes(s.name))
    : ALL_SOURCES;

  // -------------------------------------------------------------------------
  // Step 1: Run all scrapers in parallel
  // -------------------------------------------------------------------------
  const settled = await Promise.allSettled(
    activeSources.map((s) => s.scrape())
  );

  // -------------------------------------------------------------------------
  // Step 2: Flatten + initialise per-source tracking
  // -------------------------------------------------------------------------
  const allArticles: (RawArticle & { _source: string })[] = [];

  const perSource = activeSources.map((s, idx) => ({
    name: s.name,
    succeeded: settled[idx].status === "fulfilled",
    error:
      settled[idx].status === "rejected"
        ? ((settled[idx] as PromiseRejectedResult).reason?.message ?? "unknown error")
        : undefined,
    scraped: 0,
    classified: 0,
    stored: 0,
  }));

  settled.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      const articles = result.value;
      perSource[idx].scraped = articles.length;
      for (const article of articles) {
        allArticles.push({ ...article, _source: activeSources[idx].name });
      }
    } else {
      console.error(
        `[scraper] Source ${activeSources[idx].name} failed:`,
        (result as PromiseRejectedResult).reason
      );
    }
  });

  // -------------------------------------------------------------------------
  // Steps 3–7: Per-article pipeline
  // -------------------------------------------------------------------------
  const itemResults: ScraperItemResult[] = [];

  for (const article of allArticles) {
    const sourceEntry = perSource.find((p) => p.name === article._source)!;

    // Step 3: NLP classification
    const classification = classify({
      id: `${article._source}::${article.url}`,
      text: `${article.headline} ${article.rawText}`.trim(),
      publishedAt: article.publishedAt?.toISOString() ?? new Date().toISOString(),
      source: article._source,
      language: article.language,
    });

    // Step 4: Filter low-confidence and unknown
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

    sourceEntry.classified++;

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
        console.error("[scraper] Geo resolution error:", err);
      }
    }

    // Step 6: Deduplication check
    const normalised = classification.roadName?.toLowerCase() ?? "";
    const dup = await isDuplicate(normalised, classification.type);
    if (dup) {
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

    // Step 7: Write to TrafficIncident
    // Schema fields: id, roadName, normalised, lat, lng, type,
    //                severity, confidence, source, headline, reportedAt, expiresAt
    let stored = false;
    if (!dryRun) {
      try {
        const reportedAt = article.publishedAt ?? new Date();
        const expiresAt = getExpiresAt(classification.type, reportedAt);

        await prisma.trafficIncident.create({
          data: {
            roadName:   classification.roadName ?? article.headline.slice(0, 120),
            normalised,
            lat:        geo?.lat ?? null,
            lng:        geo?.lng ?? null,
            type:       classification.type,
            severity:   confidenceToSeverity(classification.confidence),
            confidence: classification.confidence,
            source:     article._source,
            headline:   article.headline.slice(0, 500),
            reportedAt,
            expiresAt,
          },
        });

        stored = true;
        sourceEntry.stored++;
      } catch (err) {
        console.error("[scraper] Failed to store TrafficIncident:", err);
      }
    }

    itemResults.push({
      headline:       article.headline,
      source:         article._source,
      language:       article.language,
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
    perSource.map((p) =>
      writeScraperLog(
        p.name,
        sourceStartedAt,
        completedAt,
        p.succeeded,
        p.scraped,
        p.classified,
        p.stored,
        p.error
      )
    )
  );

  // -------------------------------------------------------------------------
  // Step 9: Return ScraperRunResult
  // -------------------------------------------------------------------------
  return {
    source:          activeSources.map((s) => s.name).join(","),
    duration:        Date.now() - orchestratorStart,
    itemsScraped:    perSource.reduce((a, p) => a + p.scraped, 0),
    itemsClassified: perSource.reduce((a, p) => a + p.classified, 0),
    itemsStored:     perSource.reduce((a, p) => a + p.stored, 0),
    items:           itemResults,
  };
}