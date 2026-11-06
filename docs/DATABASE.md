# Personal Intelligence & Automation Agent - Database Specification & Query Contract

## 1. Overview & Engine Configuration

The database tier is powered by **MySQL 8.0+** using the `InnoDB` storage engine. All tables and text columns use the `utf8mb4` character set with `utf8mb4_unicode_ci` collation to support international alphabets, technical code tokens, and emojis without truncation.

### Connection & Session Requirements
* **Driver:** `mysql2/promise` with connection pooling (`createPool`).
* **Connection Pool Settings:**
  * `connectionLimit: 10`
  * `waitForConnections: true`
  * `queueLimit: 0`
  * `enableKeepAlive: true` (prevents idle drops on persistent daemons)
* **Timezone Session Enforcement:**
  Every connection initialized by the pool MUST execute:
  ```sql
  SET time_zone = '+07:00';
  ```
  This ensures that MySQL `NOW()` and `CURRENT_TIMESTAMP` operations evaluate relative to Vietnam Standard Time (`Asia/Ho_Chi_Minh`).

---

## 2. Entity-Relationship & Relational Schema

```
┌─────────────────────────────────┐
│          subscriptions          │
├─────────────────────────────────┤
│ id (PK, AI)                     │
│ chat_id                         │
│ topic                           │◄──────────────┐
│ prompt_guidance                 │               │
│ schedule_type                   │               │ (Application-level
│ days_of_week                    │               │  association via topic)
│ specific_date                   │               │
│ delivery_hour                   │               │
│ last_delivered_at               │               │
│ is_active                       │               │
│ created_at                      │               │
└────────────────┬────────────────┘               │
                 │ 1                              │
                 │                                │
                 │ Has Many (Cascade Delete)      │
                 ▼ N                              │
┌─────────────────────────────────┐      ┌────────┴────────────────────────┐
│          shift_digests          │      │          raw_articles           │
├─────────────────────────────────┤      ├─────────────────────────────────┤
│ id (PK, AI)                     │      │ id (PK, AI)                     │
│ subscription_id (FK)           │      │ topic                           │
│ chat_id                         │      │ title                           │
│ topic                           │      │ link (Unique per topic)         │
│ delivery_date                   │      │ source                          │
│ delivery_hour                   │      │ pub_date                        │
│ summary_json                    │      │ content_snippet                 │
│ is_sent                         │      │ created_at                      │
│ created_at                      │      └─────────────────────────────────┘
└─────────────────────────────────┘
```

---

## 3. Data Definition Language (DDL)

