/**
 * scripts/test_manual_anti_repetition.js
 * 
 * Script kiểm thử thực tế cơ chế Chống lặp tin (Phase 5.1 & Hard Zero-Cost Guard).
 * Kịch bản phức tạp (Hard Scenario):
 * 
 * - Lịch sử đã gửi các ca trước (Recent Events):
 *   1. [2026-11-08] Arsenal leads Chelsea 1-0 at halftime (Saka 25')
 *   2. [2026-11-08] Anthropic closes $2.5 billion funding round at $20 billion valuation
 *   3. [2026-11-07] SpaceX Falcon 9 launches 24 Starlink satellites into orbit
 * 
 * - Đầu vào ca hiện tại (6 bài báo):
 *   + Bài 1 & 2: Hai bài viết cùng nói về kết quả hiệp 1 (Arsenal dẫn 1-0) -> Trùng lặp cũ, không có gì mới.
 *   + Bài 3: Diễn biến mới về tỉ số (Trận đấu kết thúc 1-1, Palmer gỡ hòa phút 88) -> BẮT BUỘC BÁO CÁO.
 *   + Bài 4: Diễn biến mới thay đổi con số (Anthropic nâng vòng gọi vốn lên $3.2 tỷ, định giá $25 tỷ) -> BẮT BUỘC BÁO CÁO.
 *   + Bài 5: Tin lặp SpaceX phóng 24 vệ tinh Starlink sáng nay -> PHẢI BỎ QUA.
 *   + Bài 6: Tin hoàn toàn mới độc lập (Boeing đạt thỏa thuận sơ bộ chấm dứt đình công) -> BẮT BUỘC BÁO CÁO.
 * 
 * Toàn bộ kết quả kiểm tra ĐƯỢC ĐỐI CHIẾU TRỰC TIẾP BẰNG CODE DỰA TRÊN TIÊU ĐỀ/NỘI DUNG AI SINH RA (Title/Verdict Analysis).
 */

require("dotenv").config();
const { synthesizeArticles } = require("../lib/synthesizer");

