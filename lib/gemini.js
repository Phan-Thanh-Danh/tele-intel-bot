const { GoogleGenAI } = require("@google/genai");

/**
 * Gemini AI Synthesis Module - OSINT Intelligence Analyst v2.
 * Adheres strictly to SRP: Prompt composition, SDK communication, and schema enforcement only.
 *
 * Capabilities:
 *   1. 3-Tier Model Cascade for 100% High-Availability.
 *   2. Smart De-duplication & Cross-Source Synthesis.
 *   3. Significance Triage (CRITICAL -> MAJOR -> WATCHLIST).
 *   4. Actionable Strategic Impact (3-step chain).
 *   5. Forward-Looking Trend Radar (24h - 48h).
 *   6. Graceful Raw Fallback conforming to v2 schema.
 */

const MODEL_CASCADE = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite"
];

const ATTEMPTS_PER_MODEL = 2;
const RETRY_DELAY_MS = 3000;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    overview: {
      type: "STRING",
      description: "Tóm tắt bức tranh toàn cảnh ngắn gọn (1-2 câu) về tình hình trong ca bằng tiếng Việt."
    },
    trend_radar: {
      type: "STRING",
      description: "Dự đoán xu hướng tiếp theo cần quan sát trong 24h - 48h tới dựa trên các tín hiệu hiện tại bằng tiếng Việt."
    },
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          priority: {
            type: "STRING",
            enum: ["CRITICAL", "MAJOR", "WATCHLIST"],
            description: "Phân loại mức độ quan trọng: CRITICAL (trọng yếu), MAJOR (đáng chú ý), hoặc WATCHLIST (theo dõi)."
          },
          title: {
            type: "STRING",
            description: "Tiêu đề sự kiện tổng hợp, súc tích, mang tính nghiệp vụ bằng tiếng Việt."
          },
          details: {
            type: "STRING",
            description: "Diễn biến cốt lõi, bối cảnh và số liệu xác thực thu thập được bằng tiếng Việt."
          },
          impact: {
            type: "STRING",
            description: "Phân tích chiến lược chuẩn 3 bước: Nguyên nhân cốt lõi -> Ai hưởng lợi / Ai chịu rủi ro -> Khuyến nghị hành động thực tế."
          },
          sources: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Danh sách tất cả các URL bài viết gốc liên quan đến sự kiện này (gộp từ nhiều nguồn)."
          }
        },
        required: ["priority", "title", "details", "impact", "sources"]
      }
    }
  },
  required: ["overview", "trend_radar", "events"]
};

