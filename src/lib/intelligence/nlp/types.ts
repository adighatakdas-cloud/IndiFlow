export enum IncidentType {
  JAM = "jam",
  ACCIDENT = "accident",
  SIGNAL = "signal",
  FLOODING = "flooding",
  DIVERSION = "diversion",
  UNKNOWN = "unknown",
}

export interface RawArticle {
  /** Unique identifier for deduplication */
  id: string;
  /** Raw article/post text */
  text: string;
  /** ISO timestamp when the article was published or scraped */
  publishedAt: string;
  /** Source identifier, e.g. "kolkata_traffic_police_fb", "telegraphindia_rss" */
  source: string;
  /** Optional URL for attribution */
  url?: string;
  /** Language hint — "en" | "bn" | "mixed". Classifier will auto-detect if absent. */
  language?: "en" | "bn" | "mixed";
}

export interface WeightedKeyword {
  word: string;
  /** 1.0 = primary signal, 0.6 = secondary signal, 0.3 = weak signal */
  weight: number;
}

export interface KeywordMatch {
  keyword: string;
  weight: number;
  position: number;
  negated: boolean;
}

export interface ClassificationResult {
  /** Reference back to RawArticle.id */
  articleId: string;
  /** Determined incident type */
  type: IncidentType;
  /** 0.0 – 1.0 confidence in the classification */
  confidence: number;
  /** Normalised road/area name extracted from text, if found */
  roadName: string | null;
  /** Whether the road name was successfully matched against known Kolkata aliases */
  roadNameMatched: boolean;
  /** True if the road name is likely geocodable via Nominatim */
  geocodable: boolean;
  /** All keyword matches that contributed to the decision */
  matchedKeywords: KeywordMatch[];
  /** True if the dominant match cluster was negated */
  negationDetected: boolean;
  /** ISO timestamp of classification */
  classifiedAt: string;
  /** Language detected: "en" | "bn" | "mixed" */
  detectedLanguage: "en" | "bn" | "mixed";
}
