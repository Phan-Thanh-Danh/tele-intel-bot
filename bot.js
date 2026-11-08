const { Bot, session, InlineKeyboard } = require("grammy");
const { conversations, createConversation } = require("@grammyjs/conversations");
const { scrapeTopic } = require("./lib/scraper");
const { synthesizeArticles } = require("./lib/synthesizer");
const {
  chunkInstantResearchToPages,
  escapeHtml
} = require("./lib/chunker");
const {
  createSubscription,
  getAllSubscriptions,
  getSubscriptionById,
  toggleSubscriptionStatus,
  deleteSubscription,
  getTopicHistory,
  upsertTopicState,
  recordSourceFeedback,
  getUserLanguage,
  setUserLanguage,
  addCustomFeed,
  getCustomFeeds,
  deleteCustomFeed,
  checkLlmBudget,
  formatVietnamDate
} = require("./lib/db_operations");
const { SUPPORTED_LANGUAGES, t } = require("./lib/i18n");

/**
 * Creates and configures the Telegram Bot instance.
 * Adheres strictly to SRP: Telegram UI, conversation flow handling, and user command routing only.
 * Full Multi-Language (i18n) Engine.
 */
function createBot() {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken || botToken.trim() === "") {
    throw new Error("Missing required environment variable: BOT_TOKEN");
  }

  const bot = new Bot(botToken);

  // 1. Session middleware (required for conversations)
  bot.use(session({ initial: () => ({}) }));

  // 2. Global Security Middleware: Zero-Trust Admin Lock
  bot.use(async (ctx, next) => {
    const senderId = ctx.chat?.id?.toString();
    const adminId = process.env.ADMIN_CHAT_ID?.toString();

    if (!senderId || senderId !== adminId) {
      console.warn(`[Security Alert] Unauthorized access attempt from Telegram ID: ${senderId}`);
      if (ctx.chat) {
        await ctx.reply("⛔ Unauthorized access. This is a private intelligence system.").catch(() => {});
      }
      return; // Immediate halt
    }
    await next();
  });

  // 3. Register Conversations plugin
  bot.use(conversations());

  // Helper delay
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Safe message sender with Telegram 429 retry backoff
  async function sendSafeMessage(chatId, htmlContent, extra = {}) {
    const defaultOptions = {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra
    };

    try {
      return await bot.api.sendMessage(chatId, htmlContent, defaultOptions);
    } catch (error) {
      if (error?.parameters?.retry_after) {
        const waitSeconds = error.parameters.retry_after;
        console.warn(`[Telegram Rate Limit] Pausing for ${waitSeconds}s on chat ${chatId}`);
        await delay((waitSeconds + 1) * 1000);
        return await bot.api.sendMessage(chatId, htmlContent, defaultOptions);
      }
      if (
        error?.message?.includes("can't parse entities") ||
        error?.description?.includes("can't parse entities")
      ) {
        console.warn(`[Telegram HTML Fallback] Entity parsing failed, sending plain text: ${error.message}`);
        const plainText = htmlContent.replace(/<[^>]*>?/gm, "");
        return await bot.api.sendMessage(chatId, plainText, {
          ...extra,
          disable_web_page_preview: true
        });
      }
      throw error;
    }
  }

  // Helper: Builds Language Selection Keyboard
  function buildLanguageKeyboard() {
    const kb = new InlineKeyboard();
    for (let i = 0; i < SUPPORTED_LANGUAGES.length; i += 2) {
      const l1 = SUPPORTED_LANGUAGES[i];
      const l2 = SUPPORTED_LANGUAGES[i + 1];
      if (l2) {
        kb.text(l1.label, `set_lang:${l1.code}`).text(l2.label, `set_lang:${l2.code}`).row();
      } else {
        kb.text(l1.label, `set_lang:${l1.code}`).row();
      }
    }
    return kb;
  }

  // Helper: Builds Main Menu Keyboard localized to user language
  function buildMainMenuKeyboard(langCode) {
    return new InlineKeyboard()
      .text(t(langCode, "btn_instant"), "btn_instant")
      .text(t(langCode, "btn_add_sub"), "btn_add_sub")
      .row()
      .text(t(langCode, "btn_list_sub"), "btn_list_subs")
      .text(t(langCode, "btn_help"), "btn_help")
      .row()
      .text(t(langCode, "btn_change_lang"), "btn_change_lang");
  }

  // ============================================================================
  // Conversations
  // ============================================================================

  /**
   * Conversation: Instant Strategic Intelligence Research
   */
  async function instantResearchConversation(conversation, ctx) {
    const langCode = (await conversation.external(() => getUserLanguage(ctx.chat.id))) || "en";

    await ctx.reply(t(langCode, "instant_prompt"), { parse_mode: "HTML" });

    const topicMsg = await conversation.wait();
    const topic = topicMsg.message?.text?.trim();

    if (!topic || topic.toLowerCase() === "/cancel") {
      await ctx.reply(t(langCode, "cancel_success"));
      return;
    }

    // Kiểm tra hạn mức ngân sách gọi LLM trong ngày (LLM_DAILY_LIMIT)
    const budget = await conversation.external(() => checkLlmBudget("instant"));
    if (!budget.allowed) {
      await ctx.reply(
        `⚠️ <b>[Hạn Mức AI Đã Đạt]</b> Hôm nay bot đã thực hiện <code>${budget.count}/${budget.limit}</code> yêu cầu AI.\n\n` +
        `Tính năng tra cứu tức thì tạm dừng để bảo toàn hạn mức cho các ca gửi tin tự động theo lịch. ` +
        `Vui lòng thử lại vào ngày mai hoặc điều chỉnh <code>LLM_DAILY_LIMIT</code> trong file cấu hình.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const statusMsg = await ctx.reply(t(langCode, "instant_collecting"), { parse_mode: "HTML" });

    try {
      // Step 1: Scrape
      const articles = await conversation.external(() => scrapeTopic(topic));

      if (articles.length === 0) {
        await bot.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          t(langCode, "instant_no_articles", { topic: escapeHtml(topic) }),
          { parse_mode: "HTML" }
        ).catch(() => {});
        return;
      }

      await bot.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        t(langCode, "instant_analyzing", { count: articles.length, lang: langCode.toUpperCase() }),
        { parse_mode: "HTML" }
      ).catch(() => {});

      // Step 2: Fetch Topic History (Event Ledger) & DeepSeek Synthesis in target language
      const topicHistory = await conversation.external(() => getTopicHistory(topic));
      // Khối chống lặp tin (anti-repetition) mặc định TẮT ở chế độ tra cứu tức thì (/instant)
      // để người dùng luôn nhận được báo cáo đầy đủ nhất theo yêu cầu mà không bị lược bỏ.
      const recentEvents = [];
      const summary = await conversation.external(() =>
        synthesizeArticles(topic, articles, null, topicHistory, langCode, recentEvents, "instant")
      );

      // Update Event Ledger with new event states
      if (Array.isArray(summary.events) && summary.events.length > 0) {
        for (const evt of summary.events.slice(0, 3)) {
          const key = (evt.title || "general").slice(0, 80);
          const state = evt.hard_facts || evt.core_verdict || evt.title;
          await conversation.external(() => upsertTopicState(topic, key, state)).catch(() => {});
        }
      }

      // Step 3: Chunk and send with user's selected language template
      const pages = chunkInstantResearchToPages(topic, summary, langCode);

      // Delete status message
      await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

      for (let i = 0; i < pages.length; i++) {
        const isLastPage = (i === pages.length - 1);
        const replyMarkup = isLastPage
          ? new InlineKeyboard()
              .text(t(langCode, "feedback_confirmed_btn"), `fb:good:${topic.slice(0, 30)}`)
              .text(t(langCode, "feedback_disputed_btn"), `fb:bad:${topic.slice(0, 30)}`)
          : undefined;

        await sendSafeMessage(ctx.chat.id, pages[i], replyMarkup ? { reply_markup: replyMarkup } : {});
        if (i < pages.length - 1) {
          await delay(1000);
        }
      }
    } catch (err) {
      console.error("[Instant Research Error]:", err);
      await ctx.reply(
        t(langCode, "instant_error", { error: escapeHtml(err.message) }),
        { parse_mode: "HTML" }
      ).catch(() => {});
    }
  }

  /**
   * Conversation: Create Subscription Schedule
   */
  async function createSubscriptionConversation(conversation, ctx) {
    const langCode = (await conversation.external(() => getUserLanguage(ctx.chat.id))) || "en";

    await ctx.reply(
      "➕ <b>ADD INTELLIGENCE MONITORING SCHEDULE</b>\n\n" +
      "<b>Step 1/4:</b> Enter the Topic or Entity to track:\n" +
      "<i>(e.g., AI Semiconductors, US Economy, Vietnam Real Estate)</i>",
      { parse_mode: "HTML" }
    );

    const topicMsg = await conversation.wait();
    const topic = topicMsg.message?.text?.trim();
    if (!topic || topic.toLowerCase() === "/cancel") {
      await ctx.reply(t(langCode, "cancel_success"));
      return;
    }

    await ctx.reply(
      `<b>Step 2/4:</b> Enter custom analytical guidance (Topic Guidance):\n\n` +
      `<i>e.g.: "Focus on M&A antitrust rulings", "Compare Western vs Eastern viewpoints"...</i>\n` +
      `Or send <code>skip</code> to skip this step:`,
      { parse_mode: "HTML" }
    );

    const guidanceMsg = await conversation.wait();
    const guidanceRaw = guidanceMsg.message?.text?.trim();
    const promptGuidance =
      guidanceRaw && !["skip", "bo qua", "bỏ qua"].includes(guidanceRaw.toLowerCase())
        ? guidanceRaw
        : null;

    const scheduleTypeKeyboard = new InlineKeyboard()
      .text("🔄 Recurring Daily", "sched_recurring")
      .text("📅 Specific Date", "sched_specific");

    await ctx.reply(
      "<b>Step 3/4:</b> Choose schedule frequency type:",
      { parse_mode: "HTML", reply_markup: scheduleTypeKeyboard }
    );

    const typeCtx = await conversation.waitForCallbackQuery(["sched_recurring", "sched_specific"]);
    await typeCtx.answerCallbackQuery();
    const scheduleType = typeCtx.callbackQuery.data === "sched_recurring" ? "recurring" : "specific_date";

    let specificDate = null;
    if (scheduleType === "specific_date") {
      await ctx.reply(
        "Enter specific delivery date in <code>YYYY-MM-DD</code> format:\n(e.g., <code>2026-11-15</code>)",
        { parse_mode: "HTML" }
      );
      const dateMsg = await conversation.wait();
      specificDate = dateMsg.message?.text?.trim();
    }

    await ctx.reply(
      "<b>Step 4/4:</b> Enter delivery hour (0 - 23 in Vietnam Time UTC+7):\n(e.g.: <code>7</code>, <code>12</code>, <code>18</code>, <code>21</code>)",
      { parse_mode: "HTML" }
    );

    const hourMsg = await conversation.wait();
    const deliveryHour = parseInt(hourMsg.message?.text?.trim(), 10);

    if (isNaN(deliveryHour) || deliveryHour < 0 || deliveryHour > 23) {
      await ctx.reply("❌ Invalid delivery hour. Setup cancelled.");
      return;
    }

    try {
      const subId = await conversation.external(() =>
        createSubscription({
          chatId: ctx.chat.id,
          topic,
          promptGuidance,
          scheduleType,
          specificDate,
          deliveryHour
        })
      );

      await ctx.reply(
        `✅ <b>SCHEDULE CREATED SUCCESSFULLY!</b>\n\n` +
        `• <b>ID:</b> <code>#${subId}</code>\n` +
        `• <b>Topic:</b> <i>${escapeHtml(topic)}</i>\n` +
        `• <b>Shift Hour:</b> <code>${String(deliveryHour).padStart(2, "0")}:00</code> (UTC+7)\n` +
        `• <b>Frequency:</b> <code>${scheduleType}</code>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("[Create Subscription Error]:", err);
      await ctx.reply(`❌ Database Error: ${escapeHtml(err.message)}`);
    }
  }

  bot.use(createConversation(instantResearchConversation));
  bot.use(createConversation(createSubscriptionConversation));

  // ============================================================================
  // Command & UI Routing Handlers
  // ============================================================================

  // /start: Checks if user has language set. If not, prompts language picker!
  bot.command("start", async (ctx) => {
    const existingLang = await getUserLanguage(ctx.chat.id);

    if (!existingLang) {
      // First time user: Show Language Picker directly
      await ctx.reply(t("en", "select_language_title"), {
        parse_mode: "HTML",
        reply_markup: buildLanguageKeyboard()
      });
      return;
    }

    // Returning user: Go directly into Main Menu localized
    const welcomeText = `${t(existingLang, "welcome_title")}\n\n${t(existingLang, "welcome_body")}`;
    await ctx.reply(welcomeText, {
      parse_mode: "HTML",
      reply_markup: buildMainMenuKeyboard(existingLang)
    });
  });

  // /lang or /language command to switch language at any time
  bot.command(["lang", "language"], async (ctx) => {
    await ctx.reply(t("en", "select_language_title"), {
      parse_mode: "HTML",
      reply_markup: buildLanguageKeyboard()
    });
  });

  // Language Selection Callback Handler
  bot.callbackQuery(/^set_lang:([a-z]{2})$/, async (ctx) => {
    const langCode = ctx.match[1];
    await setUserLanguage(ctx.chat.id, langCode);

    await ctx.answerCallbackQuery({ text: `Language set: ${langCode.toUpperCase()}` });

    // Send confirmation and open main menu directly
    await ctx.reply(t(langCode, "language_saved"), { parse_mode: "HTML" });

    const welcomeText = `${t(langCode, "welcome_title")}\n\n${t(langCode, "welcome_body")}`;
    await ctx.reply(welcomeText, {
      parse_mode: "HTML",
      reply_markup: buildMainMenuKeyboard(langCode)
    });
  });

  bot.command("help", async (ctx) => {
    const langCode = (await getUserLanguage(ctx.chat.id)) || "en";
    await ctx.reply(`${t(langCode, "help_title")}\n\n${t(langCode, "help_body")}`, {
      parse_mode: "HTML"
    });
  });

  bot.command("instant", async (ctx) => {
    await ctx.conversation.enter("instantResearchConversation");
  });

  bot.command("add", async (ctx) => {
    await ctx.conversation.enter("createSubscriptionConversation");
  });

  bot.command("list", async (ctx) => {
    await handleListSubscriptions(ctx);
  });

  // Custom RSS Feed Management Commands:
  // Usage: /addfeed <url> [topic] [name]
  bot.command("addfeed", async (ctx) => {
    const rawText = ctx.message?.text?.replace(/^\/addfeed\s*/i, "").trim();
    if (!rawText) {
      await ctx.reply(
        "ℹ️ <b>Add Custom RSS Feed:</b>\n\nUsage:\n<code>/addfeed &lt;url&gt; [topic] [name]</code>\n\n<i>Example:</i>\n<code>/addfeed https://vnexpress.net/rss/kinh-doanh.rss kinh_te VnExpress</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const parts = rawText.split(/\s+/);
    const feedUrl = parts[0];
    const topic = parts[1] || "general";
    const feedName = parts.slice(2).join(" ") || new URL(feedUrl).hostname.replace(/^www\./, "");

    if (!feedUrl.startsWith("http://") && !feedUrl.startsWith("https://")) {
      await ctx.reply("❌ Invalid URL. Please provide a full URL starting with http:// or https://");
      return;
    }

    try {
      await addCustomFeed({
        chatId: ctx.chat.id,
        feedUrl,
        feedName,
        topic
      });
      await ctx.reply(
        `✅ <b>Custom RSS Feed Added!</b>\n\n• <b>Name:</b> ${escapeHtml(feedName)}\n• <b>Topic:</b> ${escapeHtml(topic)}\n• <b>URL:</b> <code>${escapeHtml(feedUrl)}</code>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      await ctx.reply(`❌ Failed to save feed: <code>${escapeHtml(err.message)}</code>`, { parse_mode: "HTML" });
    }
  });

  // List all custom feeds
  bot.command(["listfeeds", "feeds"], async (ctx) => {
    const feeds = await getCustomFeeds(ctx.chat.id);
    if (feeds.length === 0) {
      await ctx.reply("📋 <b>No custom RSS feeds configured.</b>\n\nUse <code>/addfeed &lt;url&gt; [topic]</code> to add one.", {
        parse_mode: "HTML"
      });
      return;
    }

    let text = "📋 <b>ACTIVE CUSTOM RSS FEEDS:</b>\n\n";
    const kb = new InlineKeyboard();

    feeds.forEach((f, idx) => {
      text += `<b>${idx + 1}. ${escapeHtml(f.feed_name || "Feed")}</b> [Topic: <code>${escapeHtml(f.topic)}</code>]\n`;
      text += `🔗 <code>${escapeHtml(f.feed_url)}</code>\n\n`;
      kb.text(`🗑 Delete #${idx + 1}`, `delfeed_${f.id}`).row();
    });

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  });

  // Callback to delete custom feed
  bot.callbackQuery(/^delfeed_(\d+)$/, async (ctx) => {
    const feedId = parseInt(ctx.match[1], 10);
    const deleted = await deleteCustomFeed(feedId, ctx.chat.id);
    if (deleted) {
      await ctx.answerCallbackQuery({ text: "Feed deleted successfully!" });
      await ctx.editMessageText("✅ <i>Custom RSS feed removed.</i>", { parse_mode: "HTML" }).catch(() => {});
    } else {
      await ctx.answerCallbackQuery({ text: "Feed not found or already deleted." });
    }
  });

  // Inline Button Callbacks
  bot.callbackQuery("btn_instant", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("instantResearchConversation");
  });

  bot.callbackQuery("btn_add_sub", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter("createSubscriptionConversation");
  });

  bot.callbackQuery("btn_list_subs", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleListSubscriptions(ctx);
  });

  bot.callbackQuery("btn_help", async (ctx) => {
    const langCode = (await getUserLanguage(ctx.chat.id)) || "en";
    await ctx.answerCallbackQuery();
    await ctx.reply(`${t(langCode, "help_title")}\n\n${t(langCode, "help_body")}`, {
      parse_mode: "HTML"
    });
  });

  bot.callbackQuery("btn_change_lang", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(t("en", "select_language_title"), {
      parse_mode: "HTML",
      reply_markup: buildLanguageKeyboard()
    });
  });

  // Toggle subscription callback
  bot.callbackQuery(/^toggle_(\d+)$/, async (ctx) => {
    const subId = parseInt(ctx.match[1], 10);
    const sub = await getSubscriptionById(subId);
    if (!sub) {
      await ctx.answerCallbackQuery({ text: "Schedule not found." });
      return;
    }

    const newStatus = !sub.is_active;
    await toggleSubscriptionStatus(subId, newStatus);
    await ctx.answerCallbackQuery({
      text: newStatus ? "Schedule activated!" : "Schedule paused!"
    });

    await handleListSubscriptions(ctx, true);
  });

  // Delete subscription callback
  bot.callbackQuery(/^delete_(\d+)$/, async (ctx) => {
    const subId = parseInt(ctx.match[1], 10);
    await deleteSubscription(subId);
    await ctx.answerCallbackQuery({ text: "Schedule deleted successfully!" });
    await handleListSubscriptions(ctx, true);
  });

  // Layer 11: Dynamic Feedback Loop Handler
  bot.callbackQuery(/^fb:(good|bad):(.+)$/, async (ctx) => {
    const langCode = (await getUserLanguage(ctx.chat.id)) || "en";
    const isGood = ctx.match[1] === "good";
    const topicKey = ctx.match[2];
    const feedbackType = isGood ? "CONFIRMED" : "DISPUTED";

    try {
      await recordSourceFeedback(ctx.chat.id, topicKey, topicKey, feedbackType);
      if (isGood) {
        await ctx.answerCallbackQuery({
          text: t(langCode, "feedback_confirmed"),
          show_alert: false
        });
        await ctx.editMessageReplyMarkup({
          reply_markup: new InlineKeyboard().text(t(langCode, "feedback_confirmed_btn"), "noop")
        }).catch(() => {});
      } else {
        await ctx.answerCallbackQuery({
          text: t(langCode, "feedback_disputed"),
          show_alert: true
        });
        await ctx.editMessageReplyMarkup({
          reply_markup: new InlineKeyboard().text(t(langCode, "feedback_disputed_btn"), "noop")
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[Feedback Loop Error]:", err);
      await ctx.answerCallbackQuery({ text: "Error recording feedback." }).catch(() => {});
    }
  });

  /**
   * Renders the subscription list dashboard
   */
  async function handleListSubscriptions(ctx, isEdit = false) {
    const subs = await getAllSubscriptions(ctx.chat.id);

    if (subs.length === 0) {
      const emptyText = "📋 <b>No active intelligence schedules.</b>\n\nClick below to add a new schedule:";
      const kb = new InlineKeyboard().text("➕ Add Schedule", "btn_add_sub");

      if (isEdit && ctx.callbackQuery?.message) {
        await ctx.editMessageText(emptyText, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
      } else {
        await ctx.reply(emptyText, { parse_mode: "HTML", reply_markup: kb });
      }
      return;
    }

    let text = `📋 <b>ACTIVE SCHEDULES (${subs.length} active):</b>\n\n`;
    const keyboard = new InlineKeyboard();

    subs.forEach((sub, idx) => {
      const statusIcon = sub.is_active ? "🟢 [ON]" : "🔴 [OFF]";
      const timeStr = `${String(sub.delivery_hour).padStart(2, "0")}:00`;
      const freqStr =
        sub.schedule_type === "specific_date"
          ? formatVietnamDate(sub.specific_date)
          : `Days ${sub.days_of_week}`;

      text += `${idx + 1}. ${statusIcon} <b>${escapeHtml(sub.topic.toUpperCase())}</b>\n`;
      text += `   ⏰ Shift: <code>${timeStr}</code> | Schedule: <code>${freqStr}</code>\n`;
      if (sub.prompt_guidance) {
        text += `   🎯 Guidance: <i>${escapeHtml(sub.prompt_guidance)}</i>\n`;
      }
      text += `\n`;

      keyboard
        .text(`${sub.is_active ? "⏸ Pause" : "▶️ Start"} #${sub.id}`, `toggle_${sub.id}`)
        .text(`🗑 Delete #${sub.id}`, `delete_${sub.id}`)
        .row();
    });

    keyboard.text("➕ Add New Schedule", "btn_add_sub");

    if (isEdit && ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => {});
    } else {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    }
  }

  return {
    bot,
    sendSafeMessage
  };
}

module.exports = {
  createBot
};
