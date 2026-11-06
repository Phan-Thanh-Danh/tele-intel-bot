const { getSourceBadge } = require("./sources_config");

/**
 * Text processing, entity escaping, and Telegram HTML smart chunking engine.
 * Adheres strictly to SRP: Chunking, escaping, and message formatting only.
 * OSINT Intelligence Analyst v3 Standard.
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
 * @returns {string}
 */
function getPriorityBadge(priority) {
  switch (priority?.toUpperCase?.()) {
    case "CRITICAL":
      return "🔴 <b>[TRỌNG YẾU]</b>";
    case "MAJOR":
      return "🟡 <b>[ĐÁNG CHÚ Ý]</b>";
    case "WATCHLIST":
      return "🟢 <b>[THEO DÕI]</b>";
    default:
      return "🟡 <b>[ĐÁNG CHÚ Ý]</b>";
  }
}

/**
 * Maps verification status to institutional credibility badge.
 * @param {string} status
 * @returns {string}
 */
function getVerificationBadge(status) {
  switch (status?.toUpperCase?.()) {
    case "VERIFIED_MULTI_SOURCE":
      return " 🛡️ <b>[ĐÃ KIỂM CHỨNG ĐA NGUỒN]</b>";
    case "SINGLE_SOURCE_WARNING":
      return " ⚠️ <b>[TIN CHƯA XÁC MINH - NGUỒN ĐƠN LẺ]</b>";
    case "CONTRADICTED":
      return " ⚡ <b>[MÂU THUẪN NGUỒN TIN]</b>";
    default:
      return "";
  }
}

/**
 * Maps legal status to compliance badge (Layer 9).
 * @param {string} status
 * @returns {string}
 */
