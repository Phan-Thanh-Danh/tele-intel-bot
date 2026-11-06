const { pool } = require("./db");

/**
 * Initializes the required database tables if they do not exist.
 * @returns {Promise<void>}
 */
async function initDatabaseSchema() {
  const createSubscriptionsTable = `
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      topic VARCHAR(255) NOT NULL,
      prompt_guidance TEXT NULL,
      schedule_type ENUM('recurring', 'specific_date') NOT NULL DEFAULT 'recurring',
      days_of_week VARCHAR(50) NOT NULL DEFAULT '1,2,3,4,5,6,7',
      specific_date DATE NULL,
      delivery_hour TINYINT UNSIGNED NOT NULL,
      last_delivered_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_active_schedule (is_active, delivery_hour, schedule_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  const createRawArticlesTable = `
    CREATE TABLE IF NOT EXISTS raw_articles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      topic VARCHAR(255) NOT NULL,
      title VARCHAR(500) NOT NULL,
      link VARCHAR(767) NOT NULL,
      source VARCHAR(100) NULL,
      pub_date DATETIME NOT NULL,
      content_snippet TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_topic_link (topic, link),
      INDEX idx_topic_pubdate (topic, pub_date),
      INDEX idx_retention_cleanup (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  const createShiftDigestsTable = `
    CREATE TABLE IF NOT EXISTS shift_digests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      subscription_id INT NOT NULL,
      chat_id BIGINT NOT NULL,
      topic VARCHAR(255) NOT NULL,
      delivery_date DATE NOT NULL,
      delivery_hour TINYINT UNSIGNED NOT NULL,
      summary_json MEDIUMTEXT NOT NULL,
      is_sent TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sub_delivery (subscription_id, delivery_date, delivery_hour),
      INDEX idx_dispatch_lookup (delivery_date, delivery_hour, is_sent),
      CONSTRAINT fk_digest_subscription
        FOREIGN KEY (subscription_id)
        REFERENCES subscriptions(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await pool.query(createSubscriptionsTable);
  await pool.query(createRawArticlesTable);
  await pool.query(createShiftDigestsTable);
}

// ============================================================================
// Subscriptions Queries
// ============================================================================

/**
 * Creates a new subscription.
 * @param {Object} params
 * @returns {Promise<number>} Inserted subscription ID
 */
async function createSubscription({
  chatId,
  topic,
  promptGuidance = null,
  scheduleType = "recurring",
  daysOfWeek = "1,2,3,4,5,6,7",
  specificDate = null,
  deliveryHour
}) {
  const normalizedTopic = topic.trim().toLowerCase();
  const [result] = await pool.query(
    `INSERT INTO subscriptions 
      (chat_id, topic, prompt_guidance, schedule_type, days_of_week, specific_date, delivery_hour, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      chatId,
      normalizedTopic,
      promptGuidance,
      scheduleType,
      daysOfWeek,
      specificDate,
      deliveryHour
    ]
  );
  return result.insertId;
}

/**
 * Fetches all distinct topics from active subscriptions.
 * @returns {Promise<string[]>}
 */
async function getDistinctActiveTopics() {
  const [rows] = await pool.query(
    "SELECT DISTINCT topic FROM subscriptions WHERE is_active = 1"
  );
  return rows.map((r) => r.topic);
}

/**
 * Retrieves active subscriptions targeting a specific shift delivery hour.
 * @param {number} deliveryHour
 * @returns {Promise<Array>}
 */
async function getSubscriptionsByHour(deliveryHour) {
  const [rows] = await pool.query(
    `SELECT 
      id, 
      chat_id, 
      topic, 
      prompt_guidance, 
      schedule_type, 
      days_of_week, 
      specific_date, 
      last_delivered_at
    FROM subscriptions
    WHERE is_active = 1 
      AND delivery_hour = ?`,
    [deliveryHour]
  );
  return rows;
}

/**
 * Fetches all subscriptions for an admin chat id.
 * @param {string|number} chatId
 * @returns {Promise<Array>}
 */
async function getAllSubscriptions(chatId) {
  const [rows] = await pool.query(
    `SELECT 
      id, 
      topic, 
      prompt_guidance, 
      schedule_type, 
      days_of_week, 
      specific_date, 
      delivery_hour, 
      is_active, 
      last_delivered_at, 
      created_at
    FROM subscriptions
    WHERE chat_id = ?
    ORDER BY id DESC`,
    [chatId]
  );
  return rows;
}

/**
 * Fetches a single subscription by ID.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getSubscriptionById(id) {
  const [rows] = await pool.query(
    `SELECT 
      id, 
      chat_id, 
      topic, 
      prompt_guidance, 
      schedule_type, 
      days_of_week, 
      specific_date, 
      delivery_hour, 
      is_active, 
      last_delivered_at
    FROM subscriptions
    WHERE id = ?`,
    [id]
  );
  if (rows.length === 0) return null;
  return rows[0];
}

/**
 * Toggles the active status of a subscription.
 * @param {number} id
 * @param {boolean} isActive
 * @returns {Promise<void>}
 */
async function toggleSubscriptionStatus(id, isActive) {
  await pool.query(
    "UPDATE subscriptions SET is_active = ? WHERE id = ?",
    [isActive ? 1 : 0, id]
  );
}

