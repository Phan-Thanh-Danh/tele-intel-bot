const { getSourceBadge } = require("./sources_config");
const { t } = require("./i18n");

/**
 * Text processing, entity escaping, and Telegram HTML smart chunking engine.
 * Adheres strictly to SRP: Chunking, escaping, and message formatting only.
 * OSINT Intelligence Analyst v4 Multilingual Standard.
 */

const MAX_PAGE_LENGTH = 3500;

/**
 * Escapes unsafe characters for Telegram HTML parse_mode.
 * @param {string} unsafeText
 * @returns {string}
 */
function escapeHtml(unsafeText) {
  if (typeof unsafeText !== "string") return "";
  return unsafeText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Maps event significance priority to visual HTML badge.
 * @param {string} priority
 * @param {string} [langCode="en"]
 * @returns {string}
 */
function getPriorityBadge(priority, langCode = "en") {
  if (priority?.toUpperCase?.() === "HIGH") {
    return t(langCode, "badge_high");
  }
  return t(langCode, "badge_normal");
}

/**
 * Maps verification status to evidence-based credibility badge.
 * Multi-source is deterministically determined by actual source count.
 * @param {Array} sources
 * @param {string} [langCode="en"]
 * @returns {string}
 */
function getVerificationBadge(sources, langCode = "en") {
  if (Array.isArray(sources) && sources.length >= 2) {
    return t(langCode, "badge_multi_source");
  }
  return t(langCode, "badge_single_source");
}

/**
 * Escapes HTML and safely converts **bold** markers to <b> tags.
 * @param {string} text
 * @returns {string}
 */
function formatMarkdownBold(text) {
  if (typeof text !== "string") return "";
  const escaped = escapeHtml(text);
  return escaped.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
}

/**
 * Safely extracts a display domain from a URL string.
 * @param {string} urlString
 * @param {string} [defaultLabel="Source"]
 * @returns {string}
 */
function extractSourceDomain(urlString, defaultLabel = "Source") {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return defaultLabel;
  }
}

/**
 * Formats a single event object into a clean HTML block with Executive Inverted Pyramid styling.
 * Universally applicable to any news topic (sports, tech, politics, finance, etc.).
 * @param {Object} event
 * @param {string} [langCode="en"]
 * @returns {string}
 */
function formatEventBlock(event, langCode = "en") {
  const priorityBadge = getPriorityBadge(event.priority, langCode);
  const verifyBadge = getVerificationBadge(event.sources, langCode);
  const title = escapeHtml(event.title || t(langCode, "report_source_label"));

  // Executive Core Verdict (1-2 sentences at the very top)
  let coreVerdictHtml = "";
  if (event.core_verdict) {
    coreVerdictHtml = `${t(langCode, "report_core_verdict")}\n${formatMarkdownBold(event.core_verdict)}\n──────────────────────\n`;
  }

  // Key Highlights (2-3 bullet points with bold numbers or names)
  let highlightsHtml = "";
  if (Array.isArray(event.key_highlights) && event.key_highlights.length > 0) {
    const items = event.key_highlights
      .map((hl) => `• ${formatMarkdownBold(hl)}`)
      .join("\n");
    highlightsHtml = `${t(langCode, "report_key_highlights")}\n${items}\n`;
  }

  // Strategic / Event Impact (if available)
  let impactBlock = event.impact ? `• ${t(langCode, "report_strategic_impact")} ${formatMarkdownBold(event.impact)}\n` : "";

  // Authentic Verified Sources
  let sourcesHtml = "";
  if (Array.isArray(event.sources) && event.sources.length > 0) {
    const defaultSrcLabel = t(langCode, "report_source_label");
    const sourceLinks = event.sources
      .map((src, idx) => {
        let url = "";
        let displayName = "";
        if (typeof src === "object" && src !== null) {
          url = src.url || "";
          displayName = src.name || extractSourceDomain(url, defaultSrcLabel);
        } else if (typeof src === "string") {
          url = src;
          displayName = extractSourceDomain(src, defaultSrcLabel);
        }
        if (!url || !url.startsWith("http")) return null;
        return `<a href="${escapeHtml(url)}">📰 ${escapeHtml(displayName || `${defaultSrcLabel} ${idx + 1}`)}</a>`;
      })
      .filter(Boolean)
      .join(" | ");

    if (sourceLinks) {
      sourcesHtml = `• 🔗 ${sourceLinks}\n`;
    }
  }

  return (
    `${priorityBadge}${verifyBadge}\n` +
    `<b>${title}</b>\n\n` +
    coreVerdictHtml +
    highlightsHtml +
    impactBlock +
    sourcesHtml +
    `──────────────────────\n\n`
  );
}

/**
 * Splits a very large text block into chunks smaller than maxLen by paragraph boundaries.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string[]}
 */
