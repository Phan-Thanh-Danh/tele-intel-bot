require("dotenv").config({ debug: false });
const cron = require("node-cron");
const { InlineKeyboard } = require("grammy");
const { pool, closePool } = require("./lib/db");
const {
  initDatabaseSchema,
  getDistinctActiveTopics,
  getSubscriptionsByHour,
  getArticlesForTopicSince,
  insertRawArticles,
  upsertShiftDigest,
  getPendingDigests,
  markDigestSentWithTransaction,
  deactivateSpecificDateSubscription,
  deleteStaleArticles,
  getTopicHistory,
  upsertTopicState,
  getUserLanguage,
  getCustomFeeds,
  getRecentSentEvents,
  checkLlmBudget,
  formatVietnamDate
} = require("./lib/db_operations");
const { t } = require("./lib/i18n");
const { scrapeTopic, fetchRssFeed } = require("./lib/scraper");
const { synthesizeArticles, setAdminAlertHandler } = require("./lib/synthesizer");
const { chunkDigestToPages, escapeHtml } = require("./lib/chunker");
const { createBot } = require("./bot");

// ============================================================================
// 1. Pre-flight Environment Validation
// ============================================================================
const REQUIRED_ENVIRONMENT_VARIABLES = [
  "BOT_TOKEN",
  "ADMIN_CHAT_ID",
  "OPENROUTER_API_KEY",
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

// Zero-Cost Startup Guard: Bắt buộc LLM_MODEL và LLM_FALLBACK_MODEL phải kết thúc bằng ":free"
const primaryModel = (process.env.LLM_MODEL || "").trim();
const fallbackModel = (process.env.LLM_FALLBACK_MODEL || "").trim();

if (!primaryModel || !primaryModel.endsWith(":free")) {
  console.error(
    `[Fatal Startup Error] LLM_MODEL ("${primaryModel || "MISSING"}") không hợp lệ. ` +
    `Bot yêu cầu model kết thúc bằng ":free" (Zero-Cost Guard).`
  );
  process.exit(1);
}

if (!fallbackModel || !fallbackModel.endsWith(":free")) {
  console.error(
    `[Fatal Startup Error] LLM_FALLBACK_MODEL ("${fallbackModel || "MISSING"}") không hợp lệ. ` +
    `Bắt buộc model dự phòng phải kết thúc bằng ":free".`
  );
  process.exit(1);
}

// ============================================================================
// 2. Vietnam Timezone Utilities (Asia/Ho_Chi_Minh - UTC+7)
// ============================================================================
function getVietnamTime() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    weekday: "short"
  });

  const parts = formatter.formatToParts(new Date());
  const getPart = (t) => parts.find((p) => p.type === t)?.value;

  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = parseInt(getPart("hour"), 10) % 24;
  const minute = parseInt(getPart("minute"), 10);
  const weekdayStr = getPart("weekday");

  // Monday = 1, Tuesday = 2, ..., Sunday = 7
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dayOfWeek = weekdayMap[weekdayStr] || 1;
  const dateString = `${year}-${month}-${day}`;

  return { dateString, hour, minute, dayOfWeek };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// 3. Background Pipelines
// ============================================================================

/**
 * Pipeline 1: Raw Content Ingest Job (Runs every 30 minutes)
 */
async function executeIngestJob() {
  console.log(`[Ingest Job] Starting raw content ingestion at ${new Date().toISOString()}`);
  try {
    const topics = await getDistinctActiveTopics();
    if (topics.length === 0) {
      console.log("[Ingest Job] No active topics to ingest.");
      return;
    }

    for (const topic of topics) {
      console.log(`[Ingest Job] Fetching feeds for topic: "${topic}"...`);
      const articles = await scrapeTopic(topic);
      if (articles.length > 0) {
        const inserted = await insertRawArticles(articles);
        console.log(`[Ingest Job] Inserted ${inserted} new articles for topic: "${topic}".`);
      }
      // Throttle 2,000 ms between topics to prevent IP rate-limiting
      await delay(2000);
    }

    // Ingest active custom RSS feeds
    const customFeeds = await getCustomFeeds();
    if (customFeeds.length > 0) {
      console.log(`[Ingest Job] Fetching ${customFeeds.length} custom RSS feeds...`);
      for (const feed of customFeeds) {
        try {
          const feedArticles = await fetchRssFeed(feed.feed_url, feed.topic || "general", feed.feed_name || "Custom RSS", 2);
          if (feedArticles.length > 0) {
            const inserted = await insertRawArticles(feedArticles);
            console.log(`[Ingest Job] Inserted ${inserted} articles from custom feed "${feed.feed_name || feed.feed_url}".`);
          }
        } catch (fErr) {
          console.warn(`[Ingest Job] Failed to ingest custom feed ${feed.feed_url}:`, fErr.message);
        }
        await delay(1000);
      }
    }
  } catch (error) {
    console.error("[Ingest Job Exception]:", error);
  }
}

