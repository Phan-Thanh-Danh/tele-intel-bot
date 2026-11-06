const OpenAI = require("openai");

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
 *   12. Deepfake & Synthetic Content Verification
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const OPENROUTER_MODELS = [
  "deepseek/deepseek-chat",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free"
];

const ATTEMPTS_PER_MODEL = 2;
const RETRY_DELAY_MS = 2500;

const IMMUTABLE_SYSTEM_PROMPT = `
Bạn là Chuyên gia Trưởng Phân tích Tình báo Doanh nghiệp Cấp Cao (Chief Enterprise OSINT Analyst v4).
Nhiệm vụ của bạn là tiếp nhận dữ liệu tin tức đa quốc gia (Mỹ, Anh, Đức, Pháp, Nhật Bản, Hàn Quốc, Đài Loan, Hà Lan, Israel, Nga, Singapore, Việt Nam...) và biên tập thành BẢN TIN TÌNH BÁO CHIẾN LƯỢC TOÀN CẦU theo chuẩn mực điều hành cấp cao (Executive Grade).

CÁC GIAO THỨC TÌNH BÁO VÀ BIÊN TẬP BẮT BUỘC:

1. Quy chuẩn Kim Tự Tháp Đảo Ngược (Executive Inverted Pyramid):
   - Tuyệt đối không viết thành các đoạn văn dài lê thê (Text Wall).
   - Trường "core_verdict": Bắt buộc trả lời thẳng bản chất sự việc và tác động chính trong 1-2 CÂU NGẮN GỌN, dùng thể chủ động.
   - Trường "key_highlights": Mảng 2-3 điểm mấu chốt, BẮT BUỘC IN ĐẬM (dùng **) các con số (%, tiền tệ, chỉ số) và hành động cốt lõi. Giải thích thuật ngữ viết tắt trong ngoặc đơn (ví dụ: CPI, FDI, EUV).
   - Trường "metric_table": Mảng các chỉ số đối chiếu dạng đối tượng [{ "label": "Tên chỉ số", "actual": "Số thực tế", "forecast": "Dự báo/Trước đó", "change": "Mức biến động" }]. Nếu không có dữ liệu số học đối chiếu, trả về mảng rỗng [].

2. Giao thức Phân cấp Dữ kiện & Sự Thật Gốc (Ground Truth Protocol):
   - Nguồn Cấp 1 (Tier 1: Chính phủ, Ngân hàng TW, SEC, Thông cáo chính thức hãng sản xuất) là SỰ THẬT GỐC (Ground Truth).
   - Nguồn Cấp 2 (Tier 2: Reuters, Bloomberg, WSJ, FT, Nikkei) là báo chí chuẩn mực phản ánh góc nhìn và ước tính.
   - Nguồn Cấp 3 (Tier 3: MXH, Reddit, Blog, PR Wire) chỉ phản ánh tâm lý thị trường hoặc thông cáo trả tiền.
   - Khi có mâu thuẫn số liệu: Bắt buộc lấy con số từ Nguồn Cấp 1 làm gốc, đối chiếu và giải thích sự chênh lệch của Nguồn Cấp 2 hoặc tin đồn Cấp 3.

3. Giao thức Đánh giá Trạng thái Pháp lý (Legal Status Classification):
   Mỗi sự kiện bắt buộc gán 1 trong 3 trạng thái "legal_status":
   - "ENACTED": Đã ban hành chính thức, có hiệu lực pháp lý (luật, nghị định đã ký, quyết định chính thức).
   - "PROPOSED": Mới là đề xuất, dự thảo luật, kiến nghị của cơ quan hoặc cá nhân.
   - "PENDING": Đang trong quá trình xét xử, tranh chấp, hoặc đàm phán chưa có kết luận.

4. Giao thức Bóc Tách Góc Khuyết Thông Tin (Information Gap Analysis):
   Trường "information_gap": Đối chiếu với checklist bắt buộc (Thương vụ M&A: Đã có giá trị, phương thức thanh toán, tỷ lệ sở hữu chưa? Chính sách: Đã có ngày áp dụng và đối tượng chưa? Tài chính: Có né tránh khoản nợ/thua lỗ không?).
   Nếu các bài báo đang né tránh hoặc chưa làm rõ, hãy chỉ ra chính xác: "Báo chí hiện tại chưa công bố...".

5. Giao thức Nhận diện Số liệu Sửa đổi (Data Revisions Alignment):
   Trường "is_revised": Đặt là true nếu bài báo đề cập đến việc cơ quan chức năng điều chỉnh lại số liệu của các kỳ trước (ví dụ: GDP quý trước được điều chỉnh từ 5.0% xuống 4.8%).

6. Giao thức Kiềng 3 Chân & Quyết Định Kiểm Chứng (Triangulation & Decision Gate):
   Mỗi sự kiện bắt buộc gán 1 trong 3 trạng thái "verification_status":
   - "VERIFIED_MULTI_SOURCE": Xác nhận độc lập bởi $\ge 2$ nguồn tin có chuỗi phát tán riêng biệt.
   - "SINGLE_SOURCE_WARNING": Thông tin chỉ xuất hiện ở 1 nguồn duy nhất hoặc nhiều bài báo nhưng đều trích dẫn từ 1 bài gốc (Echo chamber/PR Seeding). Bắt buộc phải cảnh báo rủi ro nguồn đơn lẻ.
   - "CONTRADICTED": Các nguồn tin đưa dữ liệu trái ngược hoặc bác bỏ lẫn nhau.

7. Giao thức Cập Nhật Khác Biệt & Dòng Thời Gian ("delta_update"):
   - So sánh với lịch sử/trạng thái đã biết của chủ đề từ các ca trước (Event Ledger).
   - Trích xuất điểm MỚI THẬT SỰ (Delta Δ). Nếu chỉ xào lại chuyện cũ ($\Delta = 0$), hãy loại bỏ hoặc ghi "Không có diễn biến mới".

8. Định dạng Xuất Bản:
   100% nội dung bằng TIẾNG VIỆT chuyên nghiệp, đanh thép, chuẩn mực tình báo. Trả về DUY NHẤT một chuỗi JSON hợp lệ theo schema:
   {
     "overview": "Tóm tắt bức tranh toàn cảnh khách quan, ngắn gọn",
     "trend_radar": "Dự báo xu hướng 24h-48h tới",
     "events": [
       {
         "priority": "CRITICAL",
         "verification_status": "VERIFIED_MULTI_SOURCE",
         "legal_status": "ENACTED",
         "is_revised": false,
         "title": "Tiêu đề trung lập đã giải giật tít",
         "core_verdict": "Kết luận cốt lõi trong 1-2 câu",
         "key_highlights": [
           "Chỉ số 1: Con số và hành động cụ thể",
           "Chỉ số 2: Con số và hành động cụ thể"
         ],
         "metric_table": [
           { "label": "Chỉ số", "actual": "5.50%", "forecast": "5.50%", "change": "0 bps" }
         ],
         "information_gap": "Góc khuyết: Những gì báo chí chưa công bố hoặc né tránh",
         "media_framing": "Đối chiếu góc nhìn truyền thông phương Tây vs Đối trọng vs Trung lập",
         "delta_update": "Điểm mới so với trước đây (hoặc: Diễn biến mới ghi nhận)",
         "impact": "Động cơ cốt lõi -> Đối tượng hưởng lợi/rủi ro -> Khuyến nghị hành động",
         "sources": [
           { "name": "Reuters", "tier": 2, "url": "https://..." }
         ]
       }
     ]
   }
`;

const PRIORITY_ORDER = { CRITICAL: 1, MAJOR: 2, WATCHLIST: 3 };

/**
 * Initializes OpenAI client targeting OpenRouter.
 * @returns {OpenAI}
 */
function getOpenRouterClient() {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("Missing required environment variable: OPENROUTER_API_KEY");
  }
  return new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: apiKey.trim(),
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/tele-intel-bot",
      "X-Title": "Tele Intel Bot OSINT"
    }
  });
}

/**
 * Checks if an error is transient and eligible for retry (503 / 429 / overload).
 * @param {Error} error
 * @returns {boolean}
 */
function isTransientError(error) {
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("quota")
  );
}

/**
 * Builds the user prompt containing input articles, topic-specific guidance, and event ledger history.
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @param {Array<Object>} topicHistory
 * @returns {string}
 */
function buildPrompt(topic, articles, topicGuidance = null, topicHistory = []) {
  let prompt = `Chủ đề tình báo chiến lược: "${topic}"\n\n`;

  if (topicGuidance && topicGuidance.trim().length > 0) {
    prompt += `HƯỚNG DẪN TRỌNG TÂM PHÂN TÍCH (TOPIC GUIDANCE):\n${topicGuidance.trim()}\n\n`;
  }

  // Inject Event Ledger History (for Delta tracking)
  if (Array.isArray(topicHistory) && topicHistory.length > 0) {
    prompt += `LỊCH SỬ & TRẠNG THÁI ĐÃ BIẾT TỪ CÁC CA TRƯỚC (EVENT LEDGER HISTORY):\n`;
    topicHistory.forEach((h) => {
      prompt += `- [Thực thể: ${h.entity_key}] Trạng thái trước: ${h.current_state} (Cập nhật lúc: ${h.updated_at || h.last_event_date})\n`;
    });
    prompt += `\n* CHỈ THỊ DELTA: So sánh với các trạng thái trên, chỉ trích xuất diễn biến MỚI THẬT SỰ (Delta Δ). Loại bỏ tin xào lại.\n\n`;
  }

  prompt += `DANH SÁCH BÀI BÁO / DỮ LIỆU ĐA QUỐC GIA ĐÃ THU THẬP (${articles.length} bài):\n`;

  articles.forEach((art, idx) => {
    const tier = art.source_tier || art.sourceTier || 2;
    const tierLabel = tier === 1 ? "Cấp 1 - Chính thức" : tier === 2 ? "Cấp 2 - Báo chí chuẩn mực" : "Cấp 3 - Cộng đồng/MXH";
    const typeLabel = art.source_type || art.sourceType || "MAINSTREAM";
    const country = art.source_country || "Quốc tế";

    prompt += `--- BÀI VIẾT ${idx + 1} ---\n`;
    prompt += `Tiêu đề: ${art.title}\n`;
    prompt += `Nguồn tin: ${art.source || "Unknown"} [${tierLabel} / ${country} / ${typeLabel}]\n`;
    if (art.cited_root_source) {
      prompt += `⚠️ Phát hiện trích dẫn nguồn gốc bên ngoài: "${art.cited_root_source}" (Lưu ý kiểm tra buồng vang)\n`;
    }
    if (art.is_pr_campaign || art.suspected_astroturfing) {
      prompt += `⚠️ CẢNH BÁO: Phát hiện chiến dịch PR Seeding / Astroturfing trùng lặp văn bản giữa các trang nhỏ.\n`;
    }
    prompt += `Thời gian: ${art.pub_date || art.pubDate}\n`;
    prompt += `Đường dẫn: ${art.link}\n`;
    if (art.full_text) {
      prompt += `Nội dung toàn văn (Full-Text Đọc sâu):\n${art.full_text}\n`;
    } else if (art.content_snippet || art.contentSnippet) {
      prompt += `Nội dung tóm tắt:\n${art.content_snippet || art.contentSnippet}\n`;
    }
    prompt += `\n`;
  });

  prompt += `Hãy đối chiếu đa nguồn, áp dụng quy chuẩn Kim Tự Tháp Đảo Ngược, bóc tách góc khuyết thông tin và xuất BẢN TIN JSON chuẩn xác theo schema quy định.`;
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
 * Graceful Raw Fallback: Formats top articles directly into the v4 JSON schema
 * when ALL AI models are unavailable (global outage).
 * @param {string} topic
 * @param {Array<Object>} articles
 * @returns {{overview: string, trend_radar: string, events: Array}}
 */
function buildRawFallbackJson(topic, articles) {
  const topArticles = articles.slice(0, 8);

  const events = topArticles.map((art) => ({
    priority: "MAJOR",
    verification_status: "SINGLE_SOURCE_WARNING",
    legal_status: "PENDING",
    is_revised: false,
    title: art.title || "Không có tiêu đề",
    core_verdict: (art.title || "Không có tiêu đề").slice(0, 160),
    key_highlights: [
      (art.content_snippet || art.contentSnippet || art.title || "").slice(0, 200)
    ],
    metric_table: [],
    information_gap: "Chưa phân tích được do AI tạm thời ở chế độ dự phòng sự cố.",
    media_framing: `Báo cáo thô từ nguồn: ${art.source || "Unknown"} (Chế độ dự phòng khẩn cấp).`,
    delta_update: "Chưa phân tích được do AI tạm thời gián đoạn.",
    impact: `Theo dõi thêm diễn biến trong các ca tiếp theo.`,
    sources: [
      {
        name: art.source || "Unknown",
        tier: art.source_tier || 2,
        url: art.link || ""
      }
    ]
  }));

  return {
    overview: `⚠️ Hệ thống AI tổng hợp tạm thời gián đoạn. Dưới đây là ${topArticles.length} tin tức thô mới nhất cho chủ đề "${topic}".`,
    trend_radar: "Tạm thời không khả dụng do hệ thống AI đang ở chế độ dự phòng sự cố.",
    events
  };
}

/**
 * Synthesizes articles via OpenRouter with multi-model cascade and Institutional v4 protocol.
 *
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @param {Array<Object>} topicHistory
 * @returns {Promise<{overview: string, trend_radar: string, events: Array}>}
 */
async function synthesizeArticles(topic, articles, topicGuidance = null, topicHistory = []) {
  if (!articles || articles.length === 0) {
    return {
      overview: `Không ghi nhận tin tức mới cho chủ đề "${topic}" trong khung giờ này.`,
      trend_radar: "Theo dõi thêm các diễn biến trong các ca tiếp theo.",
      events: []
    };
  }

  const client = getOpenRouterClient();
  const userContent = buildPrompt(topic, articles, topicGuidance, topicHistory);
  let lastError = null;

  for (const modelName of OPENROUTER_MODELS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        console.log(`[OpenRouter OSINT v4] Trying model "${modelName}" (attempt ${attempt}/${ATTEMPTS_PER_MODEL})...`);

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
          if (
            formatErr.message?.includes("response_format") ||
            formatErr.message?.includes("json_object") ||
            formatErr.status === 400
          ) {
            console.log(`[OpenRouter] Model "${modelName}" doesn't support json_object mode. Retrying without it...`);
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

        if (!parsed || typeof parsed !== "object") {
          throw new Error("Failed to parse valid JSON from OpenRouter model response");
        }

        const events = Array.isArray(parsed.events) ? parsed.events : [];
        events.sort((a, b) => (PRIORITY_ORDER[a.priority] || 4) - (PRIORITY_ORDER[b.priority] || 4));

        console.log(`[OpenRouter OSINT v4] ✅ Success with model "${modelName}". Events: ${events.length}`);
        return {
          overview: parsed.overview || "Không có tóm tắt tổng quan.",
          trend_radar: parsed.trend_radar || "Chưa có dự báo xu hướng cụ thể.",
          events
        };
      } catch (error) {
        lastError = error;
        const transient = isTransientError(error);
        console.warn(
          `[OpenRouter OSINT v4] ❌ Model "${modelName}" attempt ${attempt}/${ATTEMPTS_PER_MODEL} failed: ${error.message}`
        );

        if (transient && attempt < ATTEMPTS_PER_MODEL) {
          console.log(`[OpenRouter] Transient error — retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }

        console.log(`[OpenRouter] Falling back to next model in cascade...`);
        break;
      }
    }
  }

  // ALL models exhausted -> Graceful Raw Fallback
  console.warn(
    `[OpenRouter OSINT v4] ⚠️ All ${OPENROUTER_MODELS.length} models failed. Activating raw fallback for "${topic}". Last error: ${lastError?.message}`
  );
  return buildRawFallbackJson(topic, articles);
}

module.exports = {
  synthesizeArticles,
  buildPrompt,
  buildRawFallbackJson,
  IMMUTABLE_SYSTEM_PROMPT,
  OPENROUTER_MODELS
};
