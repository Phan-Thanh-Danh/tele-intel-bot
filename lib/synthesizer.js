const OpenAI = require("openai");

const { getLanguageName } = require("./i18n");
const { recordLlmRequest, checkLlmBudget } = require("./db_operations");

/**
 * OpenRouter AI Synthesis Module - Enterprise OSINT Engine v4.
 *
 * Implements 12 Enterprise Intelligence Directives & Executive Presentation Layer:
 *   1. Executive Inverted Pyramid (Core Verdict in 1-2 sentences, Key Highlights with bolding, Metric Table)
 *   2. Information Gap Analysis (Checklist-based detection of what the media omits)
 *   3. Legal Status Classification (ENACTED vs PROPOSED vs PENDING)
 *   4. Temporal Revision Alignment (Data revisions override)
 *   5. Ground Truth Protocol (Tier 1 Primary > Tier 2 Mainstream > Tier 3 Community)
 *   6. Spin Neutralization (Despinned hard quantitative facts)
 *   7. Triangulation & Decision Gate (VERIFIED_MULTI_SOURCE vs SINGLE_SOURCE_WARNING)
 *   8. Astroturfing & Bot-Farm Filter (PR seeding warnings)
 *   9. Multi-Perspective Framing (Western vs Eastern vs Supply Chain Nodes)
 *   10. Delta (Δ) Update & State Tracking (Compares against event ledger history)
 *   11. Semantic & Metric Alignment (GAAP/Non-GAAP, calendar/fiscal year)
 *   12. Multi-Language Intelligence Synthesis (Produces report in requested language)
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Lấy danh sách model từ biến môi trường LLM_MODEL và LLM_FALLBACK_MODEL.
 * Mặc định bắt buộc là các model miễn phí kết thúc bằng ":free".
 * @returns {Array<string>}
 */
function getModelsList() {
  const primary = (process.env.LLM_MODEL || "").trim() || "nvidia/nemotron-3-ultra-550b-a55b:free";
  const fallback = (process.env.LLM_FALLBACK_MODEL || "").trim() || "nvidia/nemotron-3.5-lightning:free";
  const list = [primary];
  if (fallback && fallback !== primary) {
    list.push(fallback);
  }
  return list;
}

const ATTEMPTS_PER_MODEL = 2;

const IMMUTABLE_SYSTEM_PROMPT = `You are an objective, precise, and concise news intelligence editor.
Your task is to analyze the provided articles and produce a clear, factual, and neutral intelligence digest.

CORE EDITORIAL PRINCIPLES:
1. Strictly Grounded in Provided Data:
   - Use ONLY information present in the input articles.
   - Never speculate, assume, or invent facts, numbers, motives, or unmentioned context.
   - If a detail is not in the text, do not mention it.

2. Neutral & Despinned:
   - Rephrase clickbait, sensationalist, or biased headlines into clear, objective, professional statements.
   - Avoid emotional adjectives or drama.

3. Universal Coverage:
   - Apply seamlessly to any topic: sports, technology, economy, geopolitics, science, culture, or breaking news.

4. Executive Inverted Pyramid:
   - "core_verdict": 1-2 direct, active sentences explaining what happened and the primary outcome.
   - "key_highlights": 2-3 concise bullet points focusing on concrete figures (scores, percentages, amounts, names, actions).
   - "impact": 1 concise sentence on the immediate consequence, significance, or next step (only if stated in the articles; otherwise keep it concise).

5. Ground-Truth Source Attribution:
   - Each event MUST include "source_indices": an array of integers (e.g. [1, 3]) indicating which articles from the input list provided the facts for this event.
   - Never fabricate or guess URLs.

6. Proportionality & Brevity:
   - Select at most 3 to 5 distinct, meaningful events.
   - If the input contains minimal or repetitive news, summarize it in 1 event.
   - If there is no real news or all articles are irrelevant, return an empty events list [].

OUTPUT LANGUAGE DIRECTIVE:
Produce all text fields (overview, title, core_verdict, key_highlights, impact) strictly in the target language requested in the user prompt.

RESPONSE FORMAT:
You MUST respond with a single, valid JSON object following this exact schema:
{
  "overview": "1-2 sentences summarizing the overall situation (in target language)",
  "events": [
    {
      "priority": "HIGH", // "HIGH" for breaking/major events, "NORMAL" for standard updates
      "title": "Neutral, factual headline (in target language)",
      "core_verdict": "Direct 1-2 sentence core verdict (in target language)",
      "key_highlights": [
        "Key highlight with figures/facts",
        "Another key highlight"
      ],
      "impact": "Direct impact or immediate next step (in target language)",
      "source_indices": [1, 2]
    }
  ]
}`;

