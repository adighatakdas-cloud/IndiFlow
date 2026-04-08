import * as cheerio from "cheerio";
import { RawArticle } from "../types";

const URL = "https://www.telegraphindia.com/calcutta";
const SOURCE = "telegraph_india";
const TIMEOUT_MS = 8000;
const MAX_ARTICLES = 20;

const HEADLINE_SELECTORS = [
  "h2.title a",
  ".story-title a",
  "h3 a",
  "h2 a",
];

export async function scrape(): Promise<RawArticle[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let html: string;
    try {
      const response = await fetch(URL, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; IndiFlow/1.0; +https://indiflow.in)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) return [];
      html = await response.text();
    } finally {
      clearTimeout(timer);
    }

    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const articles: RawArticle[] = [];

    for (const selector of HEADLINE_SELECTORS) {
      $(selector).each((_, el) => {
        if (articles.length >= MAX_ARTICLES) return false; // break

        const headline = $(el).text().trim();
        if (!headline || seen.has(headline.toLowerCase())) return;

        const href = $(el).attr("href") ?? "";
        const url = href.startsWith("http")
          ? href
          : href
          ? `https://www.telegraphindia.com${href}`
          : URL;

        seen.add(headline.toLowerCase());
        articles.push({
          headline,
          source: SOURCE,
          language: "en",
          url,
          publishedAt: null,
          rawText: headline,
        });
      });

      if (articles.length >= MAX_ARTICLES) break;
    }

    return articles.slice(0, MAX_ARTICLES);
  } catch {
    return [];
  }
}
