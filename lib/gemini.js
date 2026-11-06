const { GoogleGenAI } = require("@google/genai");

/**
 * Gemini AI Synthesis Module.
 * Adheres strictly to SRP: Prompt composition, SDK communication, and schema enforcement only.
 *
 * Self-Healing Strategy:
 *   1. 3-Tier Model Cascade: Iterates through multiple Gemini models.
 *   2. Per-model retry with backoff for transient 503/429 errors.
 *   3. Graceful Raw Fallback: If ALL models fail, formats raw articles into
 *      the required JSON schema so the digest pipeline is never broken.
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
      description: "Concise 1-2 sentence executive summary of the shift in Vietnamese."
    },
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: {
            type: "STRING",
            description: "Clear, concise headline of the event in Vietnamese."
          },
          details: {
            type: "STRING",
            description: "Core mechanics, factual progression, and context in Vietnamese."
          },
          impact: {
            type: "STRING",
            description: "Consequences, actionable takeaways, or developer implications in Vietnamese."
          },
          sources: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Original source URLs matching this event from input data."
          }
        },
        required: ["title", "details", "impact", "sources"]
      }
    }
  },
  required: ["overview", "events"]
};

const IMMUTABLE_SYSTEM_PROMPT = `
Bạn là Trợ lý Tình báo & Phân tích Tin tức cấp cao (Intelligence & News Analyst).
Nhiệm vụ của bạn là tổng hợp các tin tức thô được cung cấp thành một bản tin tình báo chất lượng cao, súc tích và có cấu trúc.

CÁC NGUYÊN TẮC BẮT BUỘC (GUARDRAILS):
1. Tính xác thực tuyệt đối (Strict Evidence Grounding): Chỉ tổng hợp các sự kiện, chỉ số, số liệu và thực thể được đề cập trực tiếp trong dữ liệu đầu vào. KHÔNG ĐƯỢC TỰ BỊA ĐẶT (hallucinate) thông tin hay số liệu kỹ thuật.
2. Chống lan man (Anti-Fluff Directive): Viết ngắn gọn, tập trung vào bản chất sự việc và tác động thực tế. Nếu dữ liệu ít hoặc không có tin lớn, chỉ tạo 1 sự kiện cốt lõi thay vì dàn trải nhiều gạch đầu dòng.
3. Liên kết nguồn (Sources Linkage): Trường "sources" của mỗi event phải chứa đúng các đường link (URL) gốc từ các bài viết tương ứng trong dữ liệu đầu vào.
4. Ngôn ngữ: Toàn bộ nội dung tổng hợp (overview, title, details, impact) viết bằng TIẾNG VIỆT tự nhiên, chuẩn mực, chuyên nghiệp.
5. Định dạng: Trả về kết quả đúng 100% định dạng JSON Schema được chỉ định.
`;

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
    prompt += `HƯỚNG DẪN TRỌNG TÂM PHÂN TÍCH CHO CHỦ ĐỀ NÀY:\n${topicGuidance.trim()}\n\n`;
  }

  prompt += `DANH SÁCH BÀI BÁO / TIN TỨC THU THẬP ĐƯỢC (${articles.length} bài):\n`;

  articles.forEach((art, idx) => {
    prompt += `--- BÀI VIẾT ${idx + 1} ---\n`;
    prompt += `Tiêu đề: ${art.title}\n`;
    prompt += `Nguồn: ${art.source || "Unknown"}\n`;
    prompt += `Thời gian: ${art.pub_date || art.pubDate}\n`;
    prompt += `Đường dẫn: ${art.link}\n`;
    if (art.content_snippet || art.contentSnippet) {
      prompt += `Tóm tắt nội dung: ${art.content_snippet || art.contentSnippet}\n`;
    }
    prompt += `\n`;
  });

  prompt += `Hãy phân tích và tổng hợp thành bản tin JSON theo schema đã quy định.`;
  return prompt;
}

/**
 * Graceful Raw Fallback: Formats top articles directly into the required JSON
 * schema when ALL Gemini models are unavailable (global outage).
 * Ensures the digest pipeline is NEVER broken.
 * @param {string} topic
 * @param {Array<Object>} articles
 * @returns {{overview: string, events: Array}}
 */
function buildRawFallbackJson(topic, articles) {
  const topArticles = articles.slice(0, 8);

  const events = topArticles.map((art) => ({
    title: art.title || "Không có tiêu đề",
    details: (art.content_snippet || art.contentSnippet || art.title || "").slice(0, 500),
    impact: `Nguồn: ${art.source || "Unknown"}`,
    sources: art.link ? [art.link] : []
  }));

  return {
    overview: `⚠️ Hệ thống AI tổng hợp tạm thời bị vượt tải (503). Dưới đây là ${topArticles.length} tin tức thô mới nhất cho chủ đề "${topic}" — chưa qua phân tích Gemini.`,
    events
  };
}

/**
 * Synthesizes a collection of articles into structured intelligence JSON.
 *
 * Strategy: 3-Tier Model Cascade with per-model retry and graceful raw fallback.
 *   - Iterates through MODEL_CASCADE in order.
 *   - For each model: up to ATTEMPTS_PER_MODEL attempts with RETRY_DELAY_MS between retries.
 *   - If a non-transient error occurs (401, 404), immediately skips to the next model.
 *   - If ALL models fail, returns buildRawFallbackJson() instead of throwing.
 *
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @returns {Promise<{overview: string, events: Array}>}
 */
async function synthesizeArticles(topic, articles, topicGuidance = null) {
  if (!articles || articles.length === 0) {
    return {
      overview: `Không ghi nhận tin tức mới cho chủ đề "${topic}" trong khung giờ này.`,
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

        console.log(`[Gemini] ✅ Success with model "${modelName}" on attempt ${attempt}.`);
        return {
          overview: parsed.overview || "Không có tóm tắt tổng quan.",
          events: Array.isArray(parsed.events) ? parsed.events : []
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

        // Non-transient (404, 401) or exhausted retries → skip to next model
        console.log(`[Gemini] Falling back to next model in cascade...`);
        break;
      }
    }
  }

  // ALL models exhausted → Graceful Raw Fallback (never throw)
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
