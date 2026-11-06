const cheerio = require("cheerio");

/**
 * Deep Scraping & Full-Text Extractor Module v4.
 * High-performance, in-memory clean body extractor.
 * Adheres strictly to SRP: Article extraction, DOM noise stripping, and text normalization.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FULLTEXT_TIMEOUT_MS = 6000;
const MAX_EXTRACTED_CHARS = 2500;

// Elements and class selectors to strip away as noise
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "header",
  "footer",
  "nav",
  "aside",
  ".ad",
  ".ads",
  ".advertisement",
  ".banner",
  ".social-share",
  ".share-buttons",
  ".comments",
  ".comment-section",
  ".related-posts",
  ".related-articles",
  ".sidebar",
  ".menu",
  ".cookie-banner",
  ".popup",
  ".newsletter-signup",
  ".outbrain",
  ".taboola"
];

// High-confidence body container selectors
const BODY_SELECTORS = [
  "article",
  '[itemprop="articleBody"]',
  ".article-body",
  ".article-content",
  ".story-body",
  ".post-content",
  ".entry-content",
  ".content-detail",
  ".fck_detail", // VnExpress main content class
  "main"
];

/**
 * Extracts full-text clean content from an article URL.
 * @param {string} url
 * @returns {Promise<string|null>} Clean text content, or null on failure
 */
async function extractFullText(url) {
  if (!url || !url.startsWith("http")) return null;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8"
      },
      signal: AbortSignal.timeout(FULLTEXT_TIMEOUT_MS),
      redirect: "follow"
    });

    if (!res.ok) {
      return null;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. Remove non-content and noise elements
    $(NOISE_SELECTORS.join(", ")).remove();

    // 2. Locate the best content container
    let container = null;
    for (const selector of BODY_SELECTORS) {
      const match = $(selector);
      if (match.length > 0 && match.text().trim().length > 300) {
        container = match.first();
        break;
      }
    }

    // Fallback to body if no specific article container matched
    if (!container) {
      container = $("body");
    }

    // 3. Extract and filter meaningful paragraphs
    const paragraphs = [];
    container.find("p").each((_, el) => {
      const pText = $(el)
        .text()
        .replace(/\s+/g, " ")
        .trim();

      // Discard one-liners, disclaimers, or empty lines
      if (pText.length >= 35) {
        // Discard typical boilerplate lines
        const lower = pText.toLowerCase();
        if (
          lower.includes("all rights reserved") ||
          lower.includes("bản quyền thuộc về") ||
          lower.includes("subscribe to read") ||
          lower.includes("sign up for our newsletter") ||
          lower.includes("follow us on")
        ) {
          return;
        }
        paragraphs.push(pText);
      }
    });

    if (paragraphs.length === 0) {
      return null;
    }

    const combinedText = paragraphs.join("\n\n");
    return combinedText.slice(0, MAX_EXTRACTED_CHARS);
  } catch {
    return null;
  }
}

module.exports = {
  extractFullText
};