function getLegalBadge(status) {
  switch (status?.toUpperCase?.()) {
    case "ENACTED":
      return " ⚖️ <b>[ĐÃ BAN HÀNH]</b>";
    case "PROPOSED":
      return " ⏳ <b>[DỰ THẢO / ĐỀ XUẤT]</b>";
    case "PENDING":
      return " ⚖️ <b>[ĐANG TRANH TỤNG / ĐÀM PHÁN]</b>";
    default:
      return "";
  }
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
 * Formats a single event object into a clean HTML block with Executive Inverted Pyramid styling.
 * @param {Object} event
 * @returns {string}
 */
function formatEventBlock(event) {
  const priorityBadge = getPriorityBadge(event.priority);
  const verifyBadge = getVerificationBadge(event.verification_status);
  const legalBadge = getLegalBadge(event.legal_status);
  const revisedBadge = event.is_revised ? " 🔄 <b>[SỐ LIỆU ĐÃ ĐIỀU CHỈNH REVISED]</b>" : "";
  const title = escapeHtml(event.title || "Tin tức");

  // Executive Core Verdict (1-2 sentences at the very top)
  let coreVerdictHtml = "";
  if (event.core_verdict) {
    coreVerdictHtml = `🎯 <b>KẾT LUẬN CỐT LÕI:</b>\n${formatMarkdownBold(event.core_verdict)}\n──────────────────────\n`;
  }

  // Key Highlights (2-3 bullet points with bold numbers)
  let highlightsHtml = "";
  if (Array.isArray(event.key_highlights) && event.key_highlights.length > 0) {
    const items = event.key_highlights
      .map((hl) => `• ${formatMarkdownBold(hl)}`)
      .join("\n");
    highlightsHtml = `📌 <b>ĐIỂM THEN CHỐT CẦN LƯU Ý:</b>\n${items}\n`;
  } else if (event.hard_facts || event.details) {
    highlightsHtml = `• 📊 <b>Dữ kiện thực tế:</b> ${formatMarkdownBold(event.hard_facts || event.details)}\n`;
  }

  // Metric Comparison Table (if numerical metrics exist)
  let metricTableHtml = "";
  if (Array.isArray(event.metric_table) && event.metric_table.length > 0) {
    const rows = event.metric_table
      .filter((m) => m && m.label)
      .map((m) => `• <b>${escapeHtml(m.label)}:</b> Thực tế: <b>${escapeHtml(m.actual || "N/A")}</b> | Trước/Dự báo: <b>${escapeHtml(m.forecast || "N/A")}</b> (${escapeHtml(m.change || "0")})`)
      .join("\n");
    if (rows) {
      metricTableHtml = `📊 <b>ĐỐI CHIẾU SỐ LIỆU CHÍNH:</b>\n${rows}\n`;
    }
  }

  // Information Gap (Blind-Spot Analysis)
  let gapHtml = "";
  if (event.information_gap && event.information_gap.trim().length > 0) {
    gapHtml = `⚠️ <b>GÓC KHUYẾT THÔNG TIN:</b> <i>${escapeHtml(event.information_gap)}</i>\n`;
  }

  // Delta update & Media Framing
  let deltaBlock = event.delta_update ? `• 🆕 <b>Cập nhật khác biệt (Δ):</b> ${escapeHtml(event.delta_update)}\n` : "";
  let framingBlock = event.media_framing ? `• 🌐 <b>Góc nhìn truyền thông:</b> ${escapeHtml(event.media_framing)}\n` : "";
  let impactBlock = event.impact ? `• 💡 <b>Phân tích chiến lược:</b> ${formatMarkdownBold(event.impact)}\n` : "";

  // Sources with Tier icons
  let sourcesHtml = "";
  if (Array.isArray(event.sources) && event.sources.length > 0) {
    const sourceLinks = event.sources
      .map((src, idx) => {
        let url = "";
        let displayName = "";
        let tierIcon = "📰";
        if (typeof src === "object" && src !== null) {
          url = src.url || "";
          displayName = src.name || extractSourceDomain(url);
          tierIcon = src.tier === 1 ? "🏛️" : src.tier === 2 ? "📰" : "💬";
        } else if (typeof src === "string") {
          url = src;
          displayName = getSourceBadge(src) || extractSourceDomain(src);
        }
        if (!url || !url.startsWith("http")) return null;
        return `<a href="${escapeHtml(url)}">${tierIcon} ${escapeHtml(displayName || `Nguồn ${idx + 1}`)}</a>`;
      })
      .filter(Boolean)
      .join(" | ");

    if (sourceLinks) {
      sourcesHtml = `• 🔗 ${sourceLinks}\n`;
    }
  }

  return (
    `${priorityBadge}${verifyBadge}${legalBadge}${revisedBadge}\n` +
    `<b>${title}</b>\n\n` +
    coreVerdictHtml +
    highlightsHtml +
    metricTableHtml +
    gapHtml +
    deltaBlock +
    framingBlock +
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
 * @returns {string[]} Array of formatted HTML pages
 */
function chunkDigestToPages(digest) {
  const { topic, deliveryHour, summary } = digest;
  const normalizedHour = String(deliveryHour).padStart(2, "0");
  const upperTopic = escapeHtml(topic.toUpperCase());

  const overview = escapeHtml(summary?.overview || "Không có biến động lớn trong khung giờ này.");
  const trendRadar = summary?.trend_radar ? escapeHtml(summary.trend_radar) : null;
  const events = Array.isArray(summary?.events) ? summary.events : [];

  let page1Intro = `📌 <b>TỔNG QUAN:</b>\n${overview}\n\n`;
  if (trendRadar) {
    page1Intro += `🔮 <b>DỰ ĐOÁN XU HƯỚNG (24H - 48H TỚI):</b>\n<i>${trendRadar}</i>\n\n`;
  }

  // If no events exist, return single empty-state page
  if (events.length === 0) {
    return [
      `🔔 <b>BẢN TIN (${normalizedHour}:00) | ${upperTopic}</b> (1/1)\n\n` +
      page1Intro +
      `<i>Hiện chưa ghi nhận thêm sự kiện đáng chú ý nào cho chủ đề này.</i>`
    ];
  }

  const rawPages = [];
  let currentPageContent = page1Intro;

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
 * Chunks instant on-demand research output into HTML pages with v2 layout.
 * @param {string} topic
 * @param {Object} summary
 * @returns {string[]}
 */
function chunkInstantResearchToPages(topic, summary) {
  const upperTopic = escapeHtml(topic.toUpperCase());
  const overview = escapeHtml(summary?.overview || "Tổng hợp nhanh tình báo.");
  const trendRadar = summary?.trend_radar ? escapeHtml(summary.trend_radar) : null;
  const events = Array.isArray(summary?.events) ? summary.events : [];

  let page1Intro = `📌 <b>TỔNG QUAN:</b>\n${overview}\n\n`;
  if (trendRadar) {
    page1Intro += `🔮 <b>DỰ ĐOÁN XU HƯỚNG (24H - 48H TỚI):</b>\n<i>${trendRadar}</i>\n\n`;
  }

  if (events.length === 0) {
    return [
      `⚡ <b>TỔNG HỢP NHANH: ${upperTopic}</b> (1/1)\n\n` +
      page1Intro +
      `<i>Không tìm thấy dữ liệu tin tức mới liên quan.</i>`
    ];
  }

  const rawPages = [];
  let currentPageContent = page1Intro;

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
  getPriorityBadge,
  extractSourceDomain,
  formatEventBlock,
  chunkDigestToPages,
  chunkInstantResearchToPages,
  MAX_PAGE_LENGTH
};
