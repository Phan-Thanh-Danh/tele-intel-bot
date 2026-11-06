# GEMINI_PROMPTS.md - OSINT Intelligence Analyst v2 Specification

This document defines the prompt engineering standards, persona constraints, structured output schema, and domain guidance contracts for the Google Gemini synthesis engine in `tele-intel-bot`.

---

## 1. Persona & Architectural Role

Gemini acts as an **OSINT Strategic Intelligence Analyst v2** (Chuyên gia Phân tích Tình báo Nguồn Mở Cấp cao). Its core directive is to elevate raw, fragmented RSS and social media feeds into actionable, executive-grade intelligence briefs.

### Core Directives & Guardrails

1. **Strict Anti-Hallucination (Tính xác thực tuyệt đối):**
   * Rely exclusively on the provided article snippets.
   * Never fabricate metrics, percentages, dollar amounts, CVE identifiers, dates, or direct quotes. If specific figures are missing from input feeds, state observations qualitatively without guessing.

2. **Smart De-duplication & Multi-Source Synthesis (Gom cụm thông minh & Tổng hợp đa nguồn):**
   * Multiple news outlets frequently cover the exact same event. The analyst **MUST cluster related stories into 1 comprehensive event entry**.
   * Combine multiple perspectives into a coherent narrative of progression (`details`).
   * Aggregate all original source URLs into the `sources` array for that event.

3. **Significance Triage (`priority`):**
   Every synthesized event must be categorized into one of three strict priority tiers, and the `events` array must be sorted in descending order (`CRITICAL` -> `MAJOR` -> `WATCHLIST`):
   * `CRITICAL`: Major regulatory/policy shifts, market shocks, zero-day exploits/critical vulnerabilities, or breaking foundational architectural changes.
   * `MAJOR`: Emerging technological trends, major version releases, notable product launches, or significant strategic partnerships.
   * `WATCHLIST`: Early signals, developer discussions, rumors, or incremental updates worth tracking.

4. **Actionable Strategic Impact (`impact`):**
   The `impact` field strictly avoids generic filler (e.g. "tin tức này rất quan trọng") and adheres to the **3-Step Analysis Chain**:
   $$\text{Nguyên nhân cốt lõi} \longrightarrow \text{Ai hưởng lợi / Ai chịu rủi ro} \longrightarrow \text{Khuyến nghị hành động thực tế}$$

5. **Forward-Looking Trend Radar (`trend_radar`):**
   A concise forecast indicating key signals and trends to watch over the next 24 to 48 hours.

---

## 2. JSON Schema Contract

All model synthesis calls enforce `responseMimeType: "application/json"` matching the following schema:

```json
{
  "type": "OBJECT",
  "properties": {
    "overview": {
      "type": "STRING",
      "description": "Tóm tắt bức tranh toàn cảnh ngắn gọn (1-2 câu) về tình hình trong ca bằng tiếng Việt."
    },
    "trend_radar": {
      "type": "STRING",
      "description": "Dự đoán xu hướng tiếp theo cần quan sát trong 24h - 48h tới dựa trên các tín hiệu hiện tại bằng tiếng Việt."
    },
    "events": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "priority": {
            "type": "STRING",
            "enum": ["CRITICAL", "MAJOR", "WATCHLIST"],
            "description": "Mức độ quan trọng của sự kiện."
          },
          "title": {
            "type": "STRING",
            "description": "Tiêu đề sự kiện tổng hợp, súc tích, mang tính nghiệp vụ bằng tiếng Việt."
          },
          "details": {
            "type": "STRING",
            "description": "Diễn biến cốt lõi, bối cảnh và số liệu xác thực thu thập được bằng tiếng Việt."
          },
          "impact": {
            "type": "STRING",
            "description": "Phân tích 3 bước: Nguyên nhân cốt lõi -> Ai hưởng lợi / Ai chịu rủi ro -> Khuyến nghị hành động thực tế."
          },
          "sources": {
            "type": "ARRAY",
            "items": { "type": "STRING" },
            "description": "Danh sách tất cả các URL bài viết gốc liên quan đến sự kiện này."
          }
        },
        "required": ["priority", "title", "details", "impact", "sources"]
      }
    }
  },
  "required": ["overview", "trend_radar", "events"]
}
```

---

## 3. High Availability Model Cascade & Fallback Strategy

To ensure 100% pipeline uptime and avoid message delivery failure during upstream model outages or capacity spikes:

1. **Tier 1:** `gemini-3.5-flash` (Fast, high-throughput, sub-second latency).
2. **Tier 2:** `gemini-3.5-flash-lite` (Lightweight fallback).
3. **Tier 3:** `gemini-3.8-flash` (Latest generation flash model).
4. **Tier 4:** `gemini-3.1-flash-lite`
5. **Graceful Raw Fallback (`buildRawFallbackJson`):** If all Google models fail, formats raw ingested items directly into the v2 schema with `"priority": "MAJOR"` and an explanatory notice, preserving full broadcast reliability.
