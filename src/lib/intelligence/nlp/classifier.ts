/**
 * IndiFlow NLP Classifier — main entry point.
 *
 * Takes a RawArticle and returns a ClassificationResult.
 *
 * Pipeline:
 *   1. Language detection (Bengali script heuristic + compromise/natural)
 *   2. Tokenisation via `natural` WordTokenizer
 *   3. Keyword scan across English + Bengali keyword banks
 *   4. Negation check per keyword match
 *   5. Incident type determination (highest net weighted score wins)
 *   6. Road alias extraction from the article text
 *   7. Geocodability estimation
 *   8. Confidence scoring
 *   9. Final ClassificationResult assembly
 */

import natural from "natural";
import nlp from "compromise";
import {
  RawArticle,
  ClassificationResult,
  IncidentType,
  KeywordMatch,
  WeightedKeyword,
} from "./types";
import { englishKeywords } from "./keywords/english";
import { bengaliKeywords } from "./keywords/bengali";
import { resolveRoadAlias } from "./keywords/aliases";
import {
  tokenise,
  findKeywordTokenIndex,
  checkNegation,
} from "./negation";
import {
  computeConfidence,
  UNKNOWN_CONFIDENCE_THRESHOLD,
} from "./confidence";

// ---------------------------------------------------------------------------
// natural tokeniser (used for English tokenisation + stem hints)
// ---------------------------------------------------------------------------
const wordTokenizer = new natural.WordTokenizer();

// ---------------------------------------------------------------------------
// Bengali script detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the text contains enough Bengali Unicode code points
 * to be classified as containing Bengali.
 * Bengali block: U+0980 – U+09FF
 */
function hasBengaliScript(text: string): boolean {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0980 && cp <= 0x09ff) count++;
    if (count >= 3) return true; // threshold: at least 3 Bengali chars
  }
  return false;
}

/**
 * Detect article language.
 * Priority: explicit hint → script detection → keyword sampling.
 */
function detectLanguage(
  article: RawArticle,
  text: string
): "en" | "bn" | "mixed" {
  if (article.language) return article.language;

  const bengali = hasBengaliScript(text);
  // Rough English signal: compromise doc will find >2 known English words
  const doc = nlp(text.slice(0, 500)); // sample first 500 chars for speed
  const englishWords = doc.terms().out("array") as string[];
  const hasEnglish = englishWords.length > 2;

  if (bengali && hasEnglish) return "mixed";
  if (bengali) return "bn";
  return "en";
}

// ---------------------------------------------------------------------------
// Keyword scanning
// ---------------------------------------------------------------------------

interface ScanResult {
  type: IncidentType;
  matches: KeywordMatch[];
  netScore: number;
}

/**
 * Scan a token list for a single incident type's keyword bank.
 * Returns all matches with their negation status and a net weighted score.
 */
function scanForType(
  type: IncidentType,
  keywords: WeightedKeyword[],
  tokens: string[],
  fullText: string
): ScanResult {
  const matches: KeywordMatch[] = [];
  let netScore = 0;

  for (const kw of keywords) {
    const idx = findKeywordTokenIndex(tokens, kw.word);
    if (idx === -1) continue;

    const negResult = checkNegation(fullText, tokens, idx);
    const match: KeywordMatch = {
      keyword: kw.word,
      weight: kw.weight,
      position: idx,
      negated: negResult.isNegated,
    };
    matches.push(match);
    netScore += negResult.isNegated ? -kw.weight * 0.3 : kw.weight;
  }

  return { type, matches, netScore };
}

/**
 * Run the full keyword scan across all incident types and both language banks,
 * returning the best-matching type and the full match list for that type.
 */
function runKeywordScan(
  tokens: string[],
  fullText: string,
  detectedLanguage: "en" | "bn" | "mixed"
): {
  bestType: IncidentType;
  allMatches: KeywordMatch[];
  dominantNegated: boolean;
} {
  const incidentTypes = [
    IncidentType.JAM,
    IncidentType.ACCIDENT,
    IncidentType.SIGNAL,
    IncidentType.FLOODING,
    IncidentType.DIVERSION,
  ];

  // Merge English + Bengali keyword banks depending on detected language
  const shouldUseEnglish =
    detectedLanguage === "en" || detectedLanguage === "mixed";
  const shouldUseBengali =
    detectedLanguage === "bn" || detectedLanguage === "mixed";

  const scores: ScanResult[] = [];

  for (const type of incidentTypes) {
    const enKws: WeightedKeyword[] = shouldUseEnglish
      ? englishKeywords[type]
      : [];
    const bnKws: WeightedKeyword[] = shouldUseBengali
      ? bengaliKeywords[type]
      : [];

    // Run scans separately then merge
    const enResult = scanForType(type, enKws, tokens, fullText);
    const bnResult = scanForType(type, bnKws, tokens, fullText);

    scores.push({
      type,
      matches: [...enResult.matches, ...bnResult.matches],
      netScore: enResult.netScore + bnResult.netScore,
    });
  }

  // Pick the type with the highest net score
  const best = scores.reduce((a, b) => (b.netScore > a.netScore ? b : a));

  if (best.netScore <= 0) {
    return {
      bestType: IncidentType.UNKNOWN,
      allMatches: [],
      dominantNegated: false,
    };
  }

  // Determine if the dominant match cluster is primarily negated
  const positiveWeight = best.matches
    .filter((m) => !m.negated)
    .reduce((s, m) => s + m.weight, 0);
  const negatedWeight = best.matches
    .filter((m) => m.negated)
    .reduce((s, m) => s + m.weight, 0);
  const dominantNegated = negatedWeight > positiveWeight;

  return {
    bestType: best.type,
    allMatches: best.matches,
    dominantNegated,
  };
}

