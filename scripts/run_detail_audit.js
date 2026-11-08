/**
 * scripts/run_detail_audit.js
 *
 * Budget-aware detail audit runner.
 * - Checks today's request_count before calling synthesizeArticles.
 * - If count >= 30, prints "BUDGET EXCEEDED - cannot run" and exits.
 * - Otherwise calls synthesizeArticles and runs detailAudit on the output.
 */

"use strict";

require("dotenv").config();
const { synthesizeArticles } = require("../lib/synthesizer");
const { detailAudit } = require("../lib/detailAudit");
const { pool, closePool } = require("../lib/db");

// Vietnamese test data (from test_vietnamese_anti_repetition.js)
const TOPIC = "Công nghệ & Kinh tế Việt Nam";
const TARGET_LANG = "vi";

const PREVIOUS_EVENTS = [
  { title: "VinFast khánh thành giai đoạn 1 nhà máy sản xuất pin tại Hải Phòng (công suất 5 GWh/năm)", date: "2026-11-08" },
  { title: "Viettel phát sóng thử nghiệm trạm 5G Open RAN đầu tiên tại Hà Nội", date: "2026-11-07" },
  { title: "FPT Software ký hợp đồng 50 triệu USD tư vấn chuyển đổi số tại Nhật Bản", date: "2026-11-06" }
];

const CURRENT_ARTICLES = [
  {
    title: "VinFast tổ chức lễ khánh thành nhà máy sản xuất pack pin giai đoạn 1 tại Hải Phòng",
    source: "VnExpress",
    link: "https://vnexpress.net/vinfast-khanh-thanh-nha-may-pin-giai-doan-1-4700001.html",
    content_snippet: "Sáng nay VinFast chính thức đưa vào vận hành giai đoạn 1 nhà máy pin tại tổ hợp Cát Hải, Hải Phòng với công suất thiết kế 5 GWh/năm."
  },
  {
    title: "VinFast nhận thêm 10.000 đơn hàng pin và công bố khởi công giai đoạn 2 nâng công suất lên 12 GWh/năm",
    source: "Tuổi Trẻ",
    link: "https://tuoitre.vn/vinfast-khoi-cong-giai-doan-2-nha-may-pin-12-gwh-4700002.html",
    content_snippet: "Sau khi hoàn tất giai đoạn 1, VinFast công bố đã nhận thêm 10.000 đơn hàng xuất khẩu và chính thức khởi công giai đoạn 2, nâng tổng công suất nhà máy lên 12 GWh mỗi năm."
  },
  {
    title: "Hà Nội ghi nhận trạm 5G Open RAN đầu tiên do Viettel tự nghiên cứu phát sóng thành công",
    source: "Dân Trí",
    link: "https://dantri.com.vn/suc-manh-so/viettel-phat-song-thu-nghiem-5g-open-ran-4700003.html",
    content_snippet: "Viettel vừa hoàn tất đợt phát sóng thử nghiệm kỹ thuật trạm 5G Open RAN đầu tiên tại khu vực quận Cầu Giấy, Hà Nội."
  },
  {
    title: "Bộ Thông tin và Truyền thông chính thức cấp giấy phép thương mại hóa tần số 5G cho Viettel",
    source: "VietnamNet",
    link: "https://vietnamnet.vn/bo-tttt-cap-phep-thuong-mai-hoa-5g-cho-viettel-4700004.html",
    content_snippet: "Chiều nay Bộ TT&TT đã chính thức trao giấy phép thiết lập mạng và cung cấp dịch vụ viễn thông 5G thương mại cho Viettel sau quá trình thử nghiệm đạt tiêu chuẩn."
  },
  {
    title: "NVIDIA cùng Trung tâm Đổi mới sáng tạo Quốc gia (NIC) khai trương Trung tâm nghiên cứu AI 100 triệu USD",
    source: "Znews",
    link: "https://znews.vn/nvidia-nic-khai-truong-trung-tam-ai-100-trieu-usd-4700005.html",
    content_snippet: "Tập đoàn công nghệ NVIDIA phối hợp cùng NIC khai trương trung tâm nghiên cứu và ươm tạo tài năng trí tuệ nhân tạo tại Hà Nội với quy mô vốn đầu tư 100 triệu USD."
  },
  {
    title: "Các hãng hàng không nội địa bắt đầu mở bán vé máy bay Tết Nguyên đán 2027",
    source: "Tiền Phong",
    link: "https://tienphong.vn/mo-ban-ve-may-bay-tet-2027-4700006.html",
    content_snippet: "Các hãng hàng không Việt Nam bắt đầu mở bán đợt 1 vé máy bay dịp Tết với hơn 2 triệu ghế trên các đường bay trục chính."
  }
];

const BUDGET_THRESHOLD = 30;

async function checkBudget() {
  const todayVietnam = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const [rows] = await pool.query(
    "SELECT request_count FROM llm_daily_usage WHERE usage_date = ?",
    [todayVietnam]
  );
  return rows.length > 0 ? rows[0].request_count : 0;
}

async function main() {
  console.log("=== DETAIL AUDIT RUNNER (Budget-Aware) ===");

  let requestCount;
  try {
    requestCount = await checkBudget();
    console.log(`Today's request_count: ${requestCount}`);
  } catch (err) {
    console.error("Failed to check budget:", err.message);
    await closePool();
    process.exit(1);
  }

  if (requestCount >= BUDGET_THRESHOLD) {
    console.log(`BUDGET EXCEEDED - cannot run (${requestCount} >= ${BUDGET_THRESHOLD})`);
    await closePool();
    return;
  }

  console.log(`Budget OK (${requestCount} < ${BUDGET_THRESHOLD}). Running synthesizeArticles...`);

  let digest;
  try {
    digest = await synthesizeArticles(
      TOPIC,
      CURRENT_ARTICLES,
      "Ưu tiên các bước tiến công nghệ, hợp tác đầu tư và chính sách kinh tế.",
      PREVIOUS_EVENTS,
      TARGET_LANG,
      PREVIOUS_EVENTS,
      "scheduled"
    );
  } catch (err) {
    console.error("synthesizeArticles failed:", err.message);
    await closePool();
    process.exit(1);
  }

  console.log("\n=== SYNTHESIS OUTPUT ===");
  console.log("Overview:", digest.overview);
  (digest.events || []).forEach((evt, i) => {
    console.log(`\nEvent ${i + 1}: ${evt.title}`);
    console.log(`  Verdict: ${evt.core_verdict}`);
    console.log(`  Highlights: ${(evt.key_highlights || []).join(" | ")}`);
  });

  console.log("\n=== DETAIL AUDIT REPORT (tokens not found in any source) ===");
  console.log("NOTE: This is for human review only - not a pass/fail gate.");
  const report = detailAudit(digest, CURRENT_ARTICLES, PREVIOUS_EVENTS);
  if (report.length === 0) {
    console.log("No unsourced tokens found - all words and numbers appear in source articles.");
  } else {
    console.log(`Found ${report.length} tokens not in source corpus:`);
    for (const item of report) {
      console.log(`  [${item.type}] "${item.word}"`);
    }
  }

  await closePool();
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
