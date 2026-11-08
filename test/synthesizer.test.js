const test = require("node:test");
const assert = require("node:assert");
const { buildPrompt, buildRawFallbackJson } = require("../lib/synthesizer");

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
