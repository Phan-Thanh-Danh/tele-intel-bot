const test = require("node:test");
const assert = require("node:assert");
const { pool, closePool } = require("../lib/db");
const {
  formatVietnamDate,
  recordLlmRequest,
  checkLlmBudget,
  getRecentSentEvents,
  getPendingDigests
} = require("../lib/db_operations");

test("DATE handling: specific_date is returned as string YYYY-MM-DD from MySQL", async (t) => {
  const testChatId = 988811001;
  const testTopic = "__test___specific_date_" + Date.now();
  const knownDate = "2026-11-08";
  let subId = null;

  try {
    // 1. Chèn subscription với schedule_type = specific_date
    const [insertResult] = await pool.query(
      `INSERT INTO subscriptions (chat_id, topic, schedule_type, specific_date, delivery_hour, is_active)
       VALUES (?, ?, 'specific_date', ?, 9, 1)`,
      [testChatId, testTopic, knownDate]
    );
    subId = insertResult.insertId;

    // 2. Đọc lại từ MySQL
    const [rows] = await pool.query(
      `SELECT id, specific_date, schedule_type FROM subscriptions WHERE id = ?`,
      [subId]
    );
    assert.strictEqual(rows.length, 1);
    const sub = rows[0];

    // Kiểm tra kiểu dữ liệu và giá trị thô
    assert.strictEqual(typeof sub.specific_date, "string");
    assert.strictEqual(sub.specific_date, knownDate);

    // Kiểm tra qua formatVietnamDate
    const formatted = formatVietnamDate(sub.specific_date);
    assert.strictEqual(formatted, knownDate);

    // Kiểm tra logic so sánh ngày trong index.js
    const isToday = formatted === "2026-11-08";
    assert.strictEqual(isToday, true);
  } finally {
    if (subId) {
      await pool.query("DELETE FROM subscriptions WHERE id = ? AND topic LIKE '__test__%'", [subId]).catch(() => {});
    }
  }
});

test("DATE handling: shift_digests.delivery_date works cleanly with queries and formatting", async (t) => {
  const testChatId = 988811002;
  const testTopic = "__test___digest_date_" + Date.now();
  const knownDate = "2026-11-08";
  let subId = null;
  let digestId = null;

  try {
    const [subResult] = await pool.query(
      `INSERT INTO subscriptions (chat_id, topic, delivery_hour, is_active)
       VALUES (?, ?, 10, 1)`,
      [testChatId, testTopic]
    );
    subId = subResult.insertId;

    const [digestResult] = await pool.query(
      `INSERT INTO shift_digests (subscription_id, chat_id, topic, delivery_date, delivery_hour, summary_json, is_sent)
       VALUES (?, ?, ?, ?, 10, ?, 1)`,
      [
        subId,
        testChatId,
        testTopic,
        knownDate,
        JSON.stringify({ events: [{ title: "Test Event Date", core_verdict: "Check" }] })
      ]
    );
    digestId = digestResult.insertId;

    // Đọc qua getRecentSentEvents
    const recent = await getRecentSentEvents(testTopic, 5, 7);
    assert.strictEqual(recent.length, 1);
    assert.strictEqual(recent[0].date, knownDate);
    assert.strictEqual(recent[0].title, "Test Event Date");

    // Đọc thô qua SELECT
    const [rawRows] = await pool.query(
      `SELECT delivery_date FROM shift_digests WHERE id = ?`,
      [digestId]
    );
    assert.strictEqual(typeof rawRows[0].delivery_date, "string");
    assert.strictEqual(rawRows[0].delivery_date, knownDate);
  } finally {
    if (digestId) {
      await pool.query("DELETE FROM shift_digests WHERE id = ? AND topic LIKE '__test__%'", [digestId]).catch(() => {});
    }
    if (subId) {
      await pool.query("DELETE FROM subscriptions WHERE id = ? AND topic LIKE '__test__%'", [subId]).catch(() => {});
    }
  }
});

test("DATE handling: llm_daily_usage.usage_date records and reads accurately", async (t) => {
  // Ghi nhận 1 request kiểu scheduled
  const budget = await checkLlmBudget("scheduled");
  const recordResult = await recordLlmRequest("scheduled");
  assert.ok(recordResult.requestCount >= 1);

  // Đọc trực tiếp từ bảng llm_daily_usage
  const todayVietnam = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const [rows] = await pool.query(
    "SELECT usage_date, request_count, scheduled_count FROM llm_daily_usage WHERE usage_date = ?",
    [todayVietnam]
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(typeof rows[0].usage_date, "string");
  assert.strictEqual(rows[0].usage_date, todayVietnam);
  assert.ok(rows[0].request_count >= 1);
  assert.ok(rows[0].scheduled_count >= 1);
});

test.after(async () => {
  await closePool();
});
