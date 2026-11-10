const test = require("node:test");
const assert = require("node:assert");
const {
  escapeHtml,
  getPriorityBadge,
  formatEventBlock,
  chunkInstantResearchToPages
} = require("../lib/chunker");

test("chunker: escapeHtml sanitizes unsafe HTML characters", () => {
  const unsafe = "<script>alert('xss&co')</script>";
  const safe = escapeHtml(unsafe);
  assert.strictEqual(safe, "&lt;script&gt;alert('xss&amp;co')&lt;/script&gt;");
});

test("chunker: getPriorityBadge returns proper badges", () => {
  const highVi = getPriorityBadge("HIGH", "vi");
  const normalVi = getPriorityBadge("NORMAL", "vi");
  const highEn = getPriorityBadge("HIGH", "en");

  assert.ok(highVi.includes("[TRỌNG TÂM]"));
  assert.ok(normalVi.includes("[ĐÁNG CHÚ Ý]"));
  assert.ok(highEn.includes("[BREAKING]"));
});

test("chunker: formatEventBlock renders multi-source badge when >= 2 sources present", () => {
  const event = {
    priority: "HIGH",
    title: "Breakthrough Discovery",
    core_verdict: "Scientists found clean energy solution.",
    key_highlights: ["High efficiency", "Zero emission"],
    impact: "Revolutionizes modern grid.",
    sources: [
      { name: "Reuters", url: "https://reuters.com/1" },
      { name: "Bloomberg", url: "https://bloomberg.com/2" }
    ]
  };

  const html = formatEventBlock(event, "en");
  assert.ok(html.includes("[MULTI-SOURCE]"));
  assert.ok(html.includes("https://reuters.com/1"));
  assert.ok(html.includes("https://bloomberg.com/2"));
  assert.ok(html.includes("Scientists found clean energy solution."));
});

test("chunker: formatEventBlock renders single-source badge when 1 source present", () => {
  const event = {
    priority: "NORMAL",
    title: "Local update",
    core_verdict: "One outlet reported a rumor.",
    key_highlights: ["Unverified detail"],
    sources: [{ name: "Blog", url: "https://blog.com/1" }]
  };

  const html = formatEventBlock(event, "en");
  assert.ok(html.includes("[SINGLE SOURCE]"));
  assert.ok(html.includes("https://blog.com/1"));
});

test("chunker: chunkInstantResearchToPages creates valid pages without overflow", () => {
  const summary = {
    overview: "Global overview text.",
    events: [
      {
        priority: "HIGH",
        title: "Test Event 1",
        core_verdict: "Core outcome 1.",
        key_highlights: ["Highlight 1"],
        sources: [{ name: "Source 1", url: "https://src1.com" }]
      }
    ]
  };

  const pages = chunkInstantResearchToPages("Tech", summary, "en");
  assert.strictEqual(Array.isArray(pages), true);
  assert.strictEqual(pages.length, 1);
  assert.ok(pages[0].includes("INSTANT INTEL: TECH"));
  assert.ok(pages[0].includes("Global overview text."));
});
