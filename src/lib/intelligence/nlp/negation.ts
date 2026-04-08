/**
 * Negation detection for the IndiFlow NLP classifier.
 *
 * Strategy:
 * 1. Build a token list from the normalised text.
 * 2. For each incident-keyword position, look back up to NEGATION_WINDOW tokens.
 * 3. If any negation token is found in that window, the keyword match is negated.
 *
 * Additionally checks for "clearance" phrases that signal the incident is OVER
 * (e.g. "traffic cleared", "road opened") — these also negate the incident signal.
 */

/** Maximum number of tokens to look back before an incident keyword. */
const NEGATION_WINDOW = 3;

/**
 * Tokens that directly negate the following incident keyword.
 * Checked in the NEGATION_WINDOW positions *before* the keyword.
 */
export const NEGATION_TOKENS: string[] = [
  "no",
  "not",
  "never",
  "without",
  "free",
  "absent",
  "none",
  "zero",
  "nahi",          // Hindi/Bengali Roman: "no"
  "nei",           // Bengali: "not/no"
  "kono",          // Bengali: "no/any" (নেই কোনো)
  "na",            // Bengali/Hindi: "no"
  "noy",           // Bengali: "not"
];

/**
 * Phrases that indicate an incident has been RESOLVED.
 * These apply to the whole article, not a positional window.
 * If matched, the entire article result is negated.
 */
export const CLEARANCE_PHRASES: string[] = [
  "cleared",
  "clear",
  "normalised",
  "normalized",
  "normal",
  "lifted",
  "removed",
  "restored",
  "opened",
  "reopened",
  "re-opened",
  "free now",
  "moving now",
  "traffic moving",
  "situation normal",
  "no more jam",
  "no longer",
  "has cleared",
  "has been cleared",
  "jam cleared",
  "signal restored",
  "road opened",
  "road cleared",
  "flood receded",
  "water receded",
  "water cleared",
  "diversion lifted",
  "block removed",
  // Bengali Roman
  "phoriyeche",    // cleared up
  "thik hoyeche",  // fixed/okay now
  "thik ache",     // is fine now
  "chere diyeche", // released/opened
  "khule giyeche", // opened up
  "jot chere geche", // jam cleared
  // Bengali script
  "স্বাভাবিক",    // normal
  "যানজট মুক্ত",  // jam free
  "ছেড়ে দিয়েছে", // released
  "খুলে গেছে",    // opened
  "পরিষ্কার",    // clear/cleaned
];

export interface NegationCheckResult {
  /** True if the keyword at `keywordIndex` is negated by a preceding token. */
  negatedByPrecedingToken: boolean;
  /** The negation token that caused the negation, if any. */
  negatingToken: string | null;
  /** True if the article contains a clearance phrase anywhere in the text. */
  clearedByPhrase: boolean;
  /** The clearance phrase found, if any. */
  clearancePhrase: string | null;
  /** Combined: true if either preceding-token OR clearance-phrase triggered. */
  isNegated: boolean;
}

/**
 * Tokenise text into lowercase word tokens, stripping punctuation.
 * Preserves multi-word units as individual tokens (not bigrams) —
 * the caller is responsible for phrase-level checks.
 */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[।,;:!?"""''()\[\]{}<>]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Check whether a keyword occurrence at `keywordTokenIndex` within `tokens`
 * is negated by a preceding negation token within NEGATION_WINDOW positions.
 */
function checkPrecedingNegation(
  tokens: string[],
  keywordTokenIndex: number
): { negated: boolean; token: string | null } {
  const start = Math.max(0, keywordTokenIndex - NEGATION_WINDOW);
  for (let i = keywordTokenIndex - 1; i >= start; i--) {
    if (NEGATION_TOKENS.includes(tokens[i])) {
      return { negated: true, token: tokens[i] };
    }
  }
  return { negated: false, token: null };
}

/**
 * Check whether the full article text contains any clearance phrase.
 */
function checkClearancePhrases(text: string): {
  found: boolean;
  phrase: string | null;
} {
  const lower = text.toLowerCase();
  for (const phrase of CLEARANCE_PHRASES) {
    if (lower.includes(phrase)) {
      return { found: true, phrase };
    }
  }
  return { found: false, phrase: null };
}

/**
 * Full negation check for a keyword found at a specific character position
 * within the original article text.
 *
 * @param fullText   - The original article text.
 * @param tokens     - Pre-tokenised array of the full text.
 * @param keywordTokenIndex - The token index where the incident keyword starts.
 */
export function checkNegation(
  fullText: string,
  tokens: string[],
  keywordTokenIndex: number
): NegationCheckResult {
  const preceding = checkPrecedingNegation(tokens, keywordTokenIndex);
  const clearance = checkClearancePhrases(fullText);

  return {
    negatedByPrecedingToken: preceding.negated,
    negatingToken: preceding.token,
    clearedByPhrase: clearance.found,
    clearancePhrase: clearance.phrase,
    isNegated: preceding.negated || clearance.found,
  };
}

/**
 * Find the token index of a keyword (which may be multi-word) within tokens.
 * Returns -1 if not found.
 *
 * For multi-word keywords like "traffic jam" this checks consecutive token sequences.
 */
export function findKeywordTokenIndex(
  tokens: string[],
  keyword: string
): number {
  const kTokens = keyword.toLowerCase().split(/\s+/);
  if (kTokens.length === 1) {
    return tokens.indexOf(kTokens[0]);
  }
  for (let i = 0; i <= tokens.length - kTokens.length; i++) {
    if (kTokens.every((kt, j) => tokens[i + j] === kt)) {
      return i;
    }
  }
  return -1;
}