async function runHardAntiRepetitionTest() {
  console.log("================================================================================");
  console.log("🧪 COMPLEX MANUAL SCENARIO: ANTI-REPETITION & ZERO-COST GUARD");
  console.log("================================================================================\n");

  const topic = "Global Sports, Tech & Business Intelligence";

  // 1. Lịch sử đã gửi trước đó (3 sự kiện từ các ca trước)
  const recentEvents = [
    { title: "Arsenal leads Chelsea 1-0 at halftime (Saka 25')", date: "2026-11-08" },
    { title: "Anthropic closes $2.5 billion funding round at $20 billion valuation", date: "2026-11-08" },
    { title: "SpaceX Falcon 9 launches 24 Starlink satellites into orbit", date: "2026-11-07" }
  ];

  console.log("📜 LỊCH SỬ SỰ KIỆN ĐÃ GỬI TRƯỚC ĐÓ (RECENT EVENTS):");
  recentEvents.forEach((e) => console.log(`  • [${e.date}] ${e.title}`));
  console.log("");

  // 2. Danh sách 6 bài báo đầu vào của ca hiện tại
  const articles = [
    // Bài 1 & 2: Hai báo cùng đưa lại tin hiệp 1 (không có gì mới)
    {
      title: "Arsenal holds 1-0 lead over Chelsea at halftime in derby",
      source: "BBC Sport",
      link: "https://bbc.com/sport/arsenal-halftime",
      content_snippet: "Arsenal entered the break with a 1-0 advantage thanks to Bukayo Saka's first-half penalty."
    },
    {
      title: "Halftime report: Saka penalty puts Arsenal ahead 1-0 against Chelsea",
      source: "Reuters",
      link: "https://reuters.com/sports/arsenal-chelsea-break",
      content_snippet: "Chelsea trailed 1-0 after 45 minutes as Arsenal controlled possession at Stamford Bridge."
    },
    // Bài 3: Diễn biến mới quan trọng về tỉ số (Full-time 1-1)
    {
      title: "Full-Time: Chelsea secures dramatic 1-1 draw against Arsenal with Palmer equalizer",
      source: "Sky Sports",
      link: "https://skysports.com/football/chelsea-arsenal-ft",
      content_snippet: "Cole Palmer scored in the 88th minute to rescue a point as Chelsea drew 1-1 with Arsenal in a fiery London derby."
    },
    // Bài 4: Diễn biến mới thay đổi con số (Vốn nâng lên $3.2B, định giá $25B)
    {
      title: "Anthropic expands funding round to $3.2 billion at revised $25 billion valuation",
      source: "Wall Street Journal",
      link: "https://wsj.com/tech/anthropic-expanded-funding",
      content_snippet: "Regulatory filings reveal Anthropic expanded its financing round from $2.5 billion to $3.2 billion, raising its post-money valuation to $25 billion."
    },
    // Bài 5: Tin lặp lại nguyên xi về SpaceX (không có gì mới)
    {
      title: "SpaceX successfully deployed 24 Starlink satellites earlier today",
      source: "TechCrunch",
      link: "https://techcrunch.com/space/spacex-starlink-recap",
      content_snippet: "A recap of SpaceX's routine orbital mission sending 24 Starlink internet spacecraft to low Earth orbit."
    },
    // Bài 6: Tin tức hoàn toàn mới độc lập (Boeing đình công)
    {
      title: "Boeing reaches tentative contract deal with union to end 7-week strike",
      source: "Bloomberg",
      link: "https://bloomberg.com/news/boeing-labor-agreement",
      content_snippet: "Boeing and the International Association of Machinists reached a tentative agreement featuring a 38% wage hike over four years."
    }
  ];

  console.log(`📡 ĐẦU VÀO CA HIỆN TẠI (${articles.length} bài viết):`);
  articles.forEach((a, i) => console.log(`  [${i + 1}] ${a.title} (${a.source})`));

  console.log("\n⏳ Đang gọi AI tổng hợp (với chốt chặn Zero-Cost Guard & Giới hạn tối đa 2 request)...");
  const startTime = Date.now();
  const digest = await synthesizeArticles(topic, articles, null, [], "en", recentEvents, "scheduled");
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n📋 KẾT QUẢ TỔNG HỢP (${durationSec}s):`);
  console.log(`Overview: ${digest.overview}\n`);
  (digest.events || []).forEach((evt, idx) => {
    console.log(`  Event ${idx + 1}: ${evt.title}`);
    console.log(`  Verdict: ${evt.core_verdict}`);
    console.log(`  Highlights: ${(evt.key_highlights || []).join(" | ")}`);
    console.log(`  Sources: ${(evt.sources || []).map((s) => s.name).join(", ")}`);
    console.log("");
  });

  // --------------------------------------------------------------------------
  // ĐỐI CHIẾU KẾT QUẢ TRỰC TIẾP TỪ TIÊU ĐỀ & NỘI DUNG (DYNAMIC CODE COMPARISON)
  // --------------------------------------------------------------------------
  console.log("================================================================================");
  console.log("🔎 ĐỐI CHIẾU KẾT QUẢ BẰNG CODE (TỪ DỮ LIỆU THỰC TẾ CỦA AI, KHÔNG IN CỐ ĐỊNH):");
  console.log("================================================================================");

  const events = digest.events || [];
  const eventTexts = events.map((e) => `${e.title} ${e.core_verdict} ${(e.key_highlights || []).join(" ")}`.toLowerCase());
  const combinedText = eventTexts.join(" ");

  // 1. Kiểm tra cập nhật tỉ số (Arsenal - Chelsea 1-1 / draw / Palmer)
  const hasScoreUpdate = eventTexts.some((txt) =>
    (txt.includes("1-1") || txt.includes("draw") || txt.includes("palmer") || txt.includes("equaliz")) &&
    txt.includes("chelsea")
  );

  // 2. Kiểm tra thay đổi con số đầu tư ($3.2 tỷ / $25 tỷ)
  const hasFiguresChange = eventTexts.some((txt) =>
    (txt.includes("3.2") || txt.includes("25") || txt.includes("expand")) &&
    txt.includes("anthropic")
  );

  // 3. Kiểm tra tin tức mới độc lập (Boeing thỏa thuận chấm dứt đình công)
  const hasNewStory = eventTexts.some((txt) =>
    txt.includes("boeing") || txt.includes("strike") || txt.includes("machinist")
  );

  // 4. Kiểm tra tin hiệp 1 cũ (dẫn 1-0) có bị lặp lại mà không kèm kết quả hòa không
  const hasStaleHalftimeOnly = eventTexts.some((txt) =>
    txt.includes("halftime") && txt.includes("1-0") && !txt.includes("1-1") && !txt.includes("draw")
  );

  // 5. Kiểm tra tin Starlink cũ có bị đưa lại không
  const hasStaleStarlink = eventTexts.some((txt) =>
    txt.includes("starlink") || txt.includes("falcon 9")
  );

  console.log(`1. Cập nhật tỉ số trận đấu (Arsenal - Chelsea 1-1 / Palmer gỡ hòa):`);
  console.log(`   -> Kết quả: ${hasScoreUpdate ? "✅ ĐÃ BÁO CÁO ĐÚNG DIỄN BIẾN MỚI" : "❌ KHÔNG TÌM THẤY TỈ SỐ MỚI"}`);

  console.log(`2. Cập nhật thay đổi con số (Anthropic nâng lên $3.2B / định giá $25B):`);
  console.log(`   -> Kết quả: ${hasFiguresChange ? "✅ ĐÃ BÁO CÁO ĐÚNG CON SỐ MỚI" : "❌ CHƯA CẬP NHẬT CON SỐ MỚI"}`);

  console.log(`3. Tin tức mới độc lập (Boeing đạt thỏa thuận chấm dứt đình công):`);
  console.log(`   -> Kết quả: ${hasNewStory ? "✅ ĐÃ BÁO CÁO ĐẦY ĐỦ" : "❌ THIẾU TIN MỚI"}`);

  console.log(`4. Lọc bỏ tin hiệp 1 cũ (Arsenal dẫn 1-0 không có kết quả mới):`);
  console.log(`   -> Kết quả: ${!hasStaleHalftimeOnly ? "✅ ĐÃ LỌC BỎ THÀNH CÔNG" : "❌ BỊ LẶP TIN CŨ"}`);

  console.log(`5. Lọc bỏ tin vệ tinh Starlink cũ không có gì mới:`);
  console.log(`   -> Kết quả: ${!hasStaleStarlink ? "✅ ĐÃ LỌC BỎ THÀNH CÔNG" : "❌ BỊ LẶP TIN CŨ"}`);

  console.log("================================================================================\n");

  const allPassed = hasScoreUpdate && hasFiguresChange && hasNewStory && !hasStaleHalftimeOnly && !hasStaleStarlink;
  if (!allPassed) {
    console.warn("⚠️ Một số tiêu chí lọc tin cần xem xét lại.");
  } else {
    console.log("🎉 TOÀN BỘ CÁC TIÊU CHÍ ĐỐI CHIẾU CHỐNG LẶP & DIỄN BIẾN MỚI ĐỀU ĐẠT CHUẨN!");
  }
}

runHardAntiRepetitionTest().catch((err) => {
  console.error("❌ Test script error:", err.message);
  process.exit(1);
});
