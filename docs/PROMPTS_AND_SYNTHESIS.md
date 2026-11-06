# PROMPTS_AND_SYNTHESIS.md - Universal News Intelligence Engine

This document defines the prompt engineering standards, persona constraints, structured output schema, grounding protocols, and multi-language capabilities for the AI synthesis engine (`lib/synthesizer.js`) in `tele-intel-bot`.

---

## 1. Persona & Architectural Role

The synthesis engine acts as an **Objective, Precise, and Concise News Intelligence Editor**. Its core objective is to synthesize raw, multi-source RSS snippets and web articles into executive-grade, factual briefs for any topic on demand or on schedule.

### Core Principles & Anti-Hallucination Guardrails

1. **Strict Data Grounding (Tuyệt đối bám sát dữ liệu):**
   * Rely exclusively on the provided article snippets and scraped content.
   * Never speculate, assume, or fabricate facts, metrics, unmentioned context, or hidden motives.
   * If a detail is missing from the input text, do not mention or extrapolate it.

2. **Neutrality & Despinning (Trung lập & Gỡ giật tít):**
   * Rephrase clickbait, sensationalist, or sensationalized headlines into clear, objective statements.
   * Remove promotional PR spin, sensationalist adjectives, and emotional hyperbole.

3. **Universal Topical Compatibility (Tương thích mọi chủ đề):**
   * Designed to work universally for any domain: sports (football, racing), technology (AI, semiconductors, gadgets), financial markets, geopolitics, science, and general culture.
   * Avoid enforcing domain-specific concepts (such as legal bills or macroeconomic stats) on non-economic topics.

4. **Executive Inverted Pyramid (Kim tự tháp đảo ngược):**
   * `core_verdict`: 1–2 direct, active sentences explaining what happened and the primary outcome.
   * `key_highlights`: 2–3 concise bullet points focusing on concrete figures, player/team/company names, and verifiable actions.
   * `impact`: 1 concise sentence highlighting the direct consequence, standing, or immediate next step (only if supported by the source articles).

5. **Ground-Truth Source Attribution (Liên kết nguồn gốc thực tế):**
   * To completely prevent hallucinated URLs, the AI **does not generate URLs**.
   * The AI only outputs `source_indices: [1, 2]`, referencing the 1-based index of the articles provided in the prompt.
   * The application code maps these indices back to genuine scraped URLs and verified publisher names.
   * **Verification Badge**:
     * If an event references $\ge 2$ independent articles $\rightarrow$ marked `🛡️ [MULTI-SOURCE]` / `[ĐA NGUỒN]`.
     * If an event references 1 article $\rightarrow$ marked `📰 [SINGLE SOURCE]` / `[NGUỒN ĐƠN]`.

6. **Brevity & Proportionality (Ngắn gọn theo lượng tin):**
   * Limit to at most 3 to 5 distinct, meaningful events.
   * If there is only minimal or repetitive news, summarize it in 1 event.
   * If the input contains no actionable news, return an empty events list `[]`.

7. **Global Multi-Language Directive (Đa ngôn ngữ toàn cầu):**
   * All synthesized text (`overview`, `title`, `core_verdict`, `key_highlights`, `impact`) must strictly match the target language chosen by the user in `user_settings` (`en`, `vi`, `zh`, `ja`, `ko`, `de`, `fr`, `ru`, `es`).

---

## 2. JSON Schema Specification

All AI synthesis calls enforce structured JSON output adhering to the following schema:

```json
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
}
```

---

## 3. High Availability Model Cascade & Fallback Strategy

The engine utilizes **OpenRouter** with automatic model cascading and retry mechanisms to guarantee 24/7 reliability:

1. **Primary Model:** `deepseek/deepseek-chat` (DeepSeek V3 - High intelligence, outstanding multilingual fluency, economical token usage).
2. **Tier 2 Fallback:** `nvidia/nemotron-3.5-lightning:free`
3. **Tier 3 Fallback:** `nvidia/nemotron-3-ultra-550b-a55b:free`
4. **Tier 4 Fallback:** `google/gemma-4-31b-it:free`
5. **Emergency Raw Fallback (`buildRawFallbackJson`):** If all upstream models are unavailable, the top raw articles are formatted directly into clean Telegram HTML pages with direct links, preserving 100% broadcast continuity.
