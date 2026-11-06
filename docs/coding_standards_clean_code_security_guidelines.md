# CODING_STANDARDS.md - Engineering Standards, Clean Code & Security Protocols

This document establishes the mandatory engineering standards, Clean Code principles, security policies, and resource safety rules for the `tele-intel-bot` project. Any AI coding assistant (Cursor, Antigravity, Windsurf, Copilot) or human developer contributing to this repository **must strictly abide by every directive herein**.

---

## 1. Architectural Philosophy & Clean Code Principles

### 1.1. Single Responsibility Principle (SRP)
Every module and function must execute exactly one unambiguous responsibility:
- **`lib/db.js`**: Connection pool creation and lifecycle only. No queries or business operations.
- **`lib/db_operations.js`**: Pure SQL query abstraction. No HTTP calls, cron references, or Telegram formatting logic.
- **`lib/scraper.js`**: Feed fetching and DOM/JSON extraction only. Never calls the database directly; returns structured records to callers.
- **`lib/gemini.js`**: Prompt composition, SDK communication, and schema enforcement only.
- **`lib/chunker.js`**: Text processing, character counting, entity escaping, and HTML boundary splitting only.
- **`bot.js`**: Telegram UI, conversation flow handling, and user command routing only.
- **`index.js`**: Bootstrap sequence, cron schedule registration, and top-level process supervision only.

### 1.2. Naming Conventions & Self-Documenting Code
- Use intention-revealing, domain-specific names. Eliminate arbitrary single-letter variables except for standard mathematical loop indices (`i`, `j`).
  ```javascript
  // ❌ REJECTED:
  const d = getD();
  const res = a.filter(x => x.h == h);

  // ✅ REQUIRED:
  const deliveryDateString = getVietnamDateString();
  const shiftSubscriptions = activeSubscriptions.filter(sub => sub.delivery_hour === targetHour);
  ```
- **File & Module Names**: Lowercase snake_case or kebab-case (`db_operations.js`, `scraper.js`).
- **Function Names**: Verb-first camelCase (`scrapeGoogleNewsRss`, `saveShiftDigest`, `renderHtmlPages`).
- **Constants**: Upper SNAKE_CASE (`MAX_TELEGRAM_MESSAGE_LENGTH = 3500`, `INGEST_THROTTLE_MS = 2000`).

### 1.3. Control Flow & Asynchrony Standards
- Use modern `async`/`await` exclusively. **Do not use raw Promise chains (`.then().catch()`) or callback pyramids**.
- Eliminate deep nesting (`> 3 levels`) through early returns (Guard Clauses):
  ```javascript
  // ✅ REQUIRED: Guard Clause Pattern
  async function processShiftItem(item) {
    if (!item.is_active) return;
    if (!item.summary_json) return;

    // Core execution continues without nesting...
  }
  ```

---

## 2. Zero-Trust Security Policies (Mandatory)

### 2.1. Absolute Prevention of SQL Injection
- **Rule**: String concatenation, template literals, or dynamic variable interpolation inside SQL queries is an immediate blocker.
- **Policy**: All queries must utilize parameterized queries via `mysql2/promise` using positional `?` placeholders.
  ```javascript
  // ❌ CRITICAL SECURITY VULNERABILITY:
  await pool.query(`SELECT * FROM subscriptions WHERE topic = '${userTopic}'`);

  // ✅ REQUIRED: Parameterized Prepared Statement
  await pool.query(
    "SELECT * FROM subscriptions WHERE topic = ? AND is_active = ?",
    [normalizedTopic, 1]
  );
  ```

### 2.2. Uncompromising Authorization Barrier (Admin Lock)
- This bot is a private intelligence agent. All incoming Telegram updates (`message`, `callback_query`, `inline_query`) must traverse a global authorization check before any handler or conversation is invoked.
  ```javascript
  // ✅ REQUIRED: Global Security Middleware in bot.js
  bot.use(async (ctx, next) => {
    const senderId = ctx.chat?.id?.toString();
    const adminId = process.env.ADMIN_CHAT_ID?.toString();

    if (!senderId || senderId !== adminId) {
      console.warn(`[Security Alert] Unauthorized access attempt from Telegram ID: ${senderId}`);
      if (ctx.chat) {
        await ctx.reply("⛔ Unauthorized access. This is a private intelligence system.").catch(() => {});
      }
      return; // Immediate halt: Do not call next()
    }
    await next();
  });
  ```

### 2.3. Secret & Configuration Management
- Secrets (`BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_CHAT_ID`, `MYSQL_PASSWORD`) must never be hardcoded or checked into version control.
- Enforce pre-flight validation on boot. If any required environment variable is missing, fail fast with a fatal log:
  ```javascript
  const REQUIRED_ENVIRONMENT_VARIABLES = [
    "BOT_TOKEN",
    "ADMIN_CHAT_ID",
    "GEMINI_API_KEY",
    "MYSQL_HOST",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE"
  ];

  for (const envKey of REQUIRED_ENVIRONMENT_VARIABLES) {
    if (!process.env[envKey] || process.env[envKey].trim() === "") {
      console.error(`[Fatal Startup Error] Missing required environment variable: ${envKey}`);
      process.exit(1);
    }
  }
  ```