const PRIORITY_ORDER = { HIGH: 1, NORMAL: 2 };

// ============================================================================
// Admin Notification Callback
// ============================================================================
let adminAlertHandler = null;

/**
 * Đăng ký hàm nhận cảnh báo gửi về Telegram cho Admin.
 * @param {Function} handler - async (message: string) => Promise<void>
 */
function setAdminAlertHandler(handler) {
  adminAlertHandler = handler;
}

/**
 * Gửi thông báo khẩn cấp tới Telegram của Admin (nếu có handler).
 * @param {string} message
 */
async function sendAdminAlert(message) {
  if (typeof adminAlertHandler === "function") {
    try {
      await adminAlertHandler(message);
    } catch (err) {
      console.error("[Synthesizer Admin Alert Error]:", err.message);
    }
  }
}

/**
 * Initializes OpenAI client targeting OpenRouter with explicit 60s timeout.
 * @returns {OpenAI}
 */
function getOpenRouterClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("Missing required environment variable: OPENROUTER_API_KEY");
  }
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: apiKey.trim(),
    timeout: 60000, // 60s timeout để tránh treo tiến trình
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/tele-intel-bot",
      "X-Title": "Tele Intel Bot OSINT"
    }
  });
}

/**
 * Kiểm tra lỗi hết số dư / tiền trong tài khoản OpenRouter (HTTP 402).
 * @param {Error} error
 * @returns {boolean}
 */
function isInsufficientBalanceError(error) {
  const status = error.status || error.statusCode;
  const msg = (error.message || "").toLowerCase();
  return (
    status === 402 ||
    msg.includes("402") ||
    msg.includes("payment required") ||
    msg.includes("insufficient balance") ||
    msg.includes("insufficient credits") ||
    msg.includes("credit limit")
  );
}

/**
 * Kiểm tra lỗi Rate Limit (HTTP 429).
 * @param {Error} error
 * @returns {boolean}
 */
function isRateLimitError(error) {
  const status = error.status || error.statusCode;
  const msg = (error.message || "").toLowerCase();
  return status === 429 || msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests");
}

/**
 * Tính thời gian chờ Retry khi bị Rate Limit (tôn trọng header Retry-After).
 * @param {Error} error
 * @param {number} attempt
 * @returns {number} Thời gian chờ (mili-giây), tối đa 30s
 */
function getRateLimitDelay(error, attempt) {
  const retryHeader =
    error?.headers?.["retry-after"] ||
    error?.response?.headers?.get?.("retry-after") ||
    error?.headers?.["x-ratelimit-reset"];

  if (retryHeader) {
    const sec = parseFloat(retryHeader);
    if (!isNaN(sec) && sec > 0) {
      return Math.min(Math.ceil(sec * 1000), 30000);
    }
  }
  // Exponential backoff: 3s, 6s, 12s...
  return Math.min(3000 * Math.pow(2, attempt - 1), 30000);
}

/**
 * Kiểm tra lỗi model bị gỡ bỏ hoặc không tồn tại (HTTP 404 / 400).
 * @param {Error} error
 * @returns {boolean}
 */
function isModelUnavailableError(error) {
  const status = error.status || error.statusCode;
  const msg = (error.message || "").toLowerCase();
  return (
    status === 404 ||
    msg.includes("not found") ||
    msg.includes("no longer exists") ||
    msg.includes("model not available") ||
    msg.includes("does not exist") ||
    status === 503
  );
}

/**
 * Checks if an error is transient and eligible for retry.
 * @param {Error} error
 * @returns {boolean}
 */
function isTransientError(error) {
  const msg = (error.message || "").toLowerCase();
  return (
    isRateLimitError(error) ||
    msg.includes("503") ||
    msg.includes("timeout") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset")
  );
}

