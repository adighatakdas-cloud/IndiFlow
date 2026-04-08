import { KeywordMatch } from "./types";

/**
 * Confidence score formula for IndiFlow NLP classifier.
 *
 * Final score is a weighted combination of:
 *   1. Keyword score        — derived from matched keyword weights
 *   2. Road name bonus      — flat bonus if a road alias was matched
 *   3. Geocodable bonus     — additional bonus if the road name is geocodable
 *   4. Negation penalty     — large penalty if dominant match is negated
 *   5. Language alignment   — small bonus if detected language matches article hint
 *
 * All intermediate values are clamped to [0, 1] before weighting.
 * Final score is clamped to [0.0, 1.0].
 */

/** Weights for each scoring component (must sum to 1.0). */
const COMPONENT_WEIGHTS = {
  keyword: 0.55,
  roadName: 0.20,
  geocodable: 0.10,
  languageAlignment: 0.05,
  // negation is a multiplicative penalty, not additive
} as const;

/** Maximum number of keyword matches to consider (diminishing returns beyond this). */
const MAX_KEYWORD_CONTRIBUTION = 5;

/**
 * Negation penalty multiplier applied to the final score.
 * 0.15 means a negated result keeps only 15% of its raw score.
 */
const NEGATION_PENALTY_MULTIPLIER = 0.15;

/**
 * Compute the raw keyword score from a list of matched keywords.
 *
 * - Takes the top N matches by weight (sorted descending).
 * - First match contributes its full weight.
 * - Each subsequent match contributes a diminishing fraction.
 * - Result is normalised to [0, 1].
 */
function computeKeywordScore(matches: KeywordMatch[]): number {
  if (matches.length === 0) return 0;

  // Use only non-negated matches for scoring; negated ones count against
  const positiveMatches = matches
    .filter((m) => !m.negated)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_KEYWORD_CONTRIBUTION);

  if (positiveMatches.length === 0) return 0;

  // Weighted sum with diminishing returns: weight[i] * (0.85 ^ i)
  let rawScore = 0;
  let maxPossible = 0;
  for (let i = 0; i < positiveMatches.length; i++) {
    const decay = Math.pow(0.85, i);
    rawScore += positiveMatches[i].weight * decay;
    maxPossible += 1.0 * decay; // max weight is 1.0
  }

  return Math.min(rawScore / maxPossible, 1.0);
}

export interface ConfidenceInputs {
  /** All keyword matches from the classifier (may include negated ones). */
  matches: KeywordMatch[];
  /** True if a Kolkata road alias was found in the article. */
  roadNameFound: boolean;
  /** True if the road name is likely geocodable via Nominatim. */
  geocodable: boolean;
  /** True if the dominant match cluster was flagged as negated. */
  negationDetected: boolean;
  /** Article language hint (from RawArticle) — "en" | "bn" | "mixed" | undefined. */
  articleLanguageHint?: string;
  /** Language detected by the classifier — "en" | "bn" | "mixed". */
  detectedLanguage: "en" | "bn" | "mixed";
}

export interface ConfidenceBreakdown {
  /** Final clamped confidence score 0.0 – 1.0. */
  score: number;
  /** Raw keyword component before weighting. */
  keywordComponent: number;
  /** Road name component (0 or COMPONENT_WEIGHTS.roadName). */
  roadNameComponent: number;
  /** Geocodable component (0 or COMPONENT_WEIGHTS.geocodable). */
  geocodableComponent: number;
  /** Language alignment component. */
  languageComponent: number;
  /** Whether negation penalty was applied. */
  negationApplied: boolean;
}

/**
 * Compute a confidence score for a classification result.
 * Returns the final score and a breakdown for debugging.
 */
export function computeConfidence(
  inputs: ConfidenceInputs
): ConfidenceBreakdown {
  const keywordScore = computeKeywordScore(inputs.matches);
  const keywordComponent = keywordScore * COMPONENT_WEIGHTS.keyword;

  const roadNameComponent = inputs.roadNameFound
    ? COMPONENT_WEIGHTS.roadName
    : 0;

  const geocodableComponent =
    inputs.geocodable && inputs.roadNameFound
      ? COMPONENT_WEIGHTS.geocodable
      : 0;

  // Language alignment: small bonus if the detected language matches the hint
  let languageComponent = 0;
  if (
    inputs.articleLanguageHint &&
    inputs.detectedLanguage === inputs.articleLanguageHint
  ) {
    languageComponent = COMPONENT_WEIGHTS.languageAlignment;
  } else if (!inputs.articleLanguageHint) {
    // No hint provided — give half the bonus (we can't confirm or deny)
    languageComponent = COMPONENT_WEIGHTS.languageAlignment * 0.5;
  }

  const rawScore =
    keywordComponent +
    roadNameComponent +
    geocodableComponent +
    languageComponent;

  // Apply negation as a multiplicative penalty
  const finalScore = inputs.negationDetected
    ? rawScore * NEGATION_PENALTY_MULTIPLIER
    : rawScore;

  return {
    score: Math.max(0, Math.min(1, finalScore)),
    keywordComponent,
    roadNameComponent,
    geocodableComponent,
    languageComponent,
    negationApplied: inputs.negationDetected,
  };
}

/**
 * Minimum confidence threshold below which a result is downgraded to UNKNOWN.
 * Caller decides whether to apply this; exported for use in classifier.ts.
 */
export const UNKNOWN_CONFIDENCE_THRESHOLD = 0.15;
