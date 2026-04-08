import * as cheerio from "cheerio";
import { RawArticle } from "../types";

const PRIMARY_FEED = "https://www.abplive.com/topic/traffic/feed";
const FALLBACK_FEED = "https://bengali.abplive.com/feed";
const SOURCE = "abp_ananda";
const TIMEOUT_MS = 8000;

async function fetchRssFeed(url: string): Promise<RawArticle[]> {
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
      const link =
        $(el).find("link").first().text().trim() ||
        $(el).find("guid").first().text().trim();
      const pubDateRaw = $(el).find("pubDate").first().text().trim();
      const publishedAt = pubDateRaw ? new Date(pubDateRaw) : null;
      const description = $(el).find("description").first().text().trim();

      if (!headline) return;

      articles.push({
        headline,
        source: SOURCE,
        language: "bn",
        url: link || url,
        publishedAt:
          publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        rawText: description ? `${headline} ${description}` : headline,
      });
    });

    return articles;
  } finally {
    clearTimeout(timer);
  }
}

export async function scrape(): Promise<RawArticle[]> {
  try {
    const primary = await fetchRssFeed(PRIMARY_FEED);
    if (primary.length > 0) return primary;

    // Fallback
    const fallback = await fetchRssFeed(FALLBACK_FEED);
    return fallback;
  } catch {
    return [];
  }
}
