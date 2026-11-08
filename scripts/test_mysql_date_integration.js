const { pool, closePool } = require("../lib/db");
const { getRecentSentEvents, formatVietnamDate } = require("../lib/db_operations");

async function runDateIntegrationTest() {
  console.log("=== KIỂM TRA THỰC TẾ XỬ LÝ DATE VỚI MYSQL CONTAINER ===");

  // a) Pool configuration
  console.log("\n[1] Cấu hình mysql2 pool:");
  console.log(" - timezone:", pool.pool?.config?.connectionConfig?.timezone || "chưa đặt");
  console.log(" - dateStrings:", pool.pool?.config?.connectionConfig?.dateStrings || false);

  const testTopic = "test_date_topic_" + Date.now();
  const testChatId = 999999000;
  const knownDate = "2026-11-08";

  let subId = null;
  let digestId = null;

  try {
    // Tạo subscription tạm thời để thỏa mãn Foreign Key fk_digest_subscription
    const [subResult] = await pool.query(
      `INSERT INTO subscriptions (chat_id, topic, delivery_hour, is_active)
       VALUES (?, ?, 8, 1)`,
      [testChatId, testTopic]
    );
    subId = subResult.insertId;

    // Chèn dòng vào shift_digests với delivery_date = knownDate
    const [digestResult] = await pool.query(
      `INSERT INTO shift_digests (subscription_id, chat_id, topic, delivery_date, delivery_hour, summary_json, is_sent)
       VALUES (?, ?, ?, ?, 8, ?, 1)`,
      [
        subId,
        testChatId,
        testTopic,
        knownDate,
        JSON.stringify({
          events: [
            {
              title: "Sự kiện kiểm tra ngày tháng thực tế",
              core_verdict: "Kiểm tra parsing delivery_date từ MySQL container"
            }
          ]
        })
      ]
    );
    digestId = digestResult.insertId;
    console.log(`\n[2] Đã chèn dữ liệu mẫu thành công:`);
    console.log(` - delivery_date đưa vào: "${knownDate}"`);
    console.log(` - subscription_id: ${subId}, digest_id: ${digestId}`);

    // Truy vấn thô bằng SELECT delivery_date
    const [rawRows] = await pool.query(
      `SELECT delivery_date FROM shift_digests WHERE id = ?`,
      [digestId]
    );
    const rawVal = rawRows[0].delivery_date;
    console.log("\n[3] Giá trị thô (Raw Value) mà mysql2 trả về:");
    console.log(" - typeof rawVal:", typeof rawVal);
    console.log(" - rawVal instanceof Date:", rawVal instanceof Date);
    console.log(" - rawVal.toString():", rawVal.toString());
    if (rawVal instanceof Date) {
      console.log(" - rawVal.toISOString():", rawVal.toISOString());
      console.log(" - rawVal.toUTCString():", rawVal.toUTCString());
      console.log(" - rawVal.getFullYear():", rawVal.getFullYear(), "getMonth():", rawVal.getMonth() + 1, "getDate():", rawVal.getDate());
      console.log(" - rawVal.getUTCFullYear():", rawVal.getUTCFullYear(), "getUTCMonth():", rawVal.getUTCMonth() + 1, "getUTCDate():", rawVal.getUTCDate());
    }

    // Đọc thông qua chính code path getRecentSentEvents
    console.log("\n[4] Đọc lại qua code path chính getRecentSentEvents:");
    const recentEvents = await getRecentSentEvents(testTopic, 5, 7);
    console.log(" - Số sự kiện lấy được:", recentEvents.length);
    console.log(" - Kết quả trả về:", JSON.stringify(recentEvents, null, 2));

    const formattedDate = recentEvents[0]?.date;
    console.log(` - Ngày định dạng: "${formattedDate}" (Kỳ vọng: "${knownDate}")`);

    const isMatch = formattedDate === knownDate;
    console.log(`\n=> KẾT QUẢ ĐỐI SOÁT: ${isMatch ? "✅ KHỚP CHÍNH XÁC (Trùng khớp ngày)" : "❌ BỊ LỆCH NGÀY"}`);

    return {
      knownDate,
      rawType: typeof rawVal,
      isDate: rawVal instanceof Date,
      rawString: String(rawVal),
      formattedDate,
      isMatch
    };
  } finally {
    // Dọn dẹp dữ liệu kiểm thử
    if (digestId) {
      await pool.query(`DELETE FROM shift_digests WHERE id = ?`, [digestId]).catch(() => {});
    }
    if (subId) {
      await pool.query(`DELETE FROM subscriptions WHERE id = ?`, [subId]).catch(() => {});
    }
    await closePool();
    console.log("\n[5] Đã dọn dẹp dữ liệu test khỏi MySQL an toàn.");
  }
}

runDateIntegrationTest().catch((err) => {
  console.error("Lỗi khi chạy integration test:", err);
  process.exit(1);
});