function splitLongText(text, maxLen = MAX_PAGE_LENGTH) {
  if (text.length <= maxLen) return [text];

  const paragraphs = text.split("\n\n");
  const chunks = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if ((currentChunk + "\n\n" + para).length > maxLen) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      if (para.length > maxLen) {
        let remaining = para;
        while (remaining.length > maxLen) {
          chunks.push(remaining.slice(0, maxLen));
          remaining = remaining.slice(maxLen);
        }
        if (remaining.length > 0) {
          currentChunk = remaining;
        }
      } else {
        currentChunk = para;
      }
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Chunks a synthesized intelligence digest into Telegram HTML pages (<= 3,500 chars).
 * Renders overview and trend_radar exclusively on Page 1.
 * @param {Object} digest
 * @param {string} digest.topic
 * @param {number|string} digest.deliveryHour
 * @param {Object} digest.summary
 * @param {string} digest.summary.overview
 * @param {string} [digest.summary.trend_radar]
 * @param {Array<Object>} digest.summary.events
 * @param {string} [langCode="en"]
 * @returns {string[]} Array of formatted HTML pages
 */
function chunkDigestToPages(digest, langCode = "en") {
  const { topic, deliveryHour, summary } = digest;
  const normalizedHour = String(deliveryHour).padStart(2, "0");
  const upperTopic = escapeHtml(topic.toUpperCase());

  const overview = summary?.overview ? escapeHtml(summary.overview) : null;
  const events = Array.isArray(summary?.events) ? summary.events : [];

  let page1Intro = overview ? `${t(langCode, "report_overview")}\n${overview}\n\n` : "";

  // If no events exist, return single empty-state page
  if (events.length === 0) {
    const header = t(langCode, "report_digest_header", { hour: normalizedHour, topic: upperTopic, page: 1, total: 1 });
    return [
      `${header}\n\n` +
      (page1Intro || "") +
      t(langCode, "report_no_news")
    ];
  }

  const rawPages = [];
  let currentPageContent = page1Intro;

  for (const event of events) {
    const eventBlock = formatEventBlock(event, langCode);

    // If a single event exceeds MAX_PAGE_LENGTH, split it safely
    if (eventBlock.length > MAX_PAGE_LENGTH) {
      if (currentPageContent.trim().length > 0) {
        rawPages.push(currentPageContent.trim());
        currentPageContent = "";
      }
      const subChunks = splitLongText(eventBlock, MAX_PAGE_LENGTH);
      for (const sub of subChunks) {
        rawPages.push(sub);
      }
      continue;
    }

    // Check if adding this event exceeds page capacity (accounting for header reserve)
    if ((currentPageContent + eventBlock).length > (MAX_PAGE_LENGTH - 150)) {
      rawPages.push(currentPageContent.trim());
      currentPageContent = eventBlock;
    } else {
      currentPageContent += eventBlock;
    }
  }

  if (currentPageContent.trim().length > 0) {
    rawPages.push(currentPageContent.trim());
  }

  const totalPages = rawPages.length;
  return rawPages.map((pageText, index) => {
    const pageNum = index + 1;
    const header = t(langCode, "report_digest_header", { hour: normalizedHour, topic: upperTopic, page: pageNum, total: totalPages });
    return `${header}\n\n${pageText}`;
  });
}

/**
 * Chunks instant on-demand research output into HTML pages with v2 layout.
 * @param {string} topic
 * @param {Object} summary
 * @param {string} [langCode="en"]
 * @returns {string[]}
 */
function chunkInstantResearchToPages(topic, summary, langCode = "en") {
  const upperTopic = escapeHtml(topic.toUpperCase());
  const overview = summary?.overview ? escapeHtml(summary.overview) : null;
  const events = Array.isArray(summary?.events) ? summary.events : [];

  let page1Intro = overview ? `${t(langCode, "report_overview")}\n${overview}\n\n` : "";

  if (events.length === 0) {
    const header = t(langCode, "report_instant_header", { topic: upperTopic, page: 1, total: 1 });
    return [
      `${header}\n\n` +
      (page1Intro || "") +
      t(langCode, "report_no_news")
    ];
  }

  const rawPages = [];
  let currentPageContent = page1Intro;

  for (const event of events) {
    const eventBlock = formatEventBlock(event, langCode);
    if ((currentPageContent + eventBlock).length > (MAX_PAGE_LENGTH - 150)) {
      rawPages.push(currentPageContent.trim());
      currentPageContent = eventBlock;
    } else {
      currentPageContent += eventBlock;
    }
  }

  if (currentPageContent.trim().length > 0) {
    rawPages.push(currentPageContent.trim());
  }

  const totalPages = rawPages.length;
  return rawPages.map((pageText, index) => {
    const pageNum = index + 1;
    const header = t(langCode, "report_instant_header", { topic: upperTopic, page: pageNum, total: totalPages });
    return `${header}\n\n${pageText}`;
  });
}

module.exports = {
  escapeHtml,
  getPriorityBadge,
  extractSourceDomain,
  formatEventBlock,
  chunkDigestToPages,
  chunkInstantResearchToPages,
  MAX_PAGE_LENGTH
};