/**
 * Deletes a subscription and its cascading shift digests.
 * @param {number} id
 * @returns {Promise<void>}
 */
async function deleteSubscription(id) {
  await pool.query("DELETE FROM subscriptions WHERE id = ?", [id]);
}

/**
 * Auto-deactivates one-time specific date subscriptions.
 * @param {number} id
 * @returns {Promise<void>}
 */
async function deactivateSpecificDateSubscription(id) {
  await pool.query(
    "UPDATE subscriptions SET is_active = 0 WHERE id = ? AND schedule_type = 'specific_date'",
    [id]
  );
}

// ============================================================================
// Raw Articles Queries
// ============================================================================

/**
 * Inserts raw articles into raw_articles using INSERT IGNORE.
 * Duplicate (topic, link) entries are silently ignored.
 * @param {Array<{topic: string, title: string, link: string, source: string, pubDate: string|Date, contentSnippet: string}>} articles
 * @returns {Promise<number>} Number of rows inserted
 */
async function insertRawArticles(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return 0;
  }

  let insertedCount = 0;
  for (const item of articles) {
    const [result] = await pool.query(
      `INSERT IGNORE INTO raw_articles 
        (topic, title, link, source, pub_date, content_snippet)
       VALUES 
        (?, ?, ?, ?, ?, ?)`,
      [
        item.topic,
        item.title,
        item.link,
        item.source || null,
        item.pubDate,
        item.contentSnippet || null
      ]
    );
    if (result.affectedRows > 0) {
      insertedCount += result.affectedRows;
    }
  }

  return insertedCount;
}

/**
 * Fetches recent unconsumed articles for a topic since last delivery watermark.
 * @param {string} topic
 * @param {Date|string|null} lastDeliveredAt
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getArticlesForTopicSince(topic, lastDeliveredAt = null, limit = 30) {
  const [rows] = await pool.query(
    `SELECT 
      id, 
      title, 
      link, 
      source, 
      content_snippet, 
      pub_date
    FROM raw_articles
    WHERE topic = ?
      AND pub_date > COALESCE(?, NOW() - INTERVAL 24 HOUR)
    ORDER BY pub_date DESC
    LIMIT ?`,
    [topic, lastDeliveredAt, limit]
  );
  return rows;
}

/**
 * Deletes articles older than retention period (default 3 days).
 * @param {number} days
 * @returns {Promise<number>} Number of deleted rows
 */
async function deleteStaleArticles(days = 3) {
  const [result] = await pool.query(
    "DELETE FROM raw_articles WHERE created_at < NOW() - INTERVAL ? DAY",
    [days]
  );
  return result.affectedRows;
}

// ============================================================================
// Shift Digests Queries
// ============================================================================

/**
 * Upserts a pre-synthesized JSON digest payload for an upcoming shift.
 * @param {Object} params
 * @returns {Promise<void>}
 */
async function upsertShiftDigest({
  subscriptionId,
  chatId,
  topic,
  deliveryDate,
  deliveryHour,
  summaryJson
}) {
  await pool.query(
    `INSERT INTO shift_digests 
      (subscription_id, chat_id, topic, delivery_date, delivery_hour, summary_json, is_sent)
     VALUES 
      (?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE 
      summary_json = VALUES(summary_json),
      is_sent = 0,
      created_at = CURRENT_TIMESTAMP`,
    [
      subscriptionId,
      chatId,
      topic,
      deliveryDate,
      deliveryHour,
      typeof summaryJson === "string" ? summaryJson : JSON.stringify(summaryJson)
    ]
  );
}

/**
 * Queries pending unsent digests for today within the catch-up latency window.
 * @param {string} deliveryDate - YYYY-MM-DD
 * @param {number} currentHour - H
 * @param {number} floorHour - max(0, H - 2)
 * @returns {Promise<Array>}
 */
async function getPendingDigests(deliveryDate, currentHour, floorHour) {
  const [rows] = await pool.query(
    `SELECT 
      id, 
      subscription_id, 
      chat_id, 
      topic, 
      delivery_hour, 
      summary_json
    FROM shift_digests
    WHERE delivery_date = ?
      AND delivery_hour <= ?
      AND delivery_hour >= ?
      AND is_sent = 0
    ORDER BY delivery_hour ASC, id ASC`,
    [deliveryDate, currentHour, floorHour]
  );
  return rows;
}

/**
 * Marks a digest as sent and updates subscription last_delivered_at within an atomic transaction.
 * Always releases connection back to pool in a finally block.
 * @param {number} digestId
 * @param {number} subscriptionId
 * @returns {Promise<void>}
 */
async function markDigestSentWithTransaction(digestId, subscriptionId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE shift_digests SET is_sent = 1 WHERE id = ?",
      [digestId]
    );
    await connection.query(
      "UPDATE subscriptions SET last_delivered_at = NOW() WHERE id = ?",
      [subscriptionId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  initDatabaseSchema,
  createSubscription,
  getDistinctActiveTopics,
  getSubscriptionsByHour,
  getAllSubscriptions,
  getSubscriptionById,
  toggleSubscriptionStatus,
  deleteSubscription,
  deactivateSpecificDateSubscription,
  insertRawArticles,
  getArticlesForTopicSince,
  deleteStaleArticles,
  upsertShiftDigest,
  getPendingDigests,
  markDigestSentWithTransaction
};