/**
 * Builds the user prompt containing input articles, topic-specific guidance, and recent sent events (Phase 5.1).
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @param {Array<Object>} topicHistory
 * @param {string} langCode
 * @param {Array<{title: string, date: string}>} [recentEvents=[]] - Danh sách sự kiện đã gửi các ca trước để chống lặp tin
 * @returns {string}
 */
function buildPrompt(topic, articles, topicGuidance = null, topicHistory = [], langCode = "en", recentEvents = []) {
  const languageName = getLanguageName(langCode);
  let prompt = `TARGET TOPIC: "${topic}"\n`;
  prompt += `OUTPUT LANGUAGE: Produce all fields (overview, title, core_verdict, key_highlights, impact) strictly in ${languageName}.\n\n`;

  if (topicGuidance && topicGuidance.trim().length > 0) {
    prompt += `TOPIC GUIDANCE:\n${topicGuidance.trim()}\n\n`;
  }

  // Phase 5.1: Khối chống lặp tin giữa các ca (Events already reported earlier with dates)
  if (Array.isArray(recentEvents) && recentEvents.length > 0) {
    prompt += `EVENTS ALREADY REPORTED EARLIER (WITH DATES):\n`;
    recentEvents.forEach((evt) => {
      prompt += `- [${evt.date}] ${evt.title}\n`;
    });
    prompt += `\nANTI-REPETITION RULE:\n`;
    prompt += `Do not report these events again UNLESS there is a significant new development (for example a final result, an official decision, or an important change in figures). If reported again, write only the new part.\n\n`;
    prompt += `RULE - ALREADY-REPORTED EVENTS: If an event was already reported, write ONLY the new development (new figure, new decision, new outcome). Do NOT restate earlier facts, earlier figures, or earlier names unless absolutely needed for context, and even then use at most one short phrase. If an event has NO new information, omit it entirely.\n`;
    prompt += `QUY TẮC - SỰ KIỆN ĐÃ BÁO CÁO: Nếu một sự kiện đã được đưa tin trước đó, chỉ viết phần mới phát sinh (con số mới, quyết định mới, kết quả mới). KHÔNG nhắc lại các thông tin cũ, con số cũ, tên gọi cũ trừ khi thực sự cần thiết để hiểu thông tin mới, và khi đó dùng tối đa một mệnh đề ngắn. Nếu sự kiện không có thông tin mới, bỏ qua hoàn toàn.\n\n`;
  }

  prompt += `COLLECTED ARTICLES (${articles.length} items):\n`;

  articles.forEach((art, idx) => {
    prompt += `--- ARTICLE [${idx + 1}] ---\n`;
    prompt += `Title: ${art.title}\n`;
    prompt += `Source: ${art.source || "Unknown"}\n`;
    prompt += `Published: ${art.pub_date || art.pubDate || "Recent"}\n`;
    if (art.full_text) {
      prompt += `Content: ${art.full_text.slice(0, 1500)}\n`;
    } else if (art.content_snippet || art.contentSnippet) {
      prompt += `Summary: ${art.content_snippet || art.contentSnippet}\n`;
    }
    prompt += `\n`;
  });

  prompt += `Synthesize the most significant events based ONLY on the articles above. Return a single valid JSON object following the schema.`;
  return prompt;
}

/**
 * Safely parses JSON from an LLM response, stripping markdown backticks if present.
 * @param {string} raw
 * @returns {Object|null}
 */
function safeParseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    return null;
  }
}

/**
 * Graceful Raw Fallback: Formats top articles directly into the concise schema
 * when ALL AI models are unavailable (global outage).
 * @param {string} topic
 * @param {Array<Object>} articles
 * @returns {{overview: string, events: Array}}
 */
function buildRawFallbackJson(topic, articles) {
  const topArticles = articles.slice(0, 5);

  const events = topArticles.map((art) => ({
    priority: "NORMAL",
    title: art.title || "No Title",
    core_verdict: (art.title || "").slice(0, 160),
    key_highlights: [
      (art.content_snippet || art.contentSnippet || art.title || "").slice(0, 200)
    ],
    impact: "",
    sources: [
      {
        name: art.source || "Unknown",
        url: art.link || ""
      }
    ]
  }));

  return {
    overview: `AI synthesis is temporarily operating in emergency fallback mode. Showing raw headlines for "${topic}".`,
    events
  };
}