// ---------------------------------------------------------------------------
// Geocodability heuristic
// ---------------------------------------------------------------------------

/**
 * Estimate whether a canonical road name is likely geocodable via Nominatim.
 * Roads that are generic single words (e.g. "Bypass" alone) score poorly.
 * Named roads with 2+ word tokens are likely geocodable.
 */
function estimateGeocodable(canonical: string | null): boolean {
  if (!canonical) return false;
  const tokens = canonical.split(/\s+/).filter(Boolean);
  // Single generic words are ambiguous
  const genericSingleWords = new Set(["bypass", "road", "street", "avenue"]);
  if (tokens.length === 1 && genericSingleWords.has(tokens[0].toLowerCase())) {
    return false;
  }
  return tokens.length >= 2;
}

// ---------------------------------------------------------------------------
// Compromise-powered road name extractor
// ---------------------------------------------------------------------------

/**
 * Use compromise to extract proper noun phrases that might be road names,
 * then attempt alias resolution. Falls back to direct alias scan.
 */
function extractRoadName(text: string): {
  roadName: string | null;
  roadNameMatched: boolean;
  geocodable: boolean;
} {
  // First try direct alias scan (most reliable for Kolkata-specific names)
  const aliasResult = resolveRoadAlias(text);
  if (aliasResult) {
    return {
      roadName: aliasResult.canonical,
      roadNameMatched: true,
      geocodable: estimateGeocodable(aliasResult.canonical),
    };
  }

  // Fallback: use compromise to find proper noun phrases
  const doc = nlp(text);
  // Extract place-like noun phrases
  const places = doc
    .match("#Place+")
    .out("array") as string[];

  const nouns = doc
    .nouns()
    .out("array") as string[];

  const candidates = [...places, ...nouns];

  for (const candidate of candidates) {
    const resolved = resolveRoadAlias(candidate);
    if (resolved) {
      return {
        roadName: resolved.canonical,
        roadNameMatched: true,
        geocodable: estimateGeocodable(resolved.canonical),
      };
    }
  }

  return { roadName: null, roadNameMatched: false, geocodable: false };
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify a RawArticle into a ClassificationResult.
 *
 * This is the single exported function for the NLP layer.
 * It is synchronous and pure — no I/O, no side effects.
 */
export function classify(article: RawArticle): ClassificationResult {
  const rawText = article.text.trim();

  // 1. Language detection
  const detectedLanguage = detectLanguage(article, rawText);

  // 2. Tokenisation
  // Use natural for English-style tokenisation; for Bengali/mixed we rely on
  // whitespace splitting because natural does not handle Bengali script.
  let tokens: string[];
  if (detectedLanguage === "en") {
    tokens = (wordTokenizer.tokenize(rawText) ?? []).map((t) =>
      t.toLowerCase()
    );
  } else {
    tokens = tokenise(rawText);
  }

  // 3 + 4. Keyword scan + negation
  const { bestType, allMatches, dominantNegated } = runKeywordScan(
    tokens,
    rawText,
    detectedLanguage
  );

  // 5. Road name extraction
  const { roadName, roadNameMatched, geocodable } = extractRoadName(rawText);

  // 6. Confidence scoring
  const breakdown = computeConfidence({
    matches: allMatches,
    roadNameFound: roadNameMatched,
    geocodable,
    negationDetected: dominantNegated,
    articleLanguageHint: article.language,
    detectedLanguage,
  });

  // 7. Downgrade to UNKNOWN if confidence is too low
  const finalType =
    breakdown.score < UNKNOWN_CONFIDENCE_THRESHOLD
      ? IncidentType.UNKNOWN
      : bestType;

  return {
    articleId: article.id,
    type: finalType,
    confidence: breakdown.score,
    roadName,
    roadNameMatched,
    geocodable,
    matchedKeywords: allMatches,
    negationDetected: dominantNegated,
    classifiedAt: new Date().toISOString(),
    detectedLanguage,
  };
}

/**
 * Batch classify an array of RawArticles.
 * Returns results in the same order as input.
 */
export function classifyBatch(articles: RawArticle[]): ClassificationResult[] {
  return articles.map(classify);
}