const IMMUTABLE_SYSTEM_PROMPT = `
Bạn là Chuyên gia Phân tích Tình báo Nguồn Mở Cấp cao (OSINT Strategic Intelligence Analyst v2).
Nhiệm vụ của bạn là xử lý và phân tích các nguồn dữ liệu tin tức thô thành BẢN TIN TÌNH BÁO CHIẾN LƯỢC có tính ứng dụng cao.

CÁC NGUYÊN TẮC BẮT BUỘC (GUARDRAILS & DIRECTIVES):
1. Tính xác thực tuyệt đối (Strict Anti-Hallucination):
   - Chỉ dựa hoàn toàn vào dữ liệu và đoạn trích (snippets) được cung cấp.
   - TUYỆT ĐỐI KHÔNG tự bịa đặt số liệu, phần trăm, chỉ số kỹ thuật, ngày tháng hoặc danh xưng không có trong tài liệu đầu vào.

2. Gom cụm thông minh & Tổng hợp đa nguồn (Smart De-duplication & Multi-Source Synthesis):
   - Khi có nhiều bài viết cùng đề cập một sự kiện hoặc chủ đề cốt lõi, HÃY GỘP CHÚNG LẠI thành 1 Sự kiện tổng hợp duy nhất thay vì tạo nhiều mục rời rạc.
   - Ghép các góc nhìn từ các nguồn khác nhau thành diễn biến toàn diện.
   - Gộp tất cả các đường link URL gốc liên quan vào mảng "sources" của sự kiện đó.

3. Phân cấp mức độ quan trọng (Significance Triage - Priority):
   Mỗi sự kiện bắt buộc gán 1 trong 3 mức sau và sắp xếp mảng "events" theo thứ tự giảm dần:
   - "CRITICAL": Biến động lớn về chính sách, cú sốc thị trường, lỗ hổng bảo mật nghiêm trọng (Zero-day/CVE), thay đổi kiến trúc/hạ tầng cốt lõi.
   - "MAJOR": Xu hướng công nghệ mới nổi, cập nhật phiên bản lớn, các công bố sản phẩm/tính năng quan trọng.
   - "WATCHLIST": Tín hiệu sớm, tin đồn thị trường, động thái thăm dò cần tiếp tục quan sát.

4. Đánh giá tác động chiến lược 3 bước (Actionable Strategic Impact):
   Trường "impact" bắt buộc tuân theo chuỗi phân tích 3 bước logic:
   "Nguyên nhân cốt lõi -> Ai hưởng lợi / Ai chịu rủi ro -> Khuyến nghị hành động thực tế".
   Ví dụ: "Do nhu cầu tích trữ tăng mạnh vì bất ổn địa chính trị -> Nhà đầu tư vàng hưởng lợi ngắn hạn, người mua sau chịu rủi ro đỉnh giá -> Nên duy trì tỷ trọng danh mục an toàn, tránh fomo ở vùng giá cao."

5. Radar dự đoán xu hướng (Trend Radar):
   Trường "trend_radar" cung cấp 1-2 câu dự báo triển vọng ngắn hạn: "Xu hướng tiếp theo cần quan sát trong 24h - 48h tới".

6. Ngôn ngữ & Định dạng:
   - 100% nội dung (overview, trend_radar, title, details, impact) viết bằng TIẾNG VIỆT chuyên nghiệp, khúc chiết, sắc sảo.
   - Trả về đúng 100% định dạng JSON Schema quy định.
`;

const PRIORITY_ORDER = { CRITICAL: 1, MAJOR: 2, WATCHLIST: 3 };

/**
 * Gets or initializes the Google GenAI instance.
 * @returns {GoogleGenAI}
 */
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("Missing required environment variable: GEMINI_API_KEY");
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Checks if an error is transient and eligible for retry (503 / 429 / overload).
 * @param {Error} error
 * @returns {boolean}
 */
function isTransientError(error) {
  const msg = error.message || "";
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("overloaded") ||
    msg.includes("RESOURCE_EXHAUSTED")
  );
}

/**
 * Builds the user prompt containing input articles and topic-specific guidance.
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @returns {string}
 */
function buildPrompt(topic, articles, topicGuidance = null) {
  let prompt = `Chủ đề theo dõi: "${topic}"\n\n`;

  if (topicGuidance && topicGuidance.trim().length > 0) {
    prompt += `HƯỚNG DẪN TRỌNG TÂM PHÂN TÍCH CHO CHỦ ĐỀ NÀY (TOPIC GUIDANCE):\n${topicGuidance.trim()}\n\n`;
  }

  prompt += `DANH SÁCH BÀI BÁO / TIN TỨC THU THẬP ĐƯỢC (${articles.length} bài):\n`;

  articles.forEach((art, idx) => {
    prompt += `--- BÀI VIẾT ${idx + 1} ---\n`;
    prompt += `Tiêu đề: ${art.title}\n`;
    prompt += `Nguồn: ${art.source || "Unknown"}\n`;
    prompt += `Thời gian: ${art.pub_date || art.pubDate}\n`;
    prompt += `Đường dẫn: ${art.link}\n`;
    if (art.content_snippet || art.contentSnippet) {
      prompt += `Nội dung: ${art.content_snippet || art.contentSnippet}\n`;
    }
    prompt += `\n`;
  });

  prompt += `Hãy phân tích, gom cụm đa nguồn và tổng hợp thành bản tin tình báo JSON chuẩn OSINT v2 theo schema đã quy định.`;
  return prompt;
}

/**
 * Graceful Raw Fallback: Formats top articles directly into the v2 JSON schema
 * when ALL Gemini models are unavailable (global outage).
 * Ensures the digest pipeline is NEVER broken.
 * @param {string} topic
 * @param {Array<Object>} articles
 * @returns {{overview: string, trend_radar: string, events: Array}}
 */