/**
 * Pipeline 2: Pre-Shift AI Synthesis Job (Runs at minute 00 of every hour)
 * Prepares digests for upcoming shift hour (H + 1)
 */
let isSynthesizing = false;

async function executeSynthesizeJob(bot, adminChatId) {
  if (isSynthesizing) {
    console.warn("[Cron Warning] Previous synthesis cycle is still active. Skipping interval.");
    return;
  }

  isSynthesizing = true;
  try {
    const { dateString, hour, dayOfWeek } = getVietnamTime();
    const targetHour = (hour + 1) % 24;

    console.log(`[Synthesis Job] Synthesizing shift ${targetHour}:00 for date ${dateString} (DOW: ${dayOfWeek})`);

    const subscriptions = await getSubscriptionsByHour(targetHour);
    if (subscriptions.length === 0) {
      console.log(`[Synthesis Job] No active subscriptions configured for hour ${targetHour}:00.`);
      return;
    }

    for (const sub of subscriptions) {
      // Evaluate recurring vs specific_date
      if (sub.schedule_type === "recurring") {
        const days = (sub.days_of_week || "").split(",").map((d) => parseInt(d.trim(), 10));
        if (!days.includes(dayOfWeek)) {
          continue; // Not scheduled for today
        }
      } else if (sub.schedule_type === "specific_date") {
        const specDateStr = formatVietnamDate(sub.specific_date);
        if (specDateStr !== dateString) {
          continue; // Not scheduled for today
        }
      }

      console.log(`[Synthesis Job] Processing topic "${sub.topic}" for subscription #${sub.id}`);
      try {
        const articles = await getArticlesForTopicSince(sub.topic, sub.last_delivered_at, 30);
        const topicHistory = await getTopicHistory(sub.topic, 10);
        // Phase 5.1: Lấy các sự kiện gần nhất đã gửi của topic để chống lặp tin (tối đa 12 sự kiện)
        const recentEvents = await getRecentSentEvents(sub.topic, 12);
        const summary = await synthesizeArticles(
          sub.topic,
          articles,
          sub.prompt_guidance,
          topicHistory,
          "en",
          recentEvents,
          "scheduled"
        );

        // Update event_ledger with latest synthesized states
        if (Array.isArray(summary.events) && summary.events.length > 0) {
          for (const evt of summary.events.slice(0, 3)) {
            const key = (evt.title || "general").slice(0, 80);
            const state = evt.hard_facts || evt.details || evt.title;
            await upsertTopicState(sub.topic, key, state).catch(() => {});
          }
        }

        await upsertShiftDigest({
          subscriptionId: sub.id,
          chatId: sub.chat_id,
          topic: sub.topic,
          deliveryDate: dateString,
          deliveryHour: targetHour,
          summaryJson: summary
        });

        console.log(`[Synthesis Job] Successfully stored digest for topic "${sub.topic}" (Shift ${targetHour}:00).`);
      } catch (err) {
        console.error(`[Synthesis Job Error] Topic "${sub.topic}":`, err);
        // Active Admin Failure Notification
        const alertMsg =
          `⚠️ <b>[System Warning]</b> Tổng hợp tin thất bại cho ca <code>${targetHour}:00</code> ` +
          `(Chủ đề: <i>${escapeHtml(sub.topic)}</i>).\n\n` +
          `<b>Lỗi:</b> <code>${escapeHtml(err.message)}</code>`;
        await bot.api.sendMessage(adminChatId, alertMsg, { parse_mode: "HTML" }).catch(() => {});
      }
    }
  } catch (error) {
    console.error("[Synthesis Job Global Exception]:", error);
  } finally {
    isSynthesizing = false; // Guaranteed unlock
  }
}

/**
 * Pipeline 3: Timed Message Dispatch Job (Runs at minute 00 of every hour)
 */
