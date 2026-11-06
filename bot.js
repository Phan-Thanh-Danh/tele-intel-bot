const { Bot, session, InlineKeyboard } = require("grammy");
const { conversations, createConversation } = require("@grammyjs/conversations");
const { scrapeTopic } = require("./lib/scraper");
const { synthesizeArticles } = require("./lib/gemini");
const {
  chunkInstantResearchToPages,
  escapeHtml
} = require("./lib/chunker");
const {
  createSubscription,
  getAllSubscriptions,
  getSubscriptionById,
  toggleSubscriptionStatus,
  deleteSubscription
} = require("./lib/db_operations");

/**
 * Creates and configures the Telegram Bot instance.
 * Adheres strictly to SRP: Telegram UI, conversation flow handling, and user command routing only.
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
      return; // Immediate halt: Do not proceed
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
      throw error;
    }
  }

  // ============================================================================
  // Conversations
  // ============================================================================

  /**
   * Conversation: Instant On-Demand Research
   */
  async function instantResearchConversation(conversation, ctx) {
    await ctx.reply(
      "⚡ <b>CÀO & TỔNG HỢP TỨC THÌ</b>\n\n" +
      "Vui lòng nhập từ khóa hoặc chủ đề bạn muốn tổng hợp tin tức ngay bây giờ (Ví dụ: <i>Node.js, AI Agents, Thị trường Vàng</i>):",
      { parse_mode: "HTML" }
    );

    const topicMsg = await conversation.wait();
    const topic = topicMsg.message?.text?.trim();

    if (!topic) {
      await ctx.reply("❌ Đã hủy thao tác: Không nhận được từ khóa hợp lệ.", { parse_mode: "HTML" });
      return;
    }

    const statusMsg = await ctx.reply(
      `⏳ <b>Đang thu thập dữ liệu cho chủ đề:</b> <i>${escapeHtml(topic)}</i>...`,
      { parse_mode: "HTML" }
    );

    try {
      // Step 1: Scrape
      const articles = await conversation.external(() => scrapeTopic(topic));

      if (articles.length === 0) {
        await bot.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `⚠️ Không tìm thấy bài báo hoặc tin tức mới nào cho chủ đề: <i>${escapeHtml(topic)}</i>.`,
          { parse_mode: "HTML" }
        ).catch(() => {});
        return;
      }

      await bot.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `🤖 Đã thu thập được <b>${articles.length}</b> bài viết. Đang chuyển tới Gemini để phân tích...`,
        { parse_mode: "HTML" }
      ).catch(() => {});

      // Step 2: Gemini Synthesis
      const summary = await conversation.external(() => synthesizeArticles(topic, articles));

      // Step 3: Chunk and send
      const pages = chunkInstantResearchToPages(topic, summary);

      // Delete status message
      await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

      for (let i = 0; i < pages.length; i++) {
        await sendSafeMessage(ctx.chat.id, pages[i]);
        if (i < pages.length - 1) {
          await delay(1000);
        }
      }
    } catch (err) {
      console.error("[Instant Research Error]:", err);
      await ctx.reply(
        `❌ <b>Lỗi tổng hợp tin:</b> <code>${escapeHtml(err.message)}</code>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    }
  }

  /**
   * Conversation: Create Subscription Schedule
   */
  async function createSubscriptionConversation(conversation, ctx) {
    await ctx.reply(
      "➕ <b>THÊM LỊCH THEO DÕI TIN TỨC MỚI</b>\n\n" +
      "<b>Bước 1/4:</b> Nhập từ khóa chủ đề (Topic) cần theo dõi định kỳ:\n" +
      "(Ví dụ: <i>AI, Node.js, Bất động sản, Bitcoin</i>)",
      { parse_mode: "HTML" }
    );

    const topicMsg = await conversation.wait();
    const topic = topicMsg.message?.text?.trim();
    if (!topic) {
      await ctx.reply("❌ Đã hủy tạo lịch: Từ khóa không hợp lệ.");
      return;
    }

    await ctx.reply(
      `<b>Bước 2/4:</b> Nhập hướng dẫn phân tích riêng cho Gemini (Topic Guidance).\n\n` +
      `<i>Ví dụ: "Tập trung tin tức chuyển nhượng", "Chú trọng cập nhật bảo mật CVE"...</i>\n` +
      `Hoặc gửi <code>skip</code> / <code>bo qua</code> để bỏ qua bước này:`,
      { parse_mode: "HTML" }
    );

    const guidanceMsg = await conversation.wait();
    const rawGuidance = guidanceMsg.message?.text?.trim();
    let promptGuidance = null;
    if (rawGuidance && !["skip", "bo qua", "bỏ qua", "/skip"].includes(rawGuidance.toLowerCase())) {
      promptGuidance = rawGuidance;
    }

    await ctx.reply(
      "<b>Bước 3/4:</b> Nhập khung giờ nhận bản tin (từ <code>0</code> đến <code>23</code> theo giờ Việt Nam):\n" +
      "<i>Ví dụ: Nhập <code>8</code> nếu muốn nhận vào 8h sáng, hoặc <code>18</code> nếu muốn nhận vào 18h chiều.</i>",
      { parse_mode: "HTML" }
    );

    const hourMsg = await conversation.wait();
    const rawHour = hourMsg.message?.text?.trim();
    const deliveryHour = parseInt(rawHour, 10);

    if (isNaN(deliveryHour) || deliveryHour < 0 || deliveryHour > 23) {
      await ctx.reply("❌ Khung giờ không hợp lệ (phải là số nguyên từ 0 đến 23). Đã hủy tạo lịch.");
      return;
    }

    await ctx.reply(
      "<b>Bước 4/4:</b> Chọn tần suất nhận tin:\n" +
      "1️⃣ Nhập <code>1</code>: Hàng ngày (Thứ 2 - Chủ nhật)\n" +
      "2️⃣ Nhập <code>2</code>: Ngày trong tuần (Thứ 2 - Thứ 6)\n" +
      "3️⃣ Nhập <code>3</code>: Cuối tuần (Thứ 7 & Chủ nhật)\n" +
      "4️⃣ Hoặc nhập ngày cụ thể theo định dạng <code>YYYY-MM-DD</code> (Ví dụ: <code>2026-11-10</code>)",
      { parse_mode: "HTML" }
    );

    const freqMsg = await conversation.wait();
    const freqInput = freqMsg.message?.text?.trim();

    let scheduleType = "recurring";
    let daysOfWeek = "1,2,3,4,5,6,7";
    let specificDate = null;

    if (freqInput === "1") {
      daysOfWeek = "1,2,3,4,5,6,7";
    } else if (freqInput === "2") {
      daysOfWeek = "1,2,3,4,5";
    } else if (freqInput === "3") {
      daysOfWeek = "6,7";
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(freqInput)) {
      scheduleType = "specific_date";
      specificDate = freqInput;
    } else {
      await ctx.reply("❌ Tần suất không hợp lệ. Đã hủy tạo lịch.");
      return;
    }

    try {
      const subId = await conversation.external(() =>
        createSubscription({
          chatId: ctx.chat.id,
          topic,
          promptGuidance,
          scheduleType,
          daysOfWeek,
          specificDate,
          deliveryHour
        })
      );

      const scheduleDesc =
        scheduleType === "specific_date"
          ? `Một lần vào ngày: <code>${specificDate}</code>`
          : `Định kỳ các ngày: <code>${daysOfWeek}</code>`;

      await ctx.reply(
        `✅ <b>ĐÃ THIẾT LẬP LỊCH THEO DÕI THÀNH CÔNG!</b>\n\n` +
        `🆔 ID: <code>${subId}</code>\n` +
        `📌 Chủ đề: <b>${escapeHtml(topic)}</b>\n` +
        `⏰ Giờ gửi: <b>${deliveryHour}:00</b> (Giờ VN)\n` +
        `📅 Tần suất: ${scheduleDesc}\n` +
        `🎯 Chỉ đạo riêng: <i>${escapeHtml(promptGuidance || "Không có")}</i>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("[Create Subscription Error]:", err);
      await ctx.reply(`❌ Lỗi khi lưu vào cơ sở dữ liệu: ${escapeHtml(err.message)}`);
    }
  }

  bot.use(createConversation(instantResearchConversation));
  bot.use(createConversation(createSubscriptionConversation));

  // ============================================================================
  // Command & UI Routing Handlers
  // ============================================================================

  function buildMainMenuKeyboard() {
    return new InlineKeyboard()
      .text("⚡ Cào tức thì", "btn_instant")
      .text("➕ Thêm lịch", "btn_add_sub")
      .row()
      .text("📋 Danh sách lịch", "btn_list_subs")
      .text("ℹ️ Trợ giúp", "btn_help");
  }

  bot.command("start", async (ctx) => {
    const welcomeText =
      `🛡️ <b>HỆ THỐNG TÌNH BÁO & TỔNG HỢP TIN TỨC TỰ ĐỘNG</b>\n\n` +
      `Xin chào Admin! Hệ thống đang hoạt động 24/7 để giám sát, thu thập và phân tích dữ liệu từ Google News và Reddit qua Gemini AI.\n\n` +
      `Chọn một tính năng dưới đây để bắt đầu:`;

    await ctx.reply(welcomeText, {
      parse_mode: "HTML",
      reply_markup: buildMainMenuKeyboard()
    });
  });

  bot.command("help", async (ctx) => {
    const helpText =
      `📖 <b>DANH SÁCH LỆNH ĐIỀU HÀNH:</b>\n\n` +
      `/start - Bật menu điều khiển chính\n` +
      `/instant - Tổng hợp tin tức nhanh theo chủ đề bất kỳ\n` +
      `/add - Thiết lập ca theo dõi tin tức mới\n` +
      `/list - Xem và quản lý các lịch đang hoạt động\n` +
      `/help - Hướng dẫn sử dụng`;

    await ctx.reply(helpText, { parse_mode: "HTML" });
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
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `💡 <b>Cơ chế hoạt động của Bot:</b>\n` +
      `- <b>Cào dữ liệu:</b> Tự động cào mỗi 30 phút một lần.\n` +
      `- <b>Phân tích:</b> Trước mỗi giờ ca phát hành (H-1), Gemini sẽ tổng hợp bài viết mới.\n` +
      `- <b>Gửi tin:</b> Đúng đầu giờ ca, hệ thống chia nhỏ trang HTML và phát hành cho bạn.\n` +
      `- <b>An toàn:</b> Không bao giờ trùng tin giữa các ca nhờ Watermark <code>last_delivered_at</code>.`,
      { parse_mode: "HTML" }
    );
  });

  // Toggle active/inactive subscription callback
  bot.callbackQuery(/^toggle_(\d+)$/, async (ctx) => {
    const subId = parseInt(ctx.match[1], 10);
    const sub = await getSubscriptionById(subId);

    if (!sub) {
      await ctx.answerCallbackQuery({ text: "Không tìm thấy lịch theo dõi!" });
      return;
    }

    const newStatus = !sub.is_active;
    await toggleSubscriptionStatus(subId, newStatus);
    await ctx.answerCallbackQuery({
      text: newStatus ? "Đã bật kích hoạt lịch!" : "Đã tạm dừng lịch!"
    });

    await handleListSubscriptions(ctx, true);
  });

  // Delete subscription callback
  bot.callbackQuery(/^delete_(\d+)$/, async (ctx) => {
    const subId = parseInt(ctx.match[1], 10);
    await deleteSubscription(subId);
    await ctx.answerCallbackQuery({ text: "Đã xóa lịch theo dõi thành công!" });
    await handleListSubscriptions(ctx, true);
  });

  /**
   * Renders the subscription list dashboard
   */
  async function handleListSubscriptions(ctx, isEdit = false) {
    const subs = await getAllSubscriptions(ctx.chat.id);

    if (subs.length === 0) {
      const emptyText = "📋 <b>Hiện tại bạn chưa có lịch theo dõi nào.</b>\n\nBấm nút bên dưới để thêm lịch mới:";
      const kb = new InlineKeyboard().text("➕ Thêm lịch ngay", "btn_add_sub");

      if (isEdit && ctx.callbackQuery?.message) {
        await ctx.editMessageText(emptyText, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
      } else {
        await ctx.reply(emptyText, { parse_mode: "HTML", reply_markup: kb });
      }
      return;
    }

    let text = `📋 <b>DANH SÁCH LỊCH THEO DÕI (${subs.length} lịch):</b>\n\n`;
    const keyboard = new InlineKeyboard();

    subs.forEach((sub, idx) => {
      const statusIcon = sub.is_active ? "🟢 [BẬT]" : "🔴 [TẮT]";
      const timeStr = `${String(sub.delivery_hour).padStart(2, "0")}:00`;
      const freqStr =
        sub.schedule_type === "specific_date"
          ? sub.specific_date?.toISOString?.()?.slice(0, 10) || sub.specific_date
          : `Thứ ${sub.days_of_week}`;

      text += `${idx + 1}. ${statusIcon} <b>${escapeHtml(sub.topic.toUpperCase())}</b>\n`;
      text += `   ⏰ Ca: <code>${timeStr}</code> | Lịch: <code>${freqStr}</code>\n`;
      if (sub.prompt_guidance) {
        text += `   🎯 Chỉ đạo: <i>${escapeHtml(sub.prompt_guidance)}</i>\n`;
      }
      text += `\n`;

      keyboard
        .text(`${sub.is_active ? "⏸ Tắt" : "▶️ Bật"} #${sub.id}`, `toggle_${sub.id}`)
        .text(`🗑 Xóa #${sub.id}`, `delete_${sub.id}`)
        .row();
    });

    keyboard.text("➕ Thêm lịch mới", "btn_add_sub");

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
