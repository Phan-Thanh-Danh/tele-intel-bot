-- ============================================================================
-- Database Initialization Script (Extracted from docs/DATABASE.md)
-- Character Set: utf8mb4 / Collation: utf8mb4_unicode_ci
-- Timezone: +07:00 (Asia/Ho_Chi_Minh)
-- ============================================================================

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
  link VARCHAR(500) NOT NULL,
  source VARCHAR(100) NULL,
  pub_date DATETIME NOT NULL,
  content_snippet TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Constraints & Indexes
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
  UNIQUE KEY uq_sub_delivery (subscription_id, delivery_date, delivery_hour),
  INDEX idx_dispatch_lookup (delivery_date, delivery_hour, is_sent),

  CONSTRAINT fk_digest_subscription
    FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