- The `.gitignore` file must explicitly exclude `.env`, `*.db`, `node_modules/`, and log files.

### 2.4. HTML Output Sanitization (Anti-XSS & Anti-Crash)
- Since Telegram output uses `parse_mode: "HTML"`, any untrusted string derived from scrapers or model synthesis must be entity-escaped to prevent HTML parser failures or malformed tags from breaking the broadcast:
  ```javascript
  function escapeHtml(unsafeText) {
    if (typeof unsafeText !== "string") return "";
    return unsafeText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  ```
- Structural tags (`<b>`, `<i>`, `<a>`, `<code>`) must only be inserted intentionally by the renderer code around escaped text values.

---

## 3. High Availability, Concurrency & Resource Safety

### 3.1. Background Concurrency Locking (Mutex Guard)
- The synthesis loop consumes substantial memory and network bandwidth. If an execution cycle outlasts the hourly interval, subsequent runs must not trigger concurrently.
  ```javascript
  let isSynthesizing = false;

  async function executeSynthesisCycle() {
    if (isSynthesizing) {
      console.warn("[Cron Warning] Previous synthesis cycle is still active. Skipping interval.");
      return;
    }

    isSynthesizing = true;
    try {
      await performSynthesisWork();
    } catch (err) {
      console.error("[Synthesis Failure]:", err);
    } finally {
      isSynthesizing = false; // Guaranteed unlock regardless of success or error
    }
  }
  ```

### 3.2. Connection Pool Hygiene & Leak Prevention
- When querying using `pool.query(...)`, connections are automatically borrowed and returned.
- If manual transactions are required via `pool.getConnection()`, releasing the connection within a `finally` block is mandatory:
  ```javascript
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("UPDATE shift_digests SET is_sent = 1 WHERE id = ?", [digestId]);
    await connection.query("UPDATE subscriptions SET last_delivered_at = NOW() WHERE id = ?", [subscriptionId]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release(); // Mandatory return to pool to avoid exhaustion
  }
  ```

### 3.3. Telegram Throttling & Rate-Limit Handling (HTTP 429)
- Respect Telegram's broadcast limits (maximum 1 message/sec per private chat):
  - Insert `await delay(1000)` between consecutive pagination chunks.
  - Insert `await delay(1500)` between distinct topics.
- Implement explicit backoff for Telegram `429 Too Many Requests`:
  ```javascript
  try {
    await bot.api.sendMessage(chatId, htmlContent, { parse_mode: "HTML" });
  } catch (error) {
    if (error.parameters && error.parameters.retry_after) {
      const waitSeconds = error.parameters.retry_after;
      console.warn(`[Telegram Rate Limit] Pausing execution for ${waitSeconds} seconds...`);
      await delay((waitSeconds + 1) * 1000);
      // Retry once after backoff
      await bot.api.sendMessage(chatId, htmlContent, { parse_mode: "HTML" });
    } else {
      throw error;
    }
  }
  ```

---

## 4. Robust Error Handling & Telemetry

### 4.1. Non-Blocking Scraper Resilience
- A failure in an upstream website or RSS feed (e.g., DNS timeout, HTTP 500, Cloudflare block) must **never crash the daemon or cancel scraping for other topics**.
- Every individual fetcher must catch errors internally, log the issue with contextual metadata, and return an empty collection gracefully:
  ```javascript
  async function scrapeFeedSafely(topic) {
    try {
      return await executeNetworkScrape(topic);
    } catch (error) {
      console.error(`[Scraper Exception] Skipping feed for topic "${topic}": ${error.message}`);
      return [];
    }
  }
  ```

### 4.2. Active Admin Failure Notifications
- When critical synthesis failures occur (e.g., Gemini API quota exhaustion or database disconnects during shift preparation), the system must alert the user directly on Telegram so outages do not go unnoticed:
  ```javascript
  async function alertAdminOfFailure(bot, adminChatId, shiftHour, topic, errorMessage) {
    const message = `⚠️ <b>[System Warning]</b> Synthesis failed for ca <code>${shiftHour}:00</code> (Topic: <i>${escapeHtml(topic)}</i>).\n\n<b>Error:</b> <code>${escapeHtml(errorMessage)}</code>`;
    await bot.api.sendMessage(adminChatId, message, { parse_mode: "HTML" }).catch(() => {});
  }
  ```

### 4.3. Process Level Exception Handling
- Prevent silent process death and catch unhandled edge-cases globally in `index.js`:
  ```javascript
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[Unhandled Promise Rejection]:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[Uncaught Process Exception]:", error);
  });

  process.on("SIGTERM", async () => {
    console.log("[Shutdown] SIGTERM received. Gracefully shutting down pool and bot...");
    await pool.end().catch(() => {});
    process.exit(0);
  });
  ```