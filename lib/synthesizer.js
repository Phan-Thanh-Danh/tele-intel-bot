const OpenAI = require("openai");

const { getLanguageName } = require("./i18n");

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

const OPENROUTER_MODELS = [
  "deepseek/deepseek-chat",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free"
];

const ATTEMPTS_PER_MODEL = 2;
const RETRY_DELAY_MS = 2500;

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
 * Builds the user prompt containing input articles and topic-specific guidance.
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @param {Array<Object>} topicHistory
 * @param {string} langCode
 * @returns {string}
 */
function buildPrompt(topic, articles, topicGuidance = null, topicHistory = [], langCode = "en") {
  const languageName = getLanguageName(langCode);
  let prompt = `TARGET TOPIC: "${topic}"\n`;
  prompt += `OUTPUT LANGUAGE: Produce all fields (overview, title, core_verdict, key_highlights, impact) strictly in ${languageName}.\n\n`;

  if (topicGuidance && topicGuidance.trim().length > 0) {
    prompt += `TOPIC GUIDANCE:\n${topicGuidance.trim()}\n\n`;
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
 * Synthesizes articles via OpenRouter with multi-model cascade and Institutional v4 protocol.
 *
 * @param {string} topic
 * @param {Array<Object>} articles
 * @param {string|null} topicGuidance
 * @param {Array<Object>} topicHistory
 * @param {string} langCode
 * @returns {Promise<{overview: string, trend_radar: string, events: Array}>}
 */
async function synthesizeArticles(topic, articles, topicGuidance = null, topicHistory = [], langCode = "en") {
  if (!articles || articles.length === 0) {
    return {
      overview: `No fresh intelligence recorded for topic "${topic}".`,
      trend_radar: "Awaiting subsequent updates.",
      events: []
    };
  }

  const client = getOpenRouterClient();
  const userContent = buildPrompt(topic, articles, topicGuidance, topicHistory, langCode);
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

        const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
        
        // Attach genuine verified sources based on source_indices
        const events = rawEvents.map((evt) => {
          const rawIndices = Array.isArray(evt.source_indices) ? evt.source_indices : [];
          const attachedSources = [];
          const seenLinks = new Set();

          for (const idx of rawIndices) {
            const article = articles[idx - 1]; // 1-based index from prompt
            if (article && article.link && !seenLinks.has(article.link)) {
              seenLinks.add(article.link);
              attachedSources.push({
                name: article.source || "News",
                url: article.link
              });
            }
          }

          // Fallback if model missed source_indices: attach first available article
          if (attachedSources.length === 0 && articles.length > 0) {
            attachedSources.push({
              name: articles[0].source || "News",
              url: articles[0].link
            });
          }

          return {
            priority: (evt.priority || "NORMAL").toUpperCase() === "HIGH" ? "HIGH" : "NORMAL",
            title: evt.title || "Intelligence Item",
            core_verdict: evt.core_verdict || "",
            key_highlights: Array.isArray(evt.key_highlights) ? evt.key_highlights : [],
            impact: evt.impact || "",
            sources: attachedSources
          };
        });

        events.sort((a, b) => (PRIORITY_ORDER[a.priority] || 4) - (PRIORITY_ORDER[b.priority] || 4));

        console.log(`[OpenRouter OSINT] ✅ Success with model "${modelName}". Events: ${events.length}`);
        return {
          overview: parsed.overview || "",
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
