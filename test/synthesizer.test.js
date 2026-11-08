const test = require("node:test");
const assert = require("node:assert");
const {
  buildPrompt,
  buildRawFallbackJson,
  validateAndSanitizeDigest,
  getModelsList,
  synthesizeArticles
} = require("../lib/synthesizer");
const { parseRecentEventsFromRows, formatVietnamDate } = require("../lib/db_operations");

test("synthesizer: buildPrompt formats article list and target language instruction", () => {
  const articles = [
    { title: "Article 1", source: "Reuters", link: "https://reuters.com", content_snippet: "Snippet 1" },
    { title: "Article 2", source: "Bloomberg", link: "https://bloomberg.com", content_snippet: "Snippet 2" }
  ];

  const prompt = buildPrompt("Semiconductors", articles, null, [], "ja");
  assert.ok(prompt.includes('TARGET TOPIC: "Semiconductors"'));
  assert.ok(prompt.includes("OUTPUT LANGUAGE: Produce all fields"));
  assert.ok(prompt.includes("Japanese"));
  assert.ok(prompt.includes("--- ARTICLE [1] ---"));
  assert.ok(prompt.includes("Reuters"));
  assert.ok(prompt.includes("--- ARTICLE [2] ---"));
});

test("synthesizer: buildRawFallbackJson provides emergency response when AI offline", () => {
  const articles = [
    { title: "Headline 1", source: "BBC", link: "https://bbc.com/1", content_snippet: "Snippet text" }
  ];

  const fallback = buildRawFallbackJson("World News", articles);
  assert.ok(fallback.overview.includes("emergency fallback"));
  assert.strictEqual(fallback.events.length, 1);
  assert.strictEqual(fallback.events[0].title, "Headline 1");
  assert.strictEqual(fallback.events[0].sources[0].url, "https://bbc.com/1");
});

test("Phase 5.1: buildPrompt includes recent sent events and anti-repetition rule", () => {
  const articles = [
    { title: "Chelsea equalizes 1-1", source: "Sky Sports", link: "https://skysports.com/1", content_snippet: "Chelsea scored." }
  ];
  const recentEvents = [
    { title: "Arsenal leads 1-0 in first half", date: "2026-11-08" },
    { title: "Pre-match injury report: Saka starts", date: "2026-11-07" }
  ];

  const prompt = buildPrompt("Arsenal", articles, null, [], "en", recentEvents);
  assert.ok(prompt.includes("EVENTS ALREADY REPORTED EARLIER (WITH DATES):"));
  assert.ok(prompt.includes("[2026-11-08] Arsenal leads 1-0 in first half"));
  assert.ok(prompt.includes("[2026-11-07] Pre-match injury report: Saka starts"));
  assert.ok(prompt.includes("ANTI-REPETITION RULE:"));
  assert.ok(prompt.includes("Do not report these events again UNLESS there is a significant new development"));
  assert.ok(prompt.includes("If reported again, write only the new part."));
});

test("Phase 5.1: buildPrompt omits anti-repetition block entirely when recentEvents is empty, null or undefined", () => {
  const articles = [
    { title: "Test Article", source: "Reuters", link: "https://reuters.com", content_snippet: "Snippet" }
  ];

  // Case 1: Empty array
  const promptEmpty = buildPrompt("AI", articles, null, [], "en", []);
  assert.strictEqual(promptEmpty.includes("EVENTS ALREADY REPORTED EARLIER"), false);
  assert.strictEqual(promptEmpty.includes("ANTI-REPETITION RULE"), false);

  // Case 2: null
  const promptNull = buildPrompt("AI", articles, null, [], "en", null);
  assert.strictEqual(promptNull.includes("EVENTS ALREADY REPORTED EARLIER"), false);
  assert.strictEqual(promptNull.includes("ANTI-REPETITION RULE"), false);

  // Case 3: undefined (default parameter)
  const promptUndefined = buildPrompt("AI", articles);
  assert.strictEqual(promptUndefined.includes("EVENTS ALREADY REPORTED EARLIER"), false);
  assert.strictEqual(promptUndefined.includes("ANTI-REPETITION RULE"), false);
});

test("Phase 5.1: parseRecentEventsFromRows safely handles invalid JSON in summary_json", () => {
  const rows = [
    { delivery_date: "2026-11-08", summary_json: "{ malformed json string without closing" },
    {
      delivery_date: "2026-11-07",
      summary_json: JSON.stringify({
        events: [{ title: "Valid Event After Malformed Row" }]
      })
    }
  ];

  const events = parseRecentEventsFromRows(rows, 5);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].title, "Valid Event After Malformed Row");
  assert.strictEqual(events[0].date, "2026-11-07");
});

test("Phase 5.1: parseRecentEventsFromRows safely handles empty, null or missing events", () => {
  const rows = [
    { delivery_date: "2026-11-08", summary_json: JSON.stringify({ events: [] }) },
    { delivery_date: "2026-11-08", summary_json: JSON.stringify({ events: null }) },
    { delivery_date: "2026-11-08", summary_json: JSON.stringify({ overview: "Just overview, no events" }) },
    { delivery_date: "2026-11-08", summary_json: JSON.stringify({ events: [{ title: "" }, { not_title: "123" }] }) }
  ];

  const events = parseRecentEventsFromRows(rows, 5);
  assert.strictEqual(events.length, 0);
});

