const { GoogleGenAI } = require("@google/genai");

/**
 * Gemini AI Synthesis Module.
 * Adheres strictly to SRP: Prompt composition, SDK communication, and schema enforcement only.
 */

const GEMINI_MODEL = "gemini-3.8-flash";

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
 * Synthesizes a collection of articles into structured intelligence JSON.
 * Includes 1 automatic retry on failure.
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @returns {Promise<{overview: string, events: Array<{title: string, details: string, impact: string, sources: string[]}>}>}
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

  const MAX_ATTEMPTS = 4;
  const BACKOFF_DELAYS = [2000, 5000, 10000, 20000]; // Exponential backoff: 2s, 5s, 10s, 20s
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
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

      return {
        overview: parsed.overview || "Không có tóm tắt tổng quan.",
        events: Array.isArray(parsed.events) ? parsed.events : []
      };
    } catch (error) {
      lastError = error;
      const isRetryable = error.message?.includes("503") || error.message?.includes("UNAVAILABLE") || error.message?.includes("429") || error.message?.includes("overloaded");
      console.warn(`[Gemini Synthesis Attempt ${attempt}/${MAX_ATTEMPTS} Failed]: ${error.message}`);

      if (attempt < MAX_ATTEMPTS && isRetryable) {
        const delayMs = BACKOFF_DELAYS[attempt - 1] || 10000;
        console.log(`[Gemini Retry] Waiting ${delayMs / 1000}s before attempt ${attempt + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else if (!isRetryable) {
        // Non-retryable error (e.g., 400, 401, 404) - fail immediately
        break;
      }
    }
  }

  throw lastError;
}

module.exports = {
  synthesizeArticles,
  buildPrompt,
  RESPONSE_SCHEMA,
  IMMUTABLE_SYSTEM_PROMPT
};