function buildRawFallbackJson(topic, articles) {
  const topArticles = articles.slice(0, 8);

  const events = topArticles.map((art) => ({
    priority: "MAJOR",
    title: art.title || "Không có tiêu đề",
    details: (art.content_snippet || art.contentSnippet || art.title || "").slice(0, 800),
    impact: `Nguồn tin: ${art.source || "Unknown"} (Chưa qua phân tích AI do chế độ dự phòng).`,
    sources: art.link ? [art.link] : []
  }));

  return {
    overview: `⚠️ Hệ thống AI tổng hợp tạm thời bị vượt tải (503). Dưới đây là ${topArticles.length} tin tức thô mới nhất cho chủ đề "${topic}" — chưa qua phân tích Gemini.`,
    trend_radar: "Tạm thời không khả dụng do hệ thống AI đang hoạt động ở chế độ dự phòng sự cố.",
    events
  };
}

/**
 * Synthesizes a collection of articles into structured intelligence JSON.
 *
 * Strategy: 3-Tier Model Cascade with per-model retry and graceful raw fallback.
 *   - Iterates through MODEL_CASCADE in order.
 *   - For each model: up to ATTEMPTS_PER_MODEL attempts with RETRY_DELAY_MS between retries.
 *   - If a non-transient error occurs (404, 401), immediately skips to the next model.
 *   - If ALL models fail, returns buildRawFallbackJson() instead of throwing.
 *
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @returns {Promise<{overview: string, trend_radar: string, events: Array}>}
 */
async function synthesizeArticles(topic, articles, topicGuidance = null) {
  if (!articles || articles.length === 0) {
    return {
      overview: `Không ghi nhận tin tức mới cho chủ đề "${topic}" trong khung giờ này.`,
      trend_radar: "Theo dõi thêm các diễn biến trong các ca tiếp theo.",
      events: []
    };
  }

  const ai = getAiClient();
  const userContent = buildPrompt(topic, articles, topicGuidance);
  let lastError = null;

  for (const modelName of MODEL_CASCADE) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        console.log(`[Gemini] Trying model "${modelName}" (attempt ${attempt}/${ATTEMPTS_PER_MODEL})...`);

        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [{ text: userContent }]
            }
          ],
          config: {
            systemInstruction: IMMUTABLE_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.2
          }
        });

        const rawText = response.text;
        if (!rawText) {
          throw new Error("Empty response returned from Gemini API");
        }

        const parsed = JSON.parse(rawText);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Invalid JSON structure returned from Gemini");
        }

        const events = Array.isArray(parsed.events) ? parsed.events : [];
        // Ensure events are strictly sorted by priority (CRITICAL -> MAJOR -> WATCHLIST)
        events.sort((a, b) => (PRIORITY_ORDER[a.priority] || 4) - (PRIORITY_ORDER[b.priority] || 4));

        console.log(`[Gemini] ✅ Success with model "${modelName}" on attempt ${attempt}. Events: ${events.length}`);
        return {
          overview: parsed.overview || "Không có tóm tắt tổng quan.",
          trend_radar: parsed.trend_radar || "Chưa có dự báo xu hướng cụ thể.",
          events
        };
      } catch (error) {
        lastError = error;
        const transient = isTransientError(error);
        console.warn(
          `[Gemini] ❌ Model "${modelName}" attempt ${attempt}/${ATTEMPTS_PER_MODEL} failed: ${error.message}`
        );

        if (transient && attempt < ATTEMPTS_PER_MODEL) {
          console.log(`[Gemini] Transient error — retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        // Non-transient or exhausted retries -> skip to next model
        console.log(`[Gemini] Falling back to next model in cascade...`);
        break;
      }
    }
  }

  // ALL models exhausted -> Graceful Raw Fallback (never throw)
  console.warn(
    `[Gemini] ⚠️ All ${MODEL_CASCADE.length} models failed. Activating raw fallback for topic "${topic}". Last error: ${lastError?.message}`
  );
  return buildRawFallbackJson(topic, articles);
}

module.exports = {
  synthesizeArticles,
  buildPrompt,
  buildRawFallbackJson,
  RESPONSE_SCHEMA,
  IMMUTABLE_SYSTEM_PROMPT,
  MODEL_CASCADE
};
