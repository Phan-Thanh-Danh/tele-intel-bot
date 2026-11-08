const test = require("node:test");
const assert = require("node:assert");
const { buildPrompt, buildRawFallbackJson } = require("../lib/synthesizer");
const { parseRecentEventsFromRows } = require("../lib/db_operations");

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
