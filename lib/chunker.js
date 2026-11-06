/**
 * Text processing, entity escaping, and Telegram HTML smart chunking engine.
 * Adheres strictly to SRP: Chunking, escaping, and message formatting only.
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
 * Safely extracts a display domain from a URL string.
 * @param {string} urlString
 * @returns {string}
 */
function extractSourceDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "Nguồn";
  }
}

/**
 * Formats a single event object into a clean HTML block.
 * @param {Object} event
 * @param {string} event.title
 * @param {string} event.details
 * @param {string} event.impact
 * @param {string[]} [event.sources]
 * @returns {string}
 */
function formatEventBlock(event) {
  const title = escapeHtml(event.title || "Tin tức");
  const details = escapeHtml(event.details || "");
  const impact = escapeHtml(event.impact || "");

  let sourcesHtml = "";
  if (Array.isArray(event.sources) && event.sources.length > 0) {
    const validSources = event.sources.filter((s) => typeof s === "string" && s.startsWith("http"));
    if (validSources.length > 0) {
      const sourceLinks = validSources
        .map((src, idx) => {
          const domain = escapeHtml(extractSourceDomain(src));
          return `<a href="${src}">${domain || `Nguồn ${idx + 1}`}</a>`;
        })
        .join(", ");
      sourcesHtml = `\n🔗 <b>Nguồn:</b> ${sourceLinks}`;
    }
  }

  return (
    `🔹 <b>${title}</b>\n` +
    `${details}\n` +
    `💡 <b>Tác động:</b> ${impact}` +
    `${sourcesHtml}\n\n`
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
        // Fallback split by lines or characters if a single paragraph is too large
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
 * @param {Object} digest
 * @param {string} digest.topic
 * @param {number|string} digest.deliveryHour
 * @param {Object} digest.summary
 * @param {string} digest.summary.overview
 * @param {Array<Object>} digest.summary.events
 * @returns {string[]} Array of formatted HTML pages
 */
function chunkDigestToPages(digest) {
  const { topic, deliveryHour, summary } = digest;
  const normalizedHour = String(deliveryHour).padStart(2, "0");
  const upperTopic = escapeHtml(topic.toUpperCase());

  const overview = escapeHtml(summary?.overview || "Không có biến động lớn trong khung giờ này.");
  const events = Array.isArray(summary?.events) ? summary.events : [];

  // If no events exist, return single empty-state page
  if (events.length === 0) {
    return [
      `🔔 <b>BẢN TIN (${normalizedHour}:00) | ${upperTopic}</b> (1/1)\n\n` +
      `📌 <b>TỔNG QUAN:</b>\n${overview}\n\n` +
      `<i>Hiện chưa ghi nhận thêm sự kiện đáng chú ý nào cho chủ đề này.</i>`
    ];
  }

  const rawPages = [];
  let currentPageContent = `📌 <b>TỔNG QUAN:</b>\n${overview}\n\n`;

  for (const event of events) {
    const eventBlock = formatEventBlock(event);

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
    const header = `🔔 <b>BẢN TIN (${normalizedHour}:00) | ${upperTopic}</b> (${pageNum}/${totalPages})\n\n`;
    return header + pageText;
  });
}

/**
 * Chunks instant on-demand research output into HTML pages.
 * @param {string} topic
 * @param {Object} summary
 * @returns {string[]}
 */
function chunkInstantResearchToPages(topic, summary) {
  const upperTopic = escapeHtml(topic.toUpperCase());
  const overview = escapeHtml(summary?.overview || "Tổng hợp nhanh.");
  const events = Array.isArray(summary?.events) ? summary.events : [];

  if (events.length === 0) {
    return [
      `⚡ <b>TỔNG HỢP NHANH: ${upperTopic}</b> (1/1)\n\n` +
      `📌 <b>TỔNG QUAN:</b>\n${overview}\n\n` +
      `<i>Không tìm thấy dữ liệu tin tức mới liên quan.</i>`
    ];
  }

  const rawPages = [];
  let currentPageContent = `📌 <b>TỔNG QUAN:</b>\n${overview}\n\n`;

  for (const event of events) {
    const eventBlock = formatEventBlock(event);
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
    const header = `⚡ <b>TỔNG HỢP NHANH: ${upperTopic}</b> (${pageNum}/${totalPages})\n\n`;
    return header + pageText;
  });
}

module.exports = {
  escapeHtml,
  extractSourceDomain,
  formatEventBlock,
  chunkDigestToPages,
  chunkInstantResearchToPages,
  MAX_PAGE_LENGTH
};
