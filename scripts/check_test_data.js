const { pool } = require("../lib/db");

async function checkData() {
  try {
    const [subRows] = await pool.query(
      "SELECT id, chat_id, topic, schedule_type, specific_date, created_at FROM subscriptions WHERE topic LIKE '__test__%' OR chat_id LIKE '999999%'"
    );
    console.log("LEFTOVER_SUBSCRIPTIONS_COUNT=" + subRows.length);
    for (const r of subRows) {
      console.log(`SUB: id=${r.id}, chat_id=${r.chat_id}, topic=${r.topic}, specific_date=${r.specific_date}`);
    }

    const [digestRows] = await pool.query(
      "SELECT id, subscription_id, chat_id, topic, delivery_hour, delivery_date, created_at FROM shift_digests WHERE topic LIKE '__test__%' OR topic = 'Việt Nam Công nghệ & Công nghiệp'"
    );
    console.log("LEFTOVER_DIGESTS_COUNT=" + digestRows.length);
    for (const r of digestRows) {
      console.log(`DIGEST: id=${r.id}, sub_id=${r.subscription_id}, chat_id=${r.chat_id}, topic=${r.topic}, delivery_date=${r.delivery_date}`);
    }

    const [allTestDigests] = await pool.query(
      "SELECT id, topic, delivery_date, created_at FROM shift_digests WHERE topic LIKE '%test%' OR topic LIKE '%Test%'"
    );
    console.log("ALL_TEST_DIGESTS_COUNT=" + allTestDigests.length);

    const [usageRows] = await pool.query(
      "SELECT * FROM llm_daily_usage WHERE usage_date = '2026-11-08'"
    );
    console.log("LLM_USAGE_2026_11_08:", JSON.stringify(usageRows));

    const [allUsageRows] = await pool.query("SELECT * FROM llm_daily_usage");
    console.log("ALL_LLM_USAGE:", JSON.stringify(allUsageRows));
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await pool.end();
  }
}

checkData();