```sql
CREATE DATABASE IF NOT EXISTS tele_intel_bot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tele_intel_bot;

-- ============================================================================
-- Table: subscriptions
-- Purpose: Stores active and archived scheduling profiles for the admin user.
-- ============================================================================
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

  -- Constraints & Indexes
  INDEX idx_active_schedule (is_active, delivery_hour, schedule_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- Table: raw_articles
-- Purpose: Ingestion data lake containing unfiltered RSS and API entries.
-- ============================================================================
CREATE TABLE IF NOT EXISTS raw_articles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  topic VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  link VARCHAR(767) NOT NULL,
  source VARCHAR(100) NULL,
  pub_date DATETIME NOT NULL,
  content_snippet TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Constraints & Indexes
  -- Composite Unique Constraint: Same link can belong to different topics,
  -- but cannot duplicate under the same topic.
  UNIQUE KEY uq_topic_link (topic, link),
  INDEX idx_topic_pubdate (topic, pub_date),
  INDEX idx_retention_cleanup (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- Table: shift_digests
-- Purpose: Pre-synthesized JSON intelligence payloads staged for dispatch.
-- ============================================================================
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

  -- Constraints & Indexes
  -- Unique Constraint: Guarantees that synthesizeJob cannot duplicate
  -- a report for the exact same subscription, date, and shift hour.
  UNIQUE KEY uq_sub_delivery (subscription_id, delivery_date, delivery_hour),
  INDEX idx_dispatch_lookup (delivery_date, delivery_hour, is_sent),

  CONSTRAINT fk_digest_subscription
    FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 4. Column Semantics & Design Rules

### 4.1. `subscriptions` Table
* `topic`: Normalized via application runtime using `.trim().toLowerCase()`. Never store raw unformatted user strings to prevent case-sensitivity splits.
* `prompt_guidance`: Optional instruction appended to the Gemini system prompt for this specific topic (e.g., *"Focus on transfer rumors and injury reports"* vs. *"Emphasize throughput benchmarks"*).
* `schedule_type`:
  * `'recurring'`: Evaluates `days_of_week`.
  * `'specific_date'`: Evaluates `specific_date`. When delivered, the application toggles `is_active = 0`.
* `days_of_week`: Comma-separated string of day numbers: `1` (Monday) through `7` (Sunday). Default `'1,2,3,4,5,6,7'` denotes daily delivery.
* `delivery_hour`: Unsigned byte (`0` to `23`) representing the hour of day in Vietnam time (`UTC+7`).
* `last_delivered_at`: Timestamp marking the exact moment the dispatcher successfully completed sending the digest for this topic. Essential for preventing inter-shift duplicate news.

### 4.2. `raw_articles` Table
* `link`: Length `VARCHAR(767)` allows maximum index key length compatibility under `utf8mb4` on standard InnoDB installations.
* `uq_topic_link`: Ensures the scraper can run safely with `INSERT IGNORE`. If an article covers two distinct topics (e.g., "AI" and "Python"), both topics receive the article without collision.
* `pub_date`: Parsed release date normalized to `YYYY-MM-DD HH:MM:SS`.

### 4.3. `shift_digests` Table
* `summary_json`: Stores structured output produced by Gemini conforming to the defined schema. Contains `{ overview: string, events: [...] }`.
* `uq_sub_delivery`: Prevents synthesis race conditions. If `synthesizeJob` runs twice or encounters transient execution delays, it overwrites or skips without creating duplicate notifications.
* `is_sent`: State flag:
  * `0`: Synthesized and queued for broadcast.
  * `1`: Transmitted to Telegram successfully.

---

## 5. Production Query Contract (Used by Application Workers)

### 5.1. Ingestion Pipeline
Executed every 30 minutes to insert newly harvested feed items:
```sql
INSERT IGNORE INTO raw_articles 
  (topic, title, link, source, pub_date, content_snippet)
VALUES 
  (?, ?, ?, ?, ?, ?);
```

---

### 5.2. Pre-Shift Synthesis Pipeline (Running at Hour $H$ for Hour $H+1$)

#### Step 1: Fetch subscriptions targeting the next shift hour
```sql
SELECT 
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
  AND delivery_hour = ?;
```
*(Application filters by current Day of Week or Specific Date match in memory).*

#### Step 2: Fetch unconsumed articles for the target topic
Only retrieves articles newer than the last successful delivery timestamp to prevent repeating earlier shift news:
```sql
SELECT 
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
LIMIT 30;
```

#### Step 3: Upsert the generated digest payload
```sql
INSERT INTO shift_digests 
  (subscription_id, chat_id, topic, delivery_date, delivery_hour, summary_json, is_sent)
VALUES 
  (?, ?, ?, ?, ?, ?, 0)
ON DUPLICATE KEY UPDATE 
  summary_json = VALUES(summary_json),
  is_sent = 0,
  created_at = CURRENT_TIMESTAMP;
```

---

### 5.3. Dispatch Pipeline (Running at Hour $H$)

#### Step 1: Query pending digests with graceful backward catch-up
Queries unsent digests for today within a 2-hour latency tolerance window:
```sql
SELECT 
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
ORDER BY delivery_hour ASC, id ASC;
```
*Parameter mapping:*
* `?` (Param 1): Current date string (`YYYY-MM-DD` in VN timezone).
* `?` (Param 2): Current hour $H$.
* `?` (Param 3): Floor hour $\max(0, H - 2)$.

#### Step 2: Mark digest sent and update subscription watermark
Executed inside an atomic transaction upon complete transmission of all chunked pages:
```sql
START TRANSACTION;

UPDATE shift_digests 
SET is_sent = 1 
WHERE id = ?;

UPDATE subscriptions 
SET last_delivered_at = NOW() 
WHERE id = ?;

COMMIT;
```

#### Step 3: Auto-deactivate one-time specific date subscriptions
```sql
UPDATE subscriptions 
SET is_active = 0 
WHERE id = ? 
  AND schedule_type = 'specific_date';
```

---

### 5.4. Housekeeping & Retention Pipeline
Executed daily at 03:00 AM VN time to purge stale data:
```sql
DELETE FROM raw_articles 
WHERE created_at < NOW() - INTERVAL 3 DAY;
```