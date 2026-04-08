import * as cheerio from "cheerio";
import { RawArticle } from "../types";

const PRIMARY_URL = "https://nitter.poast.org/KolkataTraffic";
const FALLBACK_URL = "https://nitter.net/KolkataTraffic";
const SOURCE = "nitter_kolkata_traffic";
const TIMEOUT_MS = 8000;
const MAX_TWEETS = 30;

const TRAFFIC_KEYWORDS = [
  "jam",
  "signal",
  "block",
  "diversion",
  "accident",
  "waterlog",
  "waterlogging",
  "flooded",
  "flooding",
  "snarl",
  "congestion",
  "congested",
  "diverted",
  "closed",
  "crash",
  "collision",
];

function containsTrafficKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return TRAFFIC_KEYWORDS.some((kw) => lower.includes(kw));
}

const TWEET_SELECTORS = [".tweet-content", ".tweet-text"];

async function fetchNitter(url: string): Promise<RawArticle[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; IndiFlow/1.0; +https://indiflow.in)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const articles: RawArticle[] = [];

    // Try each selector; Nitter instances vary slightly in class names
    for (const selector of TWEET_SELECTORS) {
      $(selector).each((_, el) => {
        if (articles.length >= MAX_TWEETS) return false; // break

        const text = $(el).text().trim();
        if (!text || seen.has(text.toLowerCase())) return;
        if (!containsTrafficKeyword(text)) return;

        // Attempt to find the tweet permalink from a nearby anchor
        const closestLink =
          $(el).closest(".tweet-body, .timeline-item").find("a.tweet-link").attr("href") ??
          $(el).closest("div").find("a[href*='/KolkataTraffic/status']").attr("href") ??
          "";

        const tweetUrl = closestLink
          ? closestLink.startsWith("http")
            ? closestLink
            : `https://nitter.poast.org${closestLink}`
          : url;

        // Attempt to parse timestamp from <span class="tweet-date"> or <time>
        const timeEl =
          $(el).closest(".timeline-item, .tweet-body").find("time").first();
        const dateStr =
          timeEl.attr("datetime") ??
          $(el).closest(".timeline-item, .tweet-body").find(".tweet-date a").attr("title") ??
          "";
        const publishedAt = dateStr ? new Date(dateStr) : null;

        seen.add(text.toLowerCase());
        articles.push({
          headline: text.slice(0, 200), // cap headline length
          source: SOURCE,
          language: "en",
          url: tweetUrl,
          publishedAt:
            publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
          rawText: text,
        });
      });

      if (articles.length >= MAX_TWEETS) break;
    }

    return articles.slice(0, MAX_TWEETS);
  } finally {
    clearTimeout(timer);
  }
}

export async function scrape(): Promise<RawArticle[]> {
  try {
    const primary = await fetchNitter(PRIMARY_URL);
    if (primary.length > 0) return primary;

    // Fallback to secondary Nitter instance
    const fallback = await fetchNitter(FALLBACK_URL);
    return fallback;
  } catch {
    return [];
  }
}