async function executeDispatchJob(sendSafeMessage) {
  const { dateString, hour } = getVietnamTime();
  const floorHour = Math.max(0, hour - 2);

  console.log(`[Dispatch Job] Checking pending digests for ${dateString} between hour ${floorHour}:00 and ${hour}:00`);

  try {
    const digests = await getPendingDigests(dateString, hour, floorHour);
    if (digests.length === 0) {
      console.log("[Dispatch Job] No pending digests to dispatch.");
      return;
    }

    for (const digest of digests) {
      console.log(`[Dispatch Job] Dispatching digest #${digest.id} (Topic: "${digest.topic}")`);

      let summaryObj;
      try {
        summaryObj =
          typeof digest.summary_json === "string"
            ? JSON.parse(digest.summary_json)
            : digest.summary_json;
      } catch {
        summaryObj = { overview: "Lỗi định dạng bản tin.", events: [] };
      }

      const langCode = (await getUserLanguage(digest.chat_id)) || "en";
      const pages = chunkDigestToPages({
        topic: digest.topic,
        deliveryHour: digest.delivery_hour,
        summary: summaryObj
      }, langCode);

      // Send each page sequentially with 1,000 ms delay
      for (let i = 0; i < pages.length; i++) {
        const isLastPage = (i === pages.length - 1);
        const replyMarkup = isLastPage
          ? new InlineKeyboard()
              .text(t(langCode, "feedback_confirmed_btn"), `fb:good:${digest.topic.slice(0, 30)}`)
              .text(t(langCode, "feedback_disputed_btn"), `fb:bad:${digest.topic.slice(0, 30)}`)
          : undefined;

        await sendSafeMessage(digest.chat_id, pages[i], replyMarkup ? { reply_markup: replyMarkup } : {});
        if (i < pages.length - 1) {
          await delay(1000);
        }
      }

      // Mark sent and update watermark atomically
      await markDigestSentWithTransaction(digest.id, digest.subscription_id);
      await deactivateSpecificDateSubscription(digest.subscription_id);

      // Delay 1,500 ms between distinct topics
      await delay(1500);
    }
  } catch (error) {
    console.error("[Dispatch Job Exception]:", error);
  }
}

/**
 * Pipeline 4: Automated Data Retention Housekeeping Job (Daily at 03:00 AM VN time)
 */
async function executeHousekeepingJob() {
  console.log("[Housekeeping Job] Purging stale raw articles older than 3 days...");
  try {
    const deletedCount = await deleteStaleArticles(3);
    console.log(`[Housekeeping Job] Cleaned up ${deletedCount} stale articles.`);
  } catch (error) {
    console.error("[Housekeeping Job Exception]:", error);
  }
}

// ============================================================================
// 4. Main Bootstrap Sequence
// ============================================================================
async function bootstrap() {
  console.log("=================================================");
  console.log("🚀 TELE-INTEL-BOT DAEMON BOOTSTRAPPING...");
  console.log("=================================================");

  // Step 1: Initialize Database Schema
  try {
    await initDatabaseSchema();
    console.log("✅ Database schema initialized and verified.");
  } catch (dbErr) {
    console.error("❌ Fatal Database Connection Error:", dbErr.message);
    process.exit(1);
  }

  // Step 2: Initialize Telegram Bot
  const { bot, sendSafeMessage } = createBot();
  const adminChatId = process.env.ADMIN_CHAT_ID;

  // Đăng ký nhận cảnh báo khẩn cấp từ OpenRouter Synthesizer gửi về Telegram Admin
  setAdminAlertHandler(async (alertMessage) => {
    await bot.api.sendMessage(adminChatId, alertMessage, { parse_mode: "HTML" }).catch(() => {});
  });

  // Step 3: Register Cron Schedulers
  // 1. Ingest Job: Every 30 minutes
  cron.schedule("*/30 * * * *", () => {
    executeIngestJob().catch((err) => console.error("[Cron Ingest Error]:", err));
  });

  // 2. Synthesize Job: Minute 00 of every hour
  cron.schedule("0 * * * *", () => {
    executeSynthesizeJob(bot, adminChatId).catch((err) =>
      console.error("[Cron Synthesize Error]:", err)
    );
  });

  // 3. Dispatch Job: Minute 00 of every hour
  cron.schedule("0 * * * *", () => {
    executeDispatchJob(sendSafeMessage).catch((err) =>
      console.error("[Cron Dispatch Error]:", err)
    );
  });

  // 4. Housekeeping Job: Daily at 03:00 AM (Vietnam Time)
  cron.schedule(
    "0 3 * * *",
    () => {
      executeHousekeepingJob().catch((err) =>
        console.error("[Cron Housekeeping Error]:", err)
      );
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  );

  console.log("✅ Background cron jobs scheduled successfully.");

  // Step 4: Run initial Ingest pass on startup
  executeIngestJob().catch((err) => console.warn("[Initial Ingest Notice]:", err.message));

  // Step 5: Start Long Polling Bot
  console.log("🤖 Starting Telegram Long Polling...");
  bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Telegram Bot @${botInfo.username} is ONLINE and listening.`);
    }
  });

  // Step 6: Process Exception Handlers
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[Unhandled Promise Rejection]:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[Uncaught Process Exception]:", error);
  });

  process.on("SIGTERM", async () => {
    console.log("[Shutdown] SIGTERM received. Gracefully closing resources...");
    try {
      await bot.stop();
      await closePool();
    } catch {}
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("[Shutdown] SIGINT received. Gracefully closing resources...");
    try {
      await bot.stop();
      await closePool();
    } catch {}
    process.exit(0);
  });
}

bootstrap().catch((fatal) => {
  console.error("[Fatal Daemon Failure]:", fatal);
  process.exit(1);
});