test("Phase 5.1: parseRecentEventsFromRows handles older digest structures (array or items)", () => {
  const rows = [
    // Old structure 1: summary_json is a direct array of objects
    {
      delivery_date: "2026-11-06",
      summary_json: JSON.stringify([
        { title: "Legacy Event From Array Structure" }
      ])
    },
    // Old structure 2: summary_json has items instead of events
    {
      delivery_date: "2026-11-05",
      summary_json: JSON.stringify({
        items: [{ headline: "Legacy Event From Items Structure" }]
      })
    }
  ];

  const events = parseRecentEventsFromRows(rows, 5);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].title, "Legacy Event From Array Structure");
  assert.strictEqual(events[0].date, "2026-11-06");
  assert.strictEqual(events[1].title, "Legacy Event From Items Structure");
  assert.strictEqual(events[1].date, "2026-11-05");
});

test("Phase 5.1: parseRecentEventsFromRows returns empty array when rows are empty (no history)", () => {
  assert.deepStrictEqual(parseRecentEventsFromRows([]), []);
  assert.deepStrictEqual(parseRecentEventsFromRows(null), []);
  assert.deepStrictEqual(parseRecentEventsFromRows(undefined), []);
});

test("synthesizer: getModelsList respects LLM_MODEL and LLM_FALLBACK_MODEL", () => {
  const origModel = process.env.LLM_MODEL;
  const origFallback = process.env.LLM_FALLBACK_MODEL;

  try {
    process.env.LLM_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
    process.env.LLM_FALLBACK_MODEL = "nvidia/nemotron-3.5-lightning:free";

    const models = getModelsList();
    assert.strictEqual(models.length, 2);
    assert.strictEqual(models[0], "nvidia/nemotron-3-ultra-550b-a55b:free");
    assert.strictEqual(models[1], "nvidia/nemotron-3.5-lightning:free");
  } finally {
    process.env.LLM_MODEL = origModel;
    process.env.LLM_FALLBACK_MODEL = origFallback;
  }
});

test("synthesizer: hard guard blocks non-free model from execution", async () => {
  const origModel = process.env.LLM_MODEL;
  const origFallback = process.env.LLM_FALLBACK_MODEL;
  try {
    process.env.LLM_MODEL = "openai/gpt-4o";
    process.env.LLM_FALLBACK_MODEL = "anthropic/claude-3-opus";
    const articles = [{ title: "Test Headline", link: "https://example.com/test", content_snippet: "Snippet" }];
    const res = await synthesizeArticles("test", articles);
    assert.ok(res.overview.includes("emergency fallback"));
  } finally {
    process.env.LLM_MODEL = origModel;
    process.env.LLM_FALLBACK_MODEL = origFallback;
  }
});

test("synthesizer: validateAndSanitizeDigest discards invalid events missing title or core_verdict", () => {
  const articles = [
    { title: "Art 1", link: "https://example.com/1", source: "Src 1" },
    { title: "Art 2", link: "https://example.com/2", source: "Src 2" }
  ];

  const parsed = {
    overview: "Overall briefing",
    events: [
      {
        title: "Valid Title 1",
        core_verdict: "Valid core verdict 1",
        key_highlights: ["Highlight 1"],
        source_indices: [1]
      },
      {
        title: "", // Missing title -> MUST BE DISCARDED
        core_verdict: "Orphan verdict",
        key_highlights: []
      },
      {
        title: "Missing Verdict Title",
        core_verdict: "", // Missing verdict -> MUST BE DISCARDED
        key_highlights: []
      },
      {
        title: "Valid Title 2",
        core_verdict: "Valid core verdict 2",
        key_highlights: "Single string highlight", // Converted to array
        source_indices: [2]
      }
    ]
  };

  const validated = validateAndSanitizeDigest(parsed, articles);
  assert.ok(validated);
  assert.strictEqual(validated.events.length, 2);
  assert.strictEqual(validated.events[0].title, "Valid Title 1");
  assert.strictEqual(validated.events[1].title, "Valid Title 2");
  assert.deepStrictEqual(validated.events[1].key_highlights, ["Single string highlight"]);
  assert.strictEqual(validated.events[0].sources[0].url, "https://example.com/1");
});

test("Phase 5.1: formatVietnamDate prevents timezone shift on DATE values", () => {
  // Case 1: mysql2 creates DATE as UTC midnight
  const utcDate = new Date("2026-11-08T00:00:00.000Z");
  assert.strictEqual(formatVietnamDate(utcDate), "2026-11-08");

  // Case 2: Direct string from mysql2 (when dateStrings enabled)
  assert.strictEqual(formatVietnamDate("2026-11-08"), "2026-11-08");

  // Case 3: Leap day / year end boundary
  const yearEndDate = new Date("2026-12-31T00:00:00.000Z");
  assert.strictEqual(formatVietnamDate(yearEndDate), "2026-12-31");
  const newYearDate = new Date("2027-01-01T00:00:00.000Z");
  assert.strictEqual(formatVietnamDate(newYearDate), "2027-01-01");
});

test("Phase 5.1: parseRecentEventsFromRows respects increased limit of up to 12 events", () => {
  const eventsList = [];
  for (let i = 1; i <= 15; i++) {
    eventsList.push({ title: `Historical Event #${i}` });
  }

  const rows = [
    {
      delivery_date: "2026-11-08",
      summary_json: JSON.stringify({ events: eventsList })
    }
  ];

  const extracted = parseRecentEventsFromRows(rows, 12);
  assert.strictEqual(extracted.length, 12);
  assert.strictEqual(extracted[0].title, "Historical Event #1");
  assert.strictEqual(extracted[11].title, "Historical Event #12");
});
