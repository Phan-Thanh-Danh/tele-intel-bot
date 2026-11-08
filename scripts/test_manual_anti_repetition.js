/**
 * scripts/test_manual_anti_repetition.js
 * 
 * Script kiểm thử thủ công cơ chế Chống lặp tin giữa các ca (Phase 5.1).
 * Mô phỏng 2 ca tổng hợp liên tiếp cho cùng 1 chủ đề ("Space Exploration"):
 * 
 * - Ca 1 (Shift 1):
 *     + Tin 1: SpaceX phóng thành công Starship Flight 6 và bắt booster.
 *     + Tin 2: Kính viễn vọng James Webb phát hiện 3 thiên hà cổ đại.
 * 
 * - Ca 2 (Shift 2 - Ca kế tiếp, có tin trùng lặp và tin có diễn biến mới):
 *     + Tin A (Trùng lặp 100%, không có gì mới): SpaceX hoàn thành vụ phóng Starship Flight 6 sáng nay.
 *     + Tin B (Diễn biến mới quan trọng từ sự kiện cũ): FAA bất ngờ mở cuộc điều tra sự cố mất dữ liệu viễn trắc của tầng trên Starship Flight 6.
 *     + Tin C (Tin tức hoàn toàn mới): Blue Origin ấn định ngày phóng tên lửa New Glenn vào tháng tới.
 * 
 * Mục tiêu quan sát:
 *   - Ca 2 phải BỎ QUA Tin A (tin lặp lại nguyên xi).
 *   - Ca 2 phải BÁO CÁO Tin B (vì là diễn biến mới quan trọng: FAA mở điều tra).
 *   - Ca 2 phải BÁO CÁO Tin C (tin mới độc lập).
 */

require("dotenv").config();
const { synthesizeArticles } = require("../lib/synthesizer");