/**
 * Xác thực và chuẩn hóa đối tượng JSON theo cấu trúc dữ liệu bắt buộc (Schema Validation).
 * Loại bỏ các sự kiện bị lỗi hoặc thiếu trường bắt buộc (title, core_verdict) thay vì gửi tin hỏng.
 * @param {Object} parsed
 * @param {Array<Object>} articles
 * @returns {{overview: string, events: Array}|null}
 */
function validateAndSanitizeDigest(parsed, articles = []) {
  if (!parsed || typeof parsed !== "object") return null;

  const overview = typeof parsed.overview === "string" ? parsed.overview.trim() : "";
  const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
  const validEvents = [];

  for (const evt of rawEvents) {
    if (!evt || typeof evt !== "object") continue;

    const title = typeof evt.title === "string" ? evt.title.trim() : "";
    const coreVerdict = typeof evt.core_verdict === "string" ? evt.core_verdict.trim() : "";

    // Bỏ qua sự kiện không hợp lệ nếu thiếu tiêu đề hoặc kết luận cốt lõi
    if (!title || !coreVerdict) {
      console.warn("[Sanitizer] Bỏ qua sự kiện không hợp lệ do thiếu title hoặc core_verdict:", evt);
      continue;
    }

    let highlights = [];
    if (Array.isArray(evt.key_highlights)) {
      highlights = evt.key_highlights
        .map((h) => String(h || "").trim())
        .filter((h) => h.length > 0);
    } else if (typeof evt.key_highlights === "string" && evt.key_highlights.trim()) {
      highlights = [evt.key_highlights.trim()];
    }

    // Gắn nguồn dẫn chứng đã xác thực dựa trên source_indices
    const rawIndices = Array.isArray(evt.source_indices) ? evt.source_indices : [];
    const attachedSources = [];
    const seenLinks = new Set();

    for (const rawIdx of rawIndices) {
      const numIdx = parseInt(rawIdx, 10);
      const article = articles[numIdx - 1]; // 1-based index từ prompt
      if (article && article.link && !seenLinks.has(article.link)) {
        seenLinks.add(article.link);
        attachedSources.push({
          name: article.source || "News",
          url: article.link
        });
      }
    }

    // Dự phòng nếu model không xuất source_indices: gắn nguồn đầu tiên khả dụng
    if (attachedSources.length === 0 && articles.length > 0) {
      attachedSources.push({
        name: articles[0].source || "News",
        url: articles[0].link
      });
    }

    validEvents.push({
      priority: (evt.priority || "NORMAL").toUpperCase() === "HIGH" ? "HIGH" : "NORMAL",
      title,
      core_verdict: coreVerdict,
      key_highlights: highlights,
      impact: typeof evt.impact === "string" ? evt.impact.trim() : "",
      sources: attachedSources
    });
  }

  validEvents.sort((a, b) => (PRIORITY_ORDER[a.priority] || 4) - (PRIORITY_ORDER[b.priority] || 4));

  return {
    overview: overview || "Tóm tắt tình hình các điểm tin mới nhận được.",
    events: validEvents
  };
}

/**
 * Synthesizes articles via OpenRouter with multi-model cascade and robust error handling.
 *
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} [topicGuidance=null]
 * @param {Array<Object>} [topicHistory=[]]
 * @param {string} [langCode="en"]
 * @param {Array<{title: string, date: string}>} [recentEvents=[]] - Danh sách sự kiện ca trước (Phase 5.1)
 * @param {string} [callType="scheduled"] - 'scheduled' | 'instant' | 'ask'
 * @returns {Promise<{overview: string, events: Array}>}
 */
