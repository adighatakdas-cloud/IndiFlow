import * as cheerio from "cheerio";
import { RawArticle } from "../types";

const FEEDS = [
  "https://news.google.com/rss/search?q=kolkata+traffic&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=kolkata+road+jam&hl=en-IN&gl=IN&ceid=IN:en",
];

const SOURCE = "google_news";
const TIMEOUT_MS = 8000;

async function fetchFeed(url: string): Promise<RawArticle[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const articles: RawArticle[] = [];

    $("item").each((_, el) => {
      const headline = $(el).find("title").first().text().trim();
      const link = $(el).find("link").first().text().trim() ||
        $(el).find("link").first().next().text().trim();
      const pubDateRaw = $(el).find("pubDate").first().text().trim();
      const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null;

      if (!headline) return;

      articles.push({
        headline,
        source: SOURCE,
        language: "en",
        url: link || url,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        rawText: headline,
      });
    });

    return articles;
  } finally {
    clearTimeout(timer);
  }
}

export async function scrape(): Promise<RawArticle[]> {
  try {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const all = results.flat();

    // Deduplicate by headline (case-insensitive)
    const seen = new Set<string>();
    const deduped: RawArticle[] = [];
    for (const article of all) {
      const key = article.headline.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(article);
      }
    }

    return deduped;
  } catch {
    return [];
  }
}