async function runManualTest() {
  console.log("================================================================================");
  console.log("🧪 MANUAL TEST: ANTI-REPETITION ACROSS DIGEST SHIFTS (PHASE 5.1)");
  console.log("================================================================================\n");

  const topic = "Space Exploration & Rocketry";

  // --------------------------------------------------------------------------
  // BƯỚC 1: CA TỔNG HỢP 1 (SHIFT 1) - Chưa có lịch sử trước đó
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("📡 [SHIFT 1] Input Articles (Ca 1: Không có lịch sử gần đây):");
  console.log("--------------------------------------------------------------------------------");
  const shift1Articles = [
    {
      title: "SpaceX completes Starship Flight 6 test with Super Heavy booster catch",
      source: "Reuters",
      link: "https://reuters.com/spacex-flight-6",
      pub_date: "2026-11-08 07:00",
      content_snippet: "SpaceX successfully launched Starship Flight 6 from Texas, successfully guiding the Super Heavy booster back into the launch tower mechanical arms."
    },
    {
      title: "NASA James Webb Space Telescope discovers three massive early universe galaxies",
      source: "BBC Science",
      link: "https://bbc.com/jwst-early-galaxies",
      pub_date: "2026-11-08 07:15",
      content_snippet: "Astronomers using JWST confirmed three massive galaxies existing just 350 million years after the Big Bang, challenging existing galaxy formation models."
    }
  ];

  shift1Articles.forEach((a, i) => {
    console.log(`  [${i + 1}] ${a.title} (${a.source})`);
  });

  console.log("\n⏳ Đang gọi AI tổng hợp Ca 1 (recentEvents = [])...");
  const digest1 = await synthesizeArticles(topic, shift1Articles, null, [], "en", []);

  console.log("\n📋 KẾT QUẢ CA 1 (DIGEST 1):");
  console.log(`Overview: ${digest1.overview || "N/A"}\n`);
  (digest1.events || []).forEach((evt, idx) => {
    console.log(`  Event ${idx + 1}: ${evt.title}`);
    console.log(`  Verdict: ${evt.core_verdict}`);
    console.log(`  Highlights: ${(evt.key_highlights || []).join(" | ")}`);
    console.log("");
  });

  // Trích xuất các sự kiện từ Ca 1 để làm recentEvents cho Ca 2
  const shift1SentEvents = (digest1.events || []).map((evt) => ({
    title: evt.title,
    date: "2026-11-08"
  }));

  console.log("--------------------------------------------------------------------------------");
  console.log("💾 [CHUYỂN GIAO] Các sự kiện đã gửi từ Ca 1 được nạp vào bộ nhớ Ca 2:");
  shift1SentEvents.forEach((e) => console.log(`  • [${e.date}] ${e.title}`));
  console.log("--------------------------------------------------------------------------------\n");

  // --------------------------------------------------------------------------
  // BƯỚC 2: CA TỔNG HỢP 2 (SHIFT 2) - Nạp recentEvents từ Ca 1
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("📡 [SHIFT 2] Input Articles (Ca 2 - Có 1 tin lặp cũ, 1 tin diễn biến mới, 1 tin mới):");
  console.log("--------------------------------------------------------------------------------");
  const shift2Articles = [
    // Tin trùng lặp hoàn toàn với Ca 1 (không có diễn biến mới)
    {
      title: "SpaceX Starship Flight 6 launch review: Booster caught successfully",
      source: "TechCrunch",
      link: "https://techcrunch.com/spacex-flight-6-review",
      pub_date: "2026-11-08 13:00",
      content_snippet: "A recap of SpaceX's Starship Flight 6 which launched earlier today and caught the booster in Texas."
    },
    // Diễn biến mới quan trọng từ sự kiện Starship
    {
      title: "FAA launches urgent investigation into Starship Flight 6 upper-stage telemetry loss",
      source: "Bloomberg",
      link: "https://bloomberg.com/faa-investigates-starship",
      pub_date: "2026-11-08 13:30",
      content_snippet: "The Federal Aviation Administration has opened a formal mishap inquiry after SpaceX Starship lost telemetry during ocean re-entry, delaying upcoming test schedules."
    },
    // Tin tức hoàn toàn mới độc lập
    {
      title: "Blue Origin targets December for inaugural New Glenn heavy rocket launch",
      source: "Ars Technica",
      link: "https://arstechnica.com/new-glenn-launch-date",
      pub_date: "2026-11-08 13:45",
      content_snippet: "Jeff Bezos's Blue Origin officially announced that its New Glenn orbital rocket has been integrated and is scheduled for maiden flight next month."
    }
  ];

  shift2Articles.forEach((a, i) => {
    console.log(`  [${i + 1}] ${a.title} (${a.source})`);
  });

  console.log("\n⏳ Đang gọi AI tổng hợp Ca 2 (recentEvents được kích hoạt)...");
  const digest2 = await synthesizeArticles(topic, shift2Articles, null, [], "en", shift1SentEvents);

  console.log("\n📋 KẾT QUẢ CA 2 (DIGEST 2 - CÓ CHỐNG LẶP TIN):");
  console.log(`Overview: ${digest2.overview || "N/A"}\n`);
  (digest2.events || []).forEach((evt, idx) => {
    console.log(`  Event ${idx + 1}: ${evt.title}`);
    console.log(`  Verdict: ${evt.core_verdict}`);
    console.log(`  Highlights: ${(evt.key_highlights || []).join(" | ")}`);
    console.log("");
  });

  // --------------------------------------------------------------------------
  // BƯỚC 3: ĐỐI CHIẾU KIỂM TRA MẮT THƯỜNG (VERIFICATION CHECK)
  // --------------------------------------------------------------------------
  console.log("================================================================================");
  console.log("🔎 KIỂM TRA ĐỐI CHIẾU BẰNG MẮT THƯỜNG:");
  console.log("================================================================================");
  const titles2 = (digest2.events || []).map((e) => (e.title || "").toLowerCase()).join(" ");
  const verdicts2 = (digest2.events || []).map((e) => (e.core_verdict || "").toLowerCase()).join(" ");
  const allText2 = `${titles2} ${verdicts2}`;

  const hasFaaInvestigation = allText2.includes("faa") || allText2.includes("investig") || allText2.includes("telemetry");
  const hasNewGlenn = allText2.includes("blue origin") || allText2.includes("new glenn");
  const repeatedBoosterOnly = allText2.includes("booster catch") && !hasFaaInvestigation;

  console.log(`1. Tin lặp nguyên xi (SpaceX Starship Flight 6 booster catch không có tin mới): ${repeatedBoosterOnly ? "❌ BỊ LẶP LẠI (LỖI)" : "✅ ĐÃ ĐƯỢC LƯỢC BỎ THÀNH CÔNG"}`);
  console.log(`2. Diễn biến mới quan trọng (FAA mở cuộc điều tra sự cố Starship): ${hasFaaInvestigation ? "✅ ĐÃ BÁO CÁO PHẦN MỚI THÀNH CÔNG" : "⚠️ CẦN KIỂM TRA LẠI"}`);
  console.log(`3. Tin tức hoàn toàn mới (Blue Origin New Glenn maiden flight): ${hasNewGlenn ? "✅ ĐÃ BÁO CÁO ĐẦY ĐỦ" : "⚠️ CẦN KIỂM TRA LẠI"}`);
  console.log("================================================================================\n");
}

runManualTest().catch((err) => {
  console.error("❌ Test script error:", err);
  process.exit(1);
});