async function synthesizeArticles(
  topic,
  articles,
  topicGuidance = null,
  topicHistory = [],
  langCode = "en",
  recentEvents = [],
  callType = "scheduled"
) {
  if (!articles || articles.length === 0) {
    return {
      overview: `No fresh intelligence recorded for topic "${topic}".`,
      events: []
    };
  }

  const client = getOpenRouterClient();
  let userContent = buildPrompt(topic, articles, topicGuidance, topicHistory, langCode, recentEvents);
  const models = getModelsList();
  let lastError = null;

  const MAX_TOTAL_REQUESTS_PER_DIGEST = 2;
  let totalRequestsUsed = 0;

  for (let mIdx = 0; mIdx < models.length && totalRequestsUsed < MAX_TOTAL_REQUESTS_PER_DIGEST; mIdx++) {
    const modelName = models[mIdx];
    let strictRetryUsed = false;

    while (totalRequestsUsed < MAX_TOTAL_REQUESTS_PER_DIGEST) {
      totalRequestsUsed++;
      const currentAttempt = totalRequestsUsed;
      try {
        // ====================================================================
        // HARD ZERO-COST GUARD: Tuyệt đối không cho phép gọi model tính phí
        // ====================================================================
        if (!modelName || !modelName.endsWith(":free")) {
          const guardMsg = `[HARD GUARD BLOCKED] Model "${modelName}" is NOT free (must end with ':free'). Aborted to prevent charges.`;
          console.error(guardMsg);
          await sendAdminAlert(
            `🚫 <b>[Zero-Cost Hard Guard]</b> Yêu cầu gọi AI đã bị chặn vì model <code>${modelName}</code> ` +
            `không kết thúc bằng <code>:free</code>. Bot chỉ cho phép chạy model có định danh kết thúc bằng :free.`
          );
          throw new Error(guardMsg);
        }

        // Đếm mọi lượt gọi và retry vào bộ đếm ngân sách hàng ngày
        await recordLlmRequest(callType).catch((err) => {
          console.warn("[Budget] Không thể ghi nhận lượt gọi LLM:", err.message);
        });

        console.log(`[OpenRouter OSINT] Calling free model "${modelName}" (request ${currentAttempt}/${MAX_TOTAL_REQUESTS_PER_DIGEST})...`);

        let completion;
        try {
          completion = await client.chat.completions.create({
            model: modelName,
            messages: [
              { role: "system", content: IMMUTABLE_SYSTEM_PROMPT },
              { role: "user", content: userContent }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2
          });
        } catch (formatErr) {
          // Model không hỗ trợ json_object -> gọi lại dạng prompt thuần
          if (
            formatErr.message?.includes("response_format") ||
            formatErr.message?.includes("json_object") ||
            formatErr.status === 400
          ) {
            if (totalRequestsUsed >= MAX_TOTAL_REQUESTS_PER_DIGEST) {
              throw formatErr;
            }
            totalRequestsUsed++;
            await recordLlmRequest(callType).catch(() => {});
            console.log(`[OpenRouter] Model "${modelName}" không hỗ trợ json_object. Thử lại ở chế độ prompt thuần (request ${totalRequestsUsed}/${MAX_TOTAL_REQUESTS_PER_DIGEST})...`);
            completion = await client.chat.completions.create({
              model: modelName,
              messages: [
                { role: "system", content: IMMUTABLE_SYSTEM_PROMPT },
                { role: "user", content: userContent }
              ],
              temperature: 0.2
            });
          } else {
            throw formatErr;
          }
        }

        const rawContent = completion.choices?.[0]?.message?.content;
        const parsed = safeParseJson(rawContent);
        const validated = validateAndSanitizeDigest(parsed, articles);

        // Nếu JSON bị hỏng hoặc cấu trúc không hợp lệ: Thử lại 1 lần duy nhất với prompt nhắc nhở nghiêm ngặt (nếu còn ngân sách)
        if (!validated || validated.events.length === 0) {
          if (!strictRetryUsed && totalRequestsUsed < MAX_TOTAL_REQUESTS_PER_DIGEST) {
            strictRetryUsed = true;
            console.warn(`[OpenRouter] Model "${modelName}" trả về JSON không hợp lệ. Thử lại với chỉ thị nghiêm ngặt...`);
            userContent += `\n\nCRITICAL INSTRUCTION: Your previous output was not valid JSON or lacked required fields. You must respond with ONLY raw valid JSON following the schema, with non-empty "title" and "core_verdict" for each event. Do not add markdown code fences or conversational text.`;
            continue;
          }
          throw new Error("Phản hồi từ AI không đúng định dạng JSON hoặc không có sự kiện hợp lệ.");
        }

        console.log(`[OpenRouter OSINT] ✅ Thành công với model "${modelName}". Sự kiện: ${validated.events.length}`);
        return validated;
      } catch (error) {
        lastError = error;
        console.warn(`[OpenRouter OSINT] ❌ Model "${modelName}" lượt yêu cầu ${currentAttempt}/${MAX_TOTAL_REQUESTS_PER_DIGEST} thất bại: ${error.message}`);

        // 1. Xử lý HTTP 402 (Hết số dư / Không đủ tiền) -> KHÔNG RETRY, gửi ngay cảnh báo Telegram cho Admin
        if (isInsufficientBalanceError(error)) {
          console.error(`[OpenRouter Critical] Hết số dư tài khoản (HTTP 402). Dừng gọi AI ngay lập tức.`);
          await sendAdminAlert(
            `🚨 <b>[OpenRouter Alert]</b> Tài khoản hết số dư (HTTP 402 - Payment Required).\n\n` +
            `Vui lòng kiểm tra lại tài khoản OpenRouter. Hệ thống đang chuyển sang chế độ hiển thị tiêu đề thô (Raw Fallback).`
          );
          return buildRawFallbackJson(topic, articles);
        }

        // 2. Xử lý HTTP 429 (Rate Limit) -> Chờ theo Retry-After header hoặc Exponential Backoff (chỉ thử lại nếu còn ngân sách)
        if (isRateLimitError(error) && totalRequestsUsed < MAX_TOTAL_REQUESTS_PER_DIGEST) {
          const waitMs = getRateLimitDelay(error, currentAttempt);
          console.log(`[OpenRouter Rate Limit] Đạt giới hạn tốc độ (429). Chờ ${waitMs / 1000}s trước khi thử lại...`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        // 3. Xử lý Model bị gỡ bỏ hoặc không tồn tại (HTTP 404 / 503)
        if (isModelUnavailableError(error)) {
          console.warn(`[OpenRouter] Model "${modelName}" không khả dụng hoặc đã bị gỡ bỏ.`);
          const nextModel = models[mIdx + 1];
          if (nextModel) {
            await sendAdminAlert(
              `⚠️ <b>[OpenRouter Alert]</b> Model miễn phí <code>${modelName}</code> không khả dụng hoặc đã bị gỡ bỏ. ` +
              `Hệ thống đang tự động chuyển sang model dự phòng <code>${nextModel}</code>.`
            );
          }
          // Chuyển sang model dự phòng tiếp theo
          break;
        }

        // 4. Lỗi thoáng qua (Transient Error)
        if (isTransientError(error) && totalRequestsUsed < MAX_TOTAL_REQUESTS_PER_DIGEST) {
          console.log(`[OpenRouter] Lỗi tạm thời — chờ 3s trước khi thử lại...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }

        break;
      }
    }
  }

  // Toàn bộ các model trong cascade đều thất bại -> Gửi cảnh báo Admin và kích hoạt Fallback thô
  console.warn(
    `[OpenRouter OSINT] ⚠️ Toàn bộ model (${models.join(", ")}) đều thất bại cho chủ đề "${topic}". Lỗi cuối: ${lastError?.message}`
  );
  await sendAdminAlert(
    `⚠️ <b>[Hệ Thống AI Cảnh Báo]</b> Toàn bộ model AI OpenRouter (${models.join(", ")}) đều gặp sự cố khi xử lý chủ đề ` +
    `<i>${topic}</i>.\n\n` +
    `<b>Lỗi:</b> <code>${lastError?.message || "Không xác định"}</code>\n` +
    `<i>Bản tin đang được chuyển sang chế độ hiển thị tiêu đề thô tự động.</i>`
  );

  return buildRawFallbackJson(topic, articles);
}

module.exports = {
  synthesizeArticles,
  buildPrompt,
  buildRawFallbackJson,
  validateAndSanitizeDigest,
  getModelsList,
  setAdminAlertHandler,
  IMMUTABLE_SYSTEM_PROMPT
};
