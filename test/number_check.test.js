/**
 * test/number_check.test.js
 *
 * Phase 5.2 - Number verification test suite.
 * All tests are computed by code. No hardcoded labels.
 * Pure unit tests, zero database dependency, never hangs.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  checkDigestNumbers,
  verifyEventNumbers,
  extractNumbers,
  cleanText,
  parseCandidateNumbers,
  roundHalfUp,
  areUnitKindsCompatible,
  checkDirectMatch,
  checkDerivedMatch
} = require("../lib/number_check");
const { formatEventBlock, escapeHtml } = require("../lib/chunker");

// Helper to build a clean event object
function makeEvent(overrides = {}) {
  return {
    priority: "NORMAL",
    title: "Test Event Title",
    core_verdict: "Test Core Verdict",
    key_highlights: ["Highlight 1"],
    impact: "Strategic Impact",
    sources: [{ name: "Source 1", url: "https://example.com/1" }],
    source_indices: [1],
    ...overrides
  };
}

// Helper to build article objects
function makeArticle(snippet, title = "Source Article Title", index = 1) {
  return {
    title,
    source: `Source ${index}`,
    link: `https://example.com/${index}`,
    content_snippet: snippet
  };
}

// -----------------------------------------------------------------------------
// Test 1: Exact match
// -----------------------------------------------------------------------------
test("number_check 1: exact match is verified and not flagged", () => {
  const articles = [makeArticle("VinFast đầu tư 100 triệu USD xây dựng nhà máy.")];
  const event = makeEvent({
    core_verdict: "VinFast chính thức đầu tư 100 triệu USD xây dựng cơ sở mới.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.checked, true);
  assert.equal(verified.number_check.not_found.length, 0, "Exact number must not be flagged");
});

// -----------------------------------------------------------------------------
// Test 2: Format differences (1.5 billion vs 1,5 tỷ; 5 percent vs 5%)
// -----------------------------------------------------------------------------
test("number_check 2: format differences (1.5 billion vs 1,5 tỷ; 5 percent vs 5%) match correctly", () => {
  const articles = [
    makeArticle("The acquisition was valued at 1.5 billion USD with growth at 5 percent."),
  ];
  const event = makeEvent({
    core_verdict: "Thương vụ được định giá 1,5 tỷ USD với tốc độ tăng trưởng đạt 5%.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 0, "Normalized magnitudes and percent signs must match");
});

// -----------------------------------------------------------------------------
// Test 3: Ambiguous separators both ways (1.234 vs 1,234)
// -----------------------------------------------------------------------------
test("number_check 3: ambiguous separators match both ways", () => {
  // Case A: Source uses dot thousands, Model uses comma
  const articlesA = [makeArticle("Đã có 1.234 đơn vị tham gia sự kiện.")];
  const eventA = makeEvent({
    core_verdict: "Ghi nhận 1,234 đơn vị tham gia ngày hội.",
    source_indices: [1]
  });
  const verifiedA = verifyEventNumbers(eventA, articlesA, []);
  assert.equal(verifiedA.number_check.not_found.length, 0, "1.234 in source matches 1,234 in model");

  // Case B: Source uses comma thousands, Model uses dot
  const articlesB = [makeArticle("Recorded 1,234 orders in the initial launch.")];
  const eventB = makeEvent({
    core_verdict: "Đạt mốc 1.234 đơn hàng trong ngày mở bán.",
    source_indices: [1]
  });
  const verifiedB = verifyEventNumbers(eventB, articlesB, []);
  assert.equal(verifiedB.number_check.not_found.length, 0, "1,234 in source matches 1.234 in model");
});

// -----------------------------------------------------------------------------
// Test 4: Rounding accepted (source 3.18 billion, model "3,2 tỷ")
// -----------------------------------------------------------------------------
test("number_check 4: rounding accepted (source 3.18 billion vs model 3,2 tỷ)", () => {
  const articles = [makeArticle("Total company valuation reached 3.18 billion USD this quarter.")];
  const event = makeEvent({
    core_verdict: "Định giá công ty đạt ngưỡng gần 3,2 tỷ USD trong quý.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 0, "3.18 billion rounds to 3.2 billion at 1 decimal place");
});

// -----------------------------------------------------------------------------
// Test 5: Wrong magnitude rejected (3,2 tỷ vs 3,2 triệu)
// -----------------------------------------------------------------------------
test("number_check 5: wrong magnitude rejected (3,2 tỷ vs 3,2 triệu)", () => {
  const articles = [makeArticle("Dự án được cấp ngân sách 3,2 triệu USD.")];
  const event = makeEvent({
    core_verdict: "Dự án được cấp ngân sách lên tới 3,2 tỷ USD.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 1, "Wrong magnitude (tỷ vs triệu) must be flagged");
  assert.match(verified.number_check.not_found[0].raw, /3,2\s*tỷ/i);
});

// -----------------------------------------------------------------------------
// Test 6: Fabricated number flagged
// -----------------------------------------------------------------------------
test("number_check 6: fabricated number not in sources is flagged", () => {
  const articles = [makeArticle("Nhà máy có công suất 5 GWh/năm.")];
  const event = makeEvent({
    core_verdict: "Nhà máy đạt công suất 999 GWh/năm tại Cát Hải.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 1);
  assert.match(verified.number_check.not_found[0].raw, /999\s*GWh/i);
});

// -----------------------------------------------------------------------------
// Test 7: Differing currencies rejected (100 USD vs 100 EUR)
// -----------------------------------------------------------------------------
test("number_check 7: currency differing (100 USD vs 100 EUR) is flagged", () => {
  const articles = [makeArticle("Doanh nghiệp huy động được 100 triệu USD vốn đầu tư.")];
  const event = makeEvent({
    core_verdict: "Doanh nghiệp huy động được 100 triệu EUR vốn đầu tư.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 1);
  assert.match(verified.number_check.not_found[0].raw, /100\s*triệu\s*EUR/i);
});

// -----------------------------------------------------------------------------
// Test 8: Derived sum and difference accepted
// -----------------------------------------------------------------------------
test("number_check 8: derived sum and difference accepted", () => {
  // Source has 5 GWh (giai đoạn 1) and 12 GWh (tổng giai đoạn 2).
  // Model states: "tăng thêm 7 GWh" (12 - 5 = 7).
  const articles = [
    makeArticle("Giai đoạn 1 công suất 5 GWh. Khi hoàn thành giai đoạn 2 nâng tổng công suất lên 12 GWh.")
  ];
  const event = makeEvent({
    core_verdict: "Công suất nhà máy tăng thêm 7 GWh sau khi mở rộng.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 0, "Derived difference 12 - 5 = 7 must not be flagged as missing");
  assert.equal(verified.number_check.derived.length, 1, "Must be recorded in derived list");
  assert.match(verified.number_check.derived[0].formula, /7 GWh/i);
});

// -----------------------------------------------------------------------------
// Test 9: Derived not matching flagged
// -----------------------------------------------------------------------------
test("number_check 9: derived calculation not matching is flagged", () => {
  const articles = [
    makeArticle("Giai đoạn 1 có 5 GWh, giai đoạn 2 đạt 12 GWh.")
  ];
  const event = makeEvent({
    core_verdict: "Nhà máy tăng thêm 9 GWh sản lượng.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 1, "Number 9 cannot be derived from 5 and 12 and must be flagged");
});

// -----------------------------------------------------------------------------
// Test 10: Sports score reversed accepted (3-1 vs 1-3)
// -----------------------------------------------------------------------------
test("number_check 10: sports scores reversed (3-1 vs 1-3) match cleanly", () => {
  const articles = [makeArticle("Đội tuyển Việt Nam giành chiến thắng thuyết phục 3-1 trước đối thủ.")];
  const event = makeEvent({
    core_verdict: "Đối thủ chịu thất bại 1-3 trước tuyển Việt Nam.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 0, "Score 1-3 must match 3-1");
});

// -----------------------------------------------------------------------------
// Test 11: Skipped years, dates, times, ordinals and identifiers (5G, GPT-4, giai đoạn 2)
// -----------------------------------------------------------------------------
test("number_check 11: skips standalone years, dates, times, ordinals, and tech identifiers", () => {
  const text = "Ngày 08/11/2026 lúc 19:30, nhóm đã thử nghiệm phiên bản v2 trên mạng 5G với GPT-4 trong giai đoạn 2 năm 2026.";
  const { extracted, skipped } = extractNumbers(text, "test_field");

  assert.equal(extracted.length, 0, "All ordinals, dates, times, identifiers, and standalone years must be skipped");
  assert.ok(skipped.length > 0, "Skipped tokens should be logged in skipped list");
  const reasons = skipped.map(s => s.reason);
  assert.ok(reasons.includes("part_of_date") || reasons.includes("preceded_by_ordinal_or_time_marker") || reasons.includes("standalone_year"));
});

// -----------------------------------------------------------------------------
// Test 12: Numbers in markdown bold
// -----------------------------------------------------------------------------
test("number_check 12: numbers wrapped in markdown bold are extracted and matched", () => {
  const articles = [makeArticle("Đã nhận được 10.000 đơn hàng linh kiện mới.")];
  const event = makeEvent({
    core_verdict: "Doanh nghiệp xác nhận đã chốt thành công **10.000** đơn hàng mới.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 0, "Bold markdown must be stripped before extraction");
});

// -----------------------------------------------------------------------------
// Test 13: NFC vs NFD Vietnamese text
// -----------------------------------------------------------------------------
test("number_check 13: NFC vs NFD Vietnamese normalization matches cleanly", () => {
  // Source written in NFD (decomposed)
  const nfdSnippet = "Khai trương trung tâm 100 triệu USD".normalize("NFD");
  const articles = [makeArticle(nfdSnippet)];

  // Model written in NFC (composed)
  const nfcVerdict = "Đầu tư trung tâm quy mô 100 triệu USD".normalize("NFC");
  const event = makeEvent({
    core_verdict: nfcVerdict,
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 0, "NFC and NFD text must match identically");
});

// -----------------------------------------------------------------------------
// Test 14: Non-breaking spaces (NBSP)
// -----------------------------------------------------------------------------
test("number_check 14: non-breaking spaces in numbers are handled seamlessly", () => {
  const nbspSnippet = "Quy mô vốn đạt 50\u00A0triệu\u202FUSD trong giai đoạn đầu.";
  const articles = [makeArticle(nbspSnippet)];

  const event = makeEvent({
    core_verdict: "Dự án ghi nhận 50 triệu USD tổng vốn đăng ký.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.not_found.length, 0, "NBSP in sources or model must be normalized");
});

// -----------------------------------------------------------------------------
// Test 15: Invalid source_indices handled cleanly
// -----------------------------------------------------------------------------
test("number_check 15: invalid source_indices fall back to batch and log citation_invalid", () => {
  const articles = [
    makeArticle("Bài báo 1 có 5 GWh."),
    makeArticle("Bài báo 2 ghi nhận 100 triệu USD.")
  ];
  const event = makeEvent({
    core_verdict: "Doanh nghiệp nhận được 100 triệu USD.",
    source_indices: [999] // Out of bounds index
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.notes.citation_invalid, true);
  assert.equal(verified.number_check.not_found.length, 0, "Should be found in batch reference and not warned");
});

// -----------------------------------------------------------------------------
// Test 16: Empty source text handled without crashing
// -----------------------------------------------------------------------------
test("number_check 16: empty source text handled without throwing", () => {
  const articles = [makeArticle("", "")];
  const event = makeEvent({
    core_verdict: "Ghi nhận 25 triệu USD.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, []);
  assert.equal(verified.number_check.checked, true);
  assert.equal(verified.number_check.not_found.length, 1);
});

// -----------------------------------------------------------------------------
// Test 17: History numbers allowed (from recentEvents titles)
// -----------------------------------------------------------------------------
test("number_check 17: numbers from recentEvents titles are accepted context", () => {
  const articles = [makeArticle("VinFast khởi công giai đoạn 2 nâng công suất lên 12 GWh.")];
  const recentEvents = [
    { title: "VinFast khánh thành giai đoạn 1 công suất 5 GWh tại Hải Phòng", date: "2026-11-08" }
  ];
  const event = makeEvent({
    core_verdict: "Sau giai đoạn 1 đạt 5 GWh, VinFast khởi công giai đoạn 2 đạt 12 GWh.",
    source_indices: [1]
  });

  const verified = verifyEventNumbers(event, articles, recentEvents);
  assert.equal(verified.number_check.not_found.length, 0, "5 GWh from recentEvents must be accepted as batch context");
});

// -----------------------------------------------------------------------------
// Test 18: HTML special characters in raw values escaped in rendered line
// -----------------------------------------------------------------------------
test("number_check 18: HTML special characters in not_found numbers are safely escaped in warning", () => {
  const event = makeEvent({
    title: "Sự kiện kiểm thử bảo mật",
    number_check: {
      checked: true,
      not_found: [{ raw: "<500> triệu USD", field: "core_verdict" }],
      derived: [],
      notes: {}
    }
  });

  const rendered = formatEventBlock(event, "vi");
  assert.ok(rendered.includes("&lt;500&gt; triệu USD"), "Raw numbers with HTML tags must be escaped in warning");
  assert.ok(!rendered.includes("<500> triệu USD"), "Unescaped HTML tags must not appear in rendered output");
  assert.ok(rendered.includes("Số liệu chưa đối chiếu được với nguồn:"), "Warning line must be rendered in Vietnamese");
});

// -----------------------------------------------------------------------------
// Test 19: Never-throws fuzz cases
// -----------------------------------------------------------------------------
test("number_check 19: never-throws robustness on null, undefined, and extreme inputs", () => {
  assert.doesNotThrow(() => checkDigestNumbers(null, null, null));
  assert.doesNotThrow(() => checkDigestNumbers(undefined, [], []));
  assert.doesNotThrow(() => checkDigestNumbers({}, [], []));
  assert.doesNotThrow(() => checkDigestNumbers({ events: [null, undefined, {}] }, [], []));

  // Extreme string length (> 20000 characters)
  const hugeText = "Số liệu 100 triệu USD ".repeat(2000);
  assert.doesNotThrow(() => cleanText(hugeText));
  assert.doesNotThrow(() => extractNumbers(hugeText, "huge"));
});

// -----------------------------------------------------------------------------
// Test 20: Idempotence (running twice does not duplicate)
// -----------------------------------------------------------------------------
test("number_check 20: idempotence check (calling verify twice produces identical result)", () => {
  const articles = [makeArticle("Dự án trị giá 50 triệu USD.")];
  const event = makeEvent({
    core_verdict: "Dự án trị giá 50 triệu USD và bổ sung 999 triệu EUR.",
    source_indices: [1]
  });

  const pass1 = verifyEventNumbers(event, articles, []);
  const notFoundCount1 = pass1.number_check.not_found.length;

  const pass2 = verifyEventNumbers(pass1, articles, []);
  const notFoundCount2 = pass2.number_check.not_found.length;

  assert.equal(notFoundCount1, notFoundCount2, "Running verification twice must not duplicate not_found entries");
  assert.equal(pass2.number_check.not_found.length, 1);
});

// -----------------------------------------------------------------------------
// Test 21: Extra line included in chunk length
// -----------------------------------------------------------------------------
test("number_check 21: warning line increases formatted event block length correctly", () => {
  const eventClean = makeEvent({
    title: "Tiêu đề kiểm tra",
    core_verdict: "Nhận định hợp lệ.",
    number_check: { checked: true, not_found: [], derived: [], notes: {} }
  });
  const eventWithWarning = makeEvent({
    title: "Tiêu đề kiểm tra",
    core_verdict: "Nhận định hợp lệ.",
    number_check: {
      checked: true,
      not_found: [{ raw: "888 triệu USD", field: "core_verdict" }],
      derived: [],
      notes: {}
    }
  });

  const blockClean = formatEventBlock(eventClean, "vi");
  const blockWarned = formatEventBlock(eventWithWarning, "vi");

  assert.ok(blockWarned.length > blockClean.length, "Formatted event with warning must be strictly longer than clean event");
  assert.ok(blockWarned.includes("Số liệu chưa đối chiếu được với nguồn: 888 triệu USD."));
});

// -----------------------------------------------------------------------------
// Test 22: Regression with real VinFast and Viettel scenarios
// -----------------------------------------------------------------------------
test("number_check 22: regression check for VinFast (12 GWh, 10.000 đơn) and Viettel (5G)", () => {
  const realArticles = [
    {
      title: "VinFast nhận thêm 10.000 đơn hàng pin và công bố khởi công giai đoạn 2 nâng công suất lên 12 GWh/năm",
      source: "Tuổi Trẻ",
      link: "https://tuoitre.vn/sample1",
      content_snippet: "Sau khi hoàn tất giai đoạn 1, VinFast công bố đã nhận thêm 10.000 đơn hàng xuất khẩu và chính thức khởi công giai đoạn 2, nâng tổng công suất nhà máy lên 12 GWh mỗi năm."
    },
    {
      title: "Bộ Thông tin và Truyền thông chính thức cấp giấy phép thương mại hóa tần số 5G cho Viettel",
      source: "VietnamNet",
      link: "https://vietnamnet.vn/sample2",
      content_snippet: "Chiều nay Bộ TT&TT đã chính thức trao giấy phép thiết lập mạng và cung cấp dịch vụ viễn thông 5G thương mại cho Viettel."
    }
  ];

  const recentEvents = [
    { title: "VinFast khánh thành giai đoạn 1 nhà máy sản xuất pin tại Hải Phòng (công suất 5 GWh/năm)", date: "2026-11-08" }
  ];

  const digest = {
    overview: "Tóm tắt tình hình mở rộng sản xuất pin 12 GWh và thương mại hóa mạng viễn thông 5G.",
    events: [
      {
        priority: "HIGH",
        title: "VinFast khởi công giai đoạn 2 nhà máy pin, nâng công suất lên 12 GWh/năm",
        core_verdict: "Sau giai đoạn 1 (5 GWh), VinFast khởi công giai đoạn 2 nâng công suất lên 12 GWh/năm và chốt 10.000 đơn hàng.",
        key_highlights: ["Đạt 12 GWh mỗi năm", "10.000 đơn xuất khẩu"],
        impact: "Củng cố chuỗi cung ứng pin xe điện",
        sources: [{ name: "Tuổi Trẻ", url: "https://tuoitre.vn/sample1" }],
        source_indices: [1]
      },
      {
        priority: "NORMAL",
        title: "Viettel được cấp phép thương mại 5G",
        core_verdict: "Bộ TT&TT chính thức trao giấy phép 5G thương mại cho Viettel.",
        key_highlights: ["Giấy phép thương mại 5G chính thức"],
        impact: "Đẩy mạnh hạ tầng số",
        sources: [{ name: "VietnamNet", url: "https://vietnamnet.vn/sample2" }],
        source_indices: [2]
      }
    ]
  };

  const verified = checkDigestNumbers(digest, realArticles, recentEvents);
  assert.equal(verified.events[0].number_check.not_found.length, 0, "VinFast real numbers (12 GWh, 10.000, 5 GWh) must all match");
  assert.equal(verified.events[1].number_check.not_found.length, 0, "Viettel 5G identifier must be skipped and not flagged");
});

// -----------------------------------------------------------------------------
// Test 23: Precision rounding & near-miss rejection/acceptance (Sub-item A.3)
// -----------------------------------------------------------------------------
test("number_check 23: precision rounding rejects near misses and accepts valid precision matches", () => {
  // --- REJECTIONS ---
  // 1. Model "3,3 tỷ" vs Source 3.18 billion -> REJECT
  const src318 = extractNumbers("Đầu tư 3.18 tỷ USD.", "src").extracted;
  const mod33 = extractNumbers("Đầu tư 3,3 tỷ USD.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod33, src318).match, false, "3.3 vs 3.18 must be REJECTED");

  // 2. Model "4 tỷ" vs Source 3.18 billion -> REJECT
  const mod4 = extractNumbers("Đầu tư 4 tỷ USD.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod4, src318).match, false, "4 vs 3.18 must be REJECTED");

  // 3. Model "5 tỷ" vs Source 3.18 billion -> REJECT
  const mod5 = extractNumbers("Đầu tư 5 tỷ USD.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod5, src318).match, false, "5 vs 3.18 must be REJECTED");

  // 4. Model "12.5 GWh" vs Source 12 GWh -> REJECT
  const src12 = extractNumbers("Công suất 12 GWh.", "src").extracted;
  const mod125 = extractNumbers("Công suất 12.5 GWh.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod125, src12).match, false, "12.5 GWh vs 12 GWh must be REJECTED");

  // 5. Model "11%" vs Source 10.6% -> REJECT (percentage near-miss)
  const src106 = extractNumbers("Tăng trưởng 10.6%.", "src").extracted;
  const mod11 = extractNumbers("Tăng trưởng 11%.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod11, src106).match, false, "11% vs 10.6% must be REJECTED");

  // 6. Derived: 9 vs (12 - 5) -> REJECT
  const srcPair = extractNumbers("Giai đoạn 1 là 5 GWh, giai đoạn 2 là 12 GWh.", "src").extracted;
  const modDeriv9 = extractNumbers("Tăng thêm 9 GWh.", "mod").extracted[0];
  assert.equal(checkDerivedMatch(modDeriv9, srcPair).derived, false, "Derived 9 vs 12-5 must be REJECTED");

  // 7. Derived: 7.4 vs (12 - 5 = 7) -> REJECT
  const modDeriv74 = extractNumbers("Tăng thêm 7.4 GWh.", "mod").extracted[0];
  assert.equal(checkDerivedMatch(modDeriv74, srcPair).derived, false, "Derived 7.4 vs 12-5 must be REJECTED");

  // --- ACCEPTANCES ---
  // 8. Model "3,2 tỷ" vs Source 3.18 billion -> ACCEPT (3.18 rounds half-up to 3.2 at D=1)
  const mod32 = extractNumbers("Đầu tư 3,2 tỷ USD.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod32, src318).match, true, "3.2 vs 3.18 must be ACCEPTED");

  // 9. Model "3 tỷ" vs Source 3.18 billion (written as integer D=0) -> ACCEPT (3.18 rounds half-up to 3)
  const mod3 = extractNumbers("Đầu tư 3 tỷ USD.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod3, src318).match, true, "3 (integer written) vs 3.18 must be ACCEPTED");

  // 10. Model "10.6%" vs Source 10.6% -> ACCEPT
  const mod106 = extractNumbers("Tăng trưởng 10.6%.", "mod").extracted[0];
  assert.equal(checkDirectMatch(mod106, src106).match, true, "10.6% vs 10.6% must be ACCEPTED");

  // 11. Derived: 7 vs (12 - 5 = 7) -> ACCEPT
  const modDeriv7 = extractNumbers("Tăng thêm 7 GWh.", "mod").extracted[0];
  assert.equal(checkDerivedMatch(modDeriv7, srcPair).derived, true, "Derived 7 vs 12-5 must be ACCEPTED");
});

// -----------------------------------------------------------------------------
// Test 24: Noun compatibility matrix and tests (Sub-item A.5)
// -----------------------------------------------------------------------------
test("number_check 24: noun compatibility matrix and unit kind conflict checks", () => {
  // Print compatibility matrix between key count kinds
  const testKinds = ["GENERIC_COUNT", "COUNT_ORDER", "COUNT_VEHICLE", "COUNT_TICKET", "COUNT_SEAT", "COUNT_PERSON"];
  console.log("\n--- NOUN COMPATIBILITY MATRIX ---");
  const header = "               " + testKinds.map(k => k.replace("COUNT_", "").padEnd(10)).join(" ");
  console.log(header);
  for (const k1 of testKinds) {
    const row = k1.replace("COUNT_", "").padEnd(15) + testKinds.map(k2 => (areUnitKindsCompatible(k1, k2) ? "MATCH" : "DIFF ").padEnd(10)).join(" ");
    console.log(row);
  }
  console.log("---------------------------------\n");

  // Case 1: Source "10.000 xe" vs Model "10.000 đơn" -> must be FLAGGED
  const srcXe = [makeArticle("Đã phân phối 10.000 xe ra thị trường.")];
  const evtDon = makeEvent({
    core_verdict: "Doanh nghiệp ghi nhận 10.000 đơn mới.",
    source_indices: [1]
  });
  const res1 = verifyEventNumbers(evtDon, srcXe, []);
  assert.equal(res1.number_check.not_found.length, 1, "source 10.000 xe vs model 10.000 đơn must be FLAGGED");

  // Case 2: Source "10.000 đơn hàng" vs Model "10.000 đơn" -> ACCEPTED
  const srcDonHang = [makeArticle("Hệ thống xử lý 10.000 đơn hàng.")];
  const res2 = verifyEventNumbers(evtDon, srcDonHang, []);
  assert.equal(res2.number_check.not_found.length, 0, "source 10.000 đơn hàng vs model 10.000 đơn must be ACCEPTED");

  // Case 3: Source "10.000" (no noun) vs Model "10.000 đơn" -> ACCEPTED
  const srcNoNoun = [makeArticle("Số lượng đạt 10.000 trong đợt đầu.")];
  const res3 = verifyEventNumbers(evtDon, srcNoNoun, []);
  assert.equal(res3.number_check.not_found.length, 0, "source 10.000 (no noun) vs model 10.000 đơn must be ACCEPTED");
});

// -----------------------------------------------------------------------------
// Test 25: Randomized accidental-match test with 2000 numbers (Sub-item A.4)
// -----------------------------------------------------------------------------
test("number_check 25: randomized accidental-match false-accept rate is below 2%", () => {
  const sourceSnippets = [
    "Dự án A có vốn 12 tỷ đồng.",
    "Dự án B có vốn 45,5 tỷ đồng.",
    "Dự án C quy mô 100 tỷ đồng.",
    "Dự án D đầu tư 250 tỷ đồng.",
    "Dự án E giải ngân 500 tỷ đồng.",
    "Dự án F đạt 1.200 tỷ đồng.",
    "Dự án G có ngân sách 3.500 tỷ đồng.",
    "Dự án H đạt mốc 7.300 tỷ đồng.",
    "Dự án I trị giá 15.000 tỷ đồng.",
    "Dự án K cán mốc 50.000 tỷ đồng."
  ];

  const sourceNumbers = [];
  for (const s of sourceSnippets) {
    sourceNumbers.push(...extractNumbers(s, "source").extracted);
  }

  // Pre-calculate all source and derivable values to ensure generated numbers are not in source
  const excludedValues = new Set();
  for (const sn of sourceNumbers) {
    for (const c of sn.candidates) excludedValues.add(c);
  }
  for (let i = 0; i < sourceNumbers.length; i++) {
    for (let j = i + 1; j < sourceNumbers.length; j++) {
      const a = sourceNumbers[i].candidates[0];
      const b = sourceNumbers[j].candidates[0];
      excludedValues.add(a + b);
      excludedValues.add(Math.abs(a - b));
      if (b > 0) excludedValues.add(a / b);
      if (a > 0) excludedValues.add(b / a);
      if (a > 0) excludedValues.add((Math.abs(a - b) / a) * 100);
      if (b > 0) excludedValues.add((Math.abs(a - b) / b) * 100);
    }
  }

  // Seeded reproducible pseudo-random generator (LCG)
  let seed = 20261110;
  function lcg() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  let testedCount = 0;
  let falseAccepts = 0;
  const decimalsOptions = [0, 1, 2];

  while (testedCount < 2000) {
    const dec = decimalsOptions[Math.floor(lcg() * decimalsOptions.length)];
    const rawVal = (lcg() * 59999 + 1).toFixed(dec);
    const num = parseFloat(rawVal);
    const canonical = num * 1e9;

    let isExcluded = false;
    for (const ex of excludedValues) {
      if (Math.abs(canonical - ex) < 1e-4) {
        isExcluded = true;
        break;
      }
    }
    if (isExcluded) continue;

    const targetText = rawVal.replace(".", ",") + " tỷ đồng";
    const target = extractNumbers(targetText, "target").extracted[0];
    if (!target) continue;

    const direct = checkDirectMatch(target, sourceNumbers);
    const derived = checkDerivedMatch(target, sourceNumbers);

    if (direct.match || derived.derived) {
      falseAccepts++;
    }
    testedCount++;
  }

  const falseAcceptRate = (falseAccepts / 2000) * 100;
  console.log(`\nAccidental-match test: ${falseAccepts} / 2000 false accepts (${falseAcceptRate.toFixed(3)}%)`);
  assert.ok(falseAcceptRate < 2.0, `False accept rate (${falseAcceptRate.toFixed(3)}%) must be strictly below 2%`);
});

// -----------------------------------------------------------------------------
// Test 26: Performance & timing on 20,000-char inputs (Sub-item D.1)
// -----------------------------------------------------------------------------
test("number_check 26: 20000-char strings finish within 200 ms each", () => {
  // Input 1: 20,000-character string of repeated "1.1.1."
  const pattern20k = "1.1.1.".repeat(3334).slice(0, 20000);
  const t0 = performance.now();
  extractNumbers(pattern20k, "bench_pattern");
  const elapsed1 = performance.now() - t0;
  console.log(`\nTiming Test 1 (20k repeated '1.1.1.'): ${elapsed1.toFixed(2)} ms`);
  assert.ok(elapsed1 < 200, `Repeated pattern timing (${elapsed1.toFixed(2)} ms) must be < 200 ms`);

  // Input 2: 20,000-character string made of digits and separators
  const chars = "0123456789., -%  ";
  let randomSepStr = "";
  let s = 12345;
  for (let i = 0; i < 20000; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    randomSepStr += chars[s % chars.length];
  }
  const t1 = performance.now();
  extractNumbers(randomSepStr, "bench_separators");
  const elapsed2 = performance.now() - t1;
  console.log(`Timing Test 2 (20k digits and separators): ${elapsed2.toFixed(2)} ms`);
  assert.ok(elapsed2 < 200, `Separators timing (${elapsed2.toFixed(2)} ms) must be < 200 ms`);
});

// -----------------------------------------------------------------------------
// Test 27: Fuzz inputs list and never-throws robustness (Sub-item D.2)
// -----------------------------------------------------------------------------
test("number_check 27: full list of fuzz inputs handled cleanly without throwing", () => {
  const fuzzInputs = [
    null,
    undefined,
    "",
    "   ",
    {},
    [],
    12345,
    true,
    false,
    NaN,
    Infinity,
    -Infinity,
    ".....,,,,,-----",
    "--- ARTICLE [NaN] ---",
    "<script>alert('xss')</script>",
    "🔥🚀 100 triệu USD 🤖📊",
    "\u0000\u0007\u001b\n\r\t",
    "$$$$%%%%€€€€",
    "Số liệu: 1,2,3,4,5,6,7,8,9,0",
    "9".repeat(5000),
    "1.000.000.000.000.000.000.000.000",
    "1,000,000,000,000,000,000,000,000",
    "0/0",
    "-0.00000001%",
    "Special: \uFFFF\uD83D\uDE00\uFEFF",
    { overview: null, events: null },
    { overview: 12345, events: "not an array" },
    { overview: "Valid", events: [null, undefined, 42, "string", {}, { title: null }] }
  ];

  console.log("\n--- FUZZ INPUTS LIST (" + fuzzInputs.length + " cases) ---");
  fuzzInputs.forEach((inp, idx) => {
    let display = typeof inp === "string" && inp.length > 30 ? inp.slice(0, 30) + "..." : JSON.stringify(inp);
    console.log(`Fuzz [${idx + 1}/${fuzzInputs.length}]: ${display}`);
  });
  console.log("----------------------------------------------------------\n");

  for (const inp of fuzzInputs) {
    assert.doesNotThrow(() => cleanText(inp));
    assert.doesNotThrow(() => extractNumbers(inp, "fuzz"));
    assert.doesNotThrow(() => checkDigestNumbers(inp, [], []));
  }
});
