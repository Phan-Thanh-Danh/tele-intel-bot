/**
 * lib/detailAudit.js
 *
 * Detail Audit: Cross-checks words and numbers in an output digest against
 * the source articles and recent event titles. Returns a report of tokens
 * not found in any source, for human review.
 *
 * This is a REPORT for human review, NOT a pass/fail gate.
 */

"use strict";

// Stopword list: common Vietnamese and English function words to skip during audit.
const STOPWORDS = new Set([
  // English
  "that", "this", "with", "from", "have", "been", "were", "will", "they",
  "them", "their", "than", "then", "when", "where", "which", "what", "while",
  "also", "into", "onto", "upon", "each", "both", "such", "some", "more",
  "most", "only", "just", "over", "after", "before", "about", "above",
  "below", "between", "through", "during", "without", "within", "these",
  "those", "other", "another", "first", "last", "next", "many", "much",
  "already", "being",
  // Vietnamese function words
  "với", "của", "trong", "theo", "được", "là", "và", "cho", "về",
  "tại", "bởi", "đây", "này", "đó", "còn", "đã", "sẽ", "đang",
  "khi", "như", "nhưng", "mà", "nếu", "thì", "hay", "hoặc", "vì",
  "bởi", "nên", "từ", "đến", "sang", "qua", "sau", "trước", "dưới",
  "trên", "lên", "xuống", "vào", "ra", "lại", "cũng", "chỉ", "rất",
  "không", "chưa", "đều", "mọi", "cả", "các", "những", "một", "hai",
  "nhiều", "ít", "hơn", "nhất", "khác", "mới", "cũ", "tiếp", "theo",
  "đây", "đó", "nào", "gì", "ai", "bao", "mấy", "sao", "thế", "vậy"
]);

/**
 * Strips Vietnamese diacritical marks and lowercases a string.
 */
function normalize(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Builds a combined normalized text corpus from all source articles and recent events.
 */
function buildSourceCorpus(sourceArticles, recentEvents) {
  const parts = [];
  for (const art of sourceArticles || []) {
    if (art.title) parts.push(art.title);
    if (art.content_snippet) parts.push(art.content_snippet);
    if (art.full_text) parts.push(art.full_text);
    if (art.core_verdict) parts.push(art.core_verdict);
  }
  for (const evt of recentEvents || []) {
    if (evt.title) parts.push(evt.title);
  }
  return normalize(parts.join(" "));
}

/**
 * Extracts words (length >= 4) and numbers from a string.
 * Returns array of { token, type } objects.
 */
function extractTokens(text) {
  const tokens = [];
  const normalizedText = normalize(text);

  // Extract numbers (including decimal and comma-separated)
  const numberPattern = /\d[\d,\.]*\d|\d/g;
  let m;
  while ((m = numberPattern.exec(normalizedText)) !== null) {
    tokens.push({ token: m[0], type: "number" });
  }

  // Extract words of length >= 4 (after removing numbers)
  const wordText = normalizedText.replace(/[\d,\.]+/g, " ");
  const wordPattern = /[a-z\u00e0-\u024f]{4,}/g;
  while ((m = wordPattern.exec(wordText)) !== null) {
    const word = m[0];
    if (!STOPWORDS.has(word)) {
      tokens.push({ token: word, type: "word" });
    }
  }

  return tokens;
}

/**
 * Extracts all text from an output digest object.
 */
function extractDigestText(outputDigest) {
  const parts = [];
  if (outputDigest.overview) parts.push(outputDigest.overview);
  for (const evt of outputDigest.events || []) {
    if (evt.title) parts.push(evt.title);
    if (evt.core_verdict) parts.push(evt.core_verdict);
    if (Array.isArray(evt.key_highlights)) parts.push(evt.key_highlights.join(" "));
    if (evt.impact) parts.push(evt.impact);
  }
  return parts.join(" ");
}

/**
 * Performs a detail audit of the output digest against source articles and recent events.
 *
 * @param {Object} outputDigest - The synthesized digest object { overview, events }
 * @param {Array<Object>} sourceArticles - The input articles used for synthesis
 * @param {Array<{title: string, date: string}>} recentEvents - Previously reported events
 * @returns {Array<{word: string, type: string, foundInSources: false}>} - Report array
 */
function detailAudit(outputDigest, sourceArticles, recentEvents) {
  const digestText = extractDigestText(outputDigest);
  const corpus = buildSourceCorpus(sourceArticles, recentEvents);
  const tokens = extractTokens(digestText);

  // Deduplicate tokens
  const seen = new Set();
  const uniqueTokens = [];
  for (const t of tokens) {
    if (!seen.has(t.token)) {
      seen.add(t.token);
      uniqueTokens.push(t);
    }
  }

  // Check which tokens are NOT found in the source corpus
  const report = [];
  for (const { token, type } of uniqueTokens) {
    if (!corpus.includes(token)) {
      report.push({ word: token, type, foundInSources: false });
    }
  }

  return report;
}

module.exports = { detailAudit };
