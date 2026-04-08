export interface RawArticle {
  headline: string;
  source: string;
  language: "en" | "bn";
  url: string;
  publishedAt: Date | null;
  rawText: string;
}

export interface ScraperSource {
  name: string;
  scrape: () => Promise<RawArticle[]>;
}
