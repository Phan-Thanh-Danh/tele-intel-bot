const test = require("node:test");
const assert = require("node:assert");
const { t, getLanguageName, SUPPORTED_LANGUAGES } = require("../lib/i18n");

test("i18n: Supported languages list contains expected 9 languages", () => {
  const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
  assert.ok(codes.includes("en"));
  assert.ok(codes.includes("vi"));
  assert.ok(codes.includes("ja"));
  assert.ok(codes.includes("zh"));
  assert.ok(codes.includes("ko"));
  assert.ok(codes.includes("de"));
  assert.ok(codes.includes("fr"));
  assert.ok(codes.includes("ru"));
  assert.ok(codes.includes("es"));
  assert.strictEqual(SUPPORTED_LANGUAGES.length, 9);
});

test("i18n: Translations return correct text for given language code", () => {
  const enBtn = t("en", "btn_instant");
  const viBtn = t("vi", "btn_instant");
  const jaBtn = t("ja", "btn_instant");

  assert.strictEqual(enBtn, "⚡ Instant Intel");
  assert.strictEqual(viBtn, "⚡ Cào tức thì");
  assert.strictEqual(jaBtn, "⚡ 即時インテル");
});

test("i18n: Interpolation replaces placeholder variables correctly", () => {
  const header = t("en", "report_instant_header", { topic: "AI", page: 1, total: 2 });
  assert.strictEqual(header, "⚡ <b>INSTANT INTEL: AI</b> (1/2)");
});

test("i18n: getLanguageName returns correct full names", () => {
  assert.strictEqual(getLanguageName("en"), "English");
  assert.strictEqual(getLanguageName("vi"), "Vietnamese");
  assert.strictEqual(getLanguageName("ja"), "Japanese");
  assert.strictEqual(getLanguageName("unknown"), "English");
});
