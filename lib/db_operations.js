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
      link VARCHAR(500) NOT NULL,
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

  const createEventLedgerTable = `
    CREATE TABLE IF NOT EXISTS event_ledger (
      id INT AUTO_INCREMENT PRIMARY KEY,
      topic VARCHAR(255) NOT NULL,
      entity_key VARCHAR(100) NOT NULL,
      current_state TEXT NOT NULL,
      last_event_date DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_topic_entity (topic, entity_key),
      INDEX idx_topic (topic)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  const createSourceReputationTable = `
    CREATE TABLE IF NOT EXISTS source_reputation (
      id INT AUTO_INCREMENT PRIMARY KEY,
      domain VARCHAR(255) NOT NULL UNIQUE,
      trust_score INT NOT NULL DEFAULT 100,
      verified_reports_count INT NOT NULL DEFAULT 0,
      false_reports_count INT NOT NULL DEFAULT 0,
      current_tier TINYINT NOT NULL DEFAULT 2,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_domain_trust (domain, trust_score)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  const createFeedbackLogsTable = `
    CREATE TABLE IF NOT EXISTS feedback_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      event_key VARCHAR(255) NOT NULL,
      domain VARCHAR(255) NOT NULL,
      feedback_type ENUM('CONFIRMED', 'DISPUTED') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_feedback_domain (domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  const createUserSettingsTable = `
    CREATE TABLE IF NOT EXISTS user_settings (
      chat_id BIGINT PRIMARY KEY,
      language_code VARCHAR(10) NOT NULL DEFAULT 'en',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await pool.query(createSubscriptionsTable);
  await pool.query(createRawArticlesTable);
  await pool.query(createShiftDigestsTable);
  await pool.query(createEventLedgerTable);
  await pool.query(createSourceReputationTable);
  await pool.query(createFeedbackLogsTable);
  await pool.query(createUserSettingsTable);
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

// ============================================================================
// Event Ledger (Timeline & State Tracking for Delta Updates)
// ============================================================================

/**
 * Retrieves past states and timeline for a given topic.
 * @param {string} topic
 * @param {number} limit
 * @returns {Promise<Array<{entity_key: string, current_state: string, last_event_date: string, updated_at: string}>>}
 */
async function getTopicHistory(topic, limit = 10) {
  const normalizedTopic = (topic || "").trim().toLowerCase();
  const [rows] = await pool.query(
    "SELECT entity_key, current_state, last_event_date, updated_at FROM event_ledger WHERE topic = ? ORDER BY updated_at DESC LIMIT ?",
    [normalizedTopic, limit]
  );
  return rows;
}

/**
 * Upserts a known state/timeline checkpoint for an entity under a topic.
 * @param {string} topic
 * @param {string} entityKey
 * @param {string} currentState
 * @param {Date|string|null} lastEventDate
 * @returns {Promise<void>}
 */
async function upsertTopicState(topic, entityKey, currentState, lastEventDate = null) {
  const normalizedTopic = (topic || "").trim().toLowerCase();
  const normalizedKey = (entityKey || "general").trim().slice(0, 100);
  const stateText = (currentState || "").trim();
  const eventDate = lastEventDate ? new Date(lastEventDate) : new Date();

  await pool.query(
    `INSERT INTO event_ledger (topic, entity_key, current_state, last_event_date)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       current_state = VALUES(current_state),
       last_event_date = VALUES(last_event_date),
       updated_at = NOW()`,
    [normalizedTopic, normalizedKey, stateText, eventDate]
  );
}

// ============================================================================
// Source Reputation & Feedback Loop (Layer 11)
// ============================================================================

/**
 * Records user feedback (Confirmed vs Disputed) for a source domain.
 * Dynamically adjusts domain trust score and auto-downgrades tier if score falls below 70.
 * @param {number|string} chatId
 * @param {string} eventKey
 * @param {string} domain
 * @param {"CONFIRMED"|"DISPUTED"} feedbackType
 * @returns {Promise<{domain: string, trust_score: number, current_tier: number}>}
 */
async function recordSourceFeedback(chatId, eventKey, domain, feedbackType) {
  const normDomain = (domain || "unknown").toLowerCase().replace(/^www\./, "").trim();
  const normKey = (eventKey || "general").slice(0, 255);
  const type = feedbackType === "DISPUTED" ? "DISPUTED" : "CONFIRMED";

  // 1. Insert feedback log
  await pool.query(
    "INSERT INTO feedback_logs (chat_id, event_key, domain, feedback_type) VALUES (?, ?, ?, ?)",
    [chatId, normKey, normDomain, type]
  );

  // 2. Adjust reputation score
  const scoreDelta = type === "CONFIRMED" ? 1 : -5;
  const verifiedDelta = type === "CONFIRMED" ? 1 : 0;
  const falseDelta = type === "DISPUTED" ? 1 : 0;

  await pool.query(
    `INSERT INTO source_reputation (domain, trust_score, verified_reports_count, false_reports_count, current_tier)
     VALUES (?, 100 + ?, ?, ?, IF(100 + ? < 70, 3, 2))
     ON DUPLICATE KEY UPDATE
       trust_score = GREATEST(20, LEAST(150, trust_score + ?)),
       verified_reports_count = verified_reports_count + ?,
       false_reports_count = false_reports_count + ?,
       current_tier = IF(trust_score < 70, 3, current_tier),
       updated_at = NOW()`,
    [
      normDomain, scoreDelta, verifiedDelta, falseDelta, scoreDelta,
      scoreDelta, verifiedDelta, falseDelta
    ]
  );

  const [rows] = await pool.query(
    "SELECT domain, trust_score, current_tier FROM source_reputation WHERE domain = ?",
    [normDomain]
  );
  return rows[0] || { domain: normDomain, trust_score: 100, current_tier: 2 };
}

/**
 * Gets the current trust score and tier for a domain.
 * @param {string} domain
 * @returns {Promise<{trust_score: number, current_tier: number}|null>}
 */
async function getDomainTrustScore(domain) {
  const normDomain = (domain || "").toLowerCase().replace(/^www\./, "").trim();
  const [rows] = await pool.query(
    "SELECT trust_score, current_tier FROM source_reputation WHERE domain = ?",
    [normDomain]
  );
  return rows[0] || null;
}

/**
 * Gets the user's preferred language code from user_settings.
 * Returns null if the user has not selected a language yet.
 * @param {number|string} chatId
 * @returns {Promise<string|null>}
 */
async function getUserLanguage(chatId) {
  const [rows] = await pool.query(
    "SELECT language_code FROM user_settings WHERE chat_id = ?",
    [chatId]
  );
  return rows[0]?.language_code || null;
}

/**
 * Saves or updates user language preference.
 * @param {number|string} chatId
 * @param {string} langCode
 * @returns {Promise<void>}
 */
async function setUserLanguage(chatId, langCode) {
  const code = (langCode || "en").toLowerCase().trim().slice(0, 10);
  await pool.query(
    `INSERT INTO user_settings (chat_id, language_code)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE language_code = VALUES(language_code), updated_at = NOW()`,
    [chatId, code]
  );
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
  markDigestSentWithTransaction,
  getTopicHistory,
  upsertTopicState,
  recordSourceFeedback,
  getDomainTrustScore,
  getUserLanguage,
  setUserLanguage
};
