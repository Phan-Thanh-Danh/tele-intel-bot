/**
 * Kịch bản kiểm thử Tiếng Việt thực tế: Chống lặp tin giữa các ca (Anti-repetition across shifts)
 * Chạy 2 lần độc lập qua hàm synthesizeArticles với Free Model được bảo vệ bởi Zero-Cost Guard.
 * Đánh giá đối soát tự động bằng code với cơ chế kiểm tra nghiêm ngặt (Strict keyword & delta verification).
 */
const { synthesizeArticles } = require("../lib/synthesizer");

const TOPIC = "Công nghệ & Kinh tế Việt Nam";
const TARGET_LANG = "vi";

// 1. Danh sách các sự kiện đã gửi ca trước (Lịch sử 7 ngày qua)
const PREVIOUS_EVENTS = [
  {
    title: "VinFast khánh thành giai đoạn 1 nhà máy sản xuất pin tại Hải Phòng (công suất 5 GWh/năm)",
    date: "2026-11-08"
  },
  {
    title: "Viettel phát sóng thử nghiệm trạm 5G Open RAN đầu tiên tại Hà Nội",
    date: "2026-11-07"
  },
  {
    title: "FPT Software ký hợp đồng 50 triệu USD tư vấn chuyển đổi số tại Nhật Bản",
    date: "2026-11-06"
  }
];

// 2. Danh sách bài viết mới thu thập được trong ca hiện tại (6 bài)
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

/**
 * Hàm kiểm tra nghiêm ngặt từng sự kiện đơn lẻ:
 * Bắt lỗi nếu một sự kiện cũ được viết lại với lời văn khác nhưng KHÔNG có thông tin mới nào.
 */
function inspectEventForUnwantedRepetition(event) {
  const text = (
    (event.title || "") + " " +
    (event.core_verdict || "") + " " +
    (event.key_highlights || []).join(" ")
  ).toLowerCase();

  // 1. Kiểm tra chủ đề VinFast pin:
  // Nếu đề cập tới VinFast và sản xuất pin/Hải Phòng/5 GWh
  const isVinfastBattery = text.includes("vinfast") && (text.includes("pin") || text.includes("hải phòng") || text.includes("cát hải"));
  if (isVinfastBattery) {
    // Phải có ít nhất 1 diễn biến mới: "giai đoạn 2", "12 gwh", hoặc "10.000 đơn"
    const hasNewDelta = text.includes("giai đoạn 2") || text.includes("12 gwh") || text.includes("10.000");
    if (!hasNewDelta) {
      return {
        passed: false,
        reason: "Lặp lại sự kiện khánh thành pin VinFast cũ mà không có diễn biến mới (thiếu giai đoạn 2 / 12 GWh / 10.000 đơn hàng)"
      };
    }
    // Item 6b: Stricter check - "khánh thành giai đoạn 1" or "5 GWh" alone (without "12 GWh" or "giai đoạn 2") is a restatement
    const restatesOldFact = (text.includes("khánh thành giai đoạn 1") || (text.includes("5 gwh") && !text.includes("12 gwh")));
    const hasNewContext = text.includes("12 gwh") || text.includes("giai đoạn 2");
    if (restatesOldFact && !hasNewContext) {
      return {
        passed: false,
        reason: "Item 6b: Viết lại sự kiện cũ ('khánh thành giai đoạn 1' hoặc '5 GWh' đứng riêng) mà không kèm thông tin mới '12 GWh' hoặc 'giai đoạn 2'"
      };
    }
  }

  // 2. Kiểm tra chủ đề Viettel 5G:
  // Nếu đề cập tới Viettel và 5G / Open RAN
  const isViettel5g = text.includes("viettel") && (text.includes("5g") || text.includes("open ran"));
  if (isViettel5g) {
    // Phải có ít nhất 1 diễn biến mới: "cấp phép", "giấy phép", hoặc "thương mại"
    const hasNewDelta = text.includes("cấp phép") || text.includes("giấy phép") || text.includes("thương mại");
    if (!hasNewDelta) {
      return {
        passed: false,
        reason: "Lặp lại sự kiện phát sóng thử nghiệm 5G Viettel cũ mà không có diễn biến mới (thiếu cấp phép / thương mại hóa)"
      };
    }
    // Item 6b: Stricter check - "thử nghiệm" or "open ran đầu tiên" standalone (without "cấp phép" or "thương mại") is a restatement
    const restatesOldFact = (text.includes("thử nghiệm") || text.includes("open ran đầu tiên")) && !text.includes("cấp phép") && !text.includes("thương mại");
    if (restatesOldFact) {
      return {
        passed: false,
        reason: "Item 6b: Viết lại sự kiện cũ ('thử nghiệm' hoặc 'Open RAN đầu tiên' đứng riêng) mà không kèm 'cấp phép' hoặc 'thương mại hóa'"
      };
    }
  }

  return { passed: true, reason: null };
}

function evaluateOutputStrict(digest, runLabel) {
  const events = digest.events || [];

  console.log(`\n================================================================================`);
  console.log(`KIỂM TRA ĐỐI SOÁT NGHIÊM NGẶT TỪNG SỰ KIỆN CHO [${runLabel}]:`);
  console.log(`================================================================================`);
  console.log(`Tổng số sự kiện AI tổng hợp: ${events.length}`);

  let hasUnwantedRepetition = false;
  events.forEach((evt, idx) => {
    const inspection = inspectEventForUnwantedRepetition(evt);
    console.log(`- Sự kiện #${idx + 1}: "${evt.title}"`);
    console.log(`  -> Nhận định cốt lõi: "${evt.core_verdict}"`);
    if (!inspection.passed) {
      console.log(`  -> ❌ THẤT BẠI: ${inspection.reason}`);
      hasUnwantedRepetition = true;
    } else {
      console.log(`  -> ✅ HỢP LỆ (Không vi phạm quy tắc chống lặp tin)`);
    }
  });

  // Kiểm tra bắt buộc có sự kiện cập nhật mới
  const hasVinfastUpdate = events.some(e => {
    const text = (e.title + " " + e.core_verdict + " " + (e.key_highlights || []).join(" ")).toLowerCase();
    return text.includes("vinfast") && (text.includes("12 gwh") || text.includes("giai đoạn 2") || text.includes("10.000"));
  });

  const hasViettelLicense = events.some(e => {
    const text = (e.title + " " + e.core_verdict + " " + (e.key_highlights || []).join(" ")).toLowerCase();
    return text.includes("viettel") && (text.includes("cấp phép") || text.includes("thương mại") || text.includes("giấy phép"));
  });

  const hasNvidiaCenter = events.some(e => {
    const text = (e.title + " " + e.core_verdict + " " + (e.key_highlights || []).join(" ")).toLowerCase();
    return (text.includes("nvidia") || text.includes("nic")) && (text.includes("ai") || text.includes("100 triệu"));
  });

  console.log(`\nTổng hợp tiêu chí nội dung [${runLabel}]:`);
  console.log(` 1. Phát hiện sự kiện lặp cũ không có thông tin mới: ${hasUnwantedRepetition ? "❌ CÓ LỖI (Bị lặp)" : "✅ ĐẠT (0 sự kiện bị lặp)"}`);
  console.log(` 2. Báo cáo diễn biến mới VinFast (12 GWh / Giai đoạn 2): ${hasVinfastUpdate ? "✅ ĐẠT (Đầy đủ)" : "❌ THIẾU CẬP NHẬT"}`);
  console.log(` 3. Báo cáo diễn biến mới Viettel (Cấp phép 5G thương mại): ${hasViettelLicense ? "✅ ĐẠT (Đầy đủ)" : "❌ THIẾU CẬP NHẬT"}`);
  console.log(` 4. Báo cáo sự kiện mới độc lập NVIDIA / NIC (100 triệu USD): ${hasNvidiaCenter ? "✅ ĐẠT (Đầy đủ)" : "❌ THIẾU TIN MỚI"}`);

  return {
    noUnwantedRepetition: !hasUnwantedRepetition,
    hasVinfastUpdate,
    hasViettelLicense,
    hasNvidiaCenter
  };
}

/**
 * Thử nghiệm cố tình gây lỗi (Purposely failing check):
 * Giả lập một bản tin AI lặp lại bài viết cũ bằng lời văn khác (reworded) nhưng KHÔNG có diễn biến mới nào.
 * Item 6b: Also includes a mock event with ONLY old facts (no new info) to verify filter catches it.
 */
function demonstrateIntentionalFailure() {
  console.log("\n================================================================================");
  console.log("VÍ DỤ CỐ TÌNH GÂY LỖI: KIỂM CHỨNG BỘ LỌC BẮT ĐÚNG TIN LẶP ĐƯỢC VIẾT LẠI LỜI VĂN");
  console.log("================================================================================");
  
  // Tin cũ: "VinFast khánh thành giai đoạn 1 nhà máy sản xuất pin tại Hải Phòng (công suất 5 GWh/năm)"
  // Tin giả lập viết lại lời văn (reworded, không hề có giai đoạn 2 hay 12 GWh):
  const rewordedOldEvent = {
    title: "Tổ hợp Cát Hải chính thức đưa dây chuyền đóng gói pin xe điện 5 GWh vào vận hành",
    core_verdict: "Sáng nay VinFast đã tổ chức sự kiện cắt băng khánh thành cơ sở chế tạo pack pin năng lượng tại huyện đảo Cát Hải, thành phố Hải Phòng.",
    key_highlights: [
      "Dây chuyền sản xuất pin phục vụ các dòng xe điện thông minh.",
      "Công suất ước tính đạt ngưỡng 5 GWh mỗi năm."
    ]
  };

  console.log("Đầu vào giả lập (tin cũ viết lại lời văn khác hoàn toàn):");
  console.log(JSON.stringify(rewordedOldEvent, null, 2));

  const result = inspectEventForUnwantedRepetition(rewordedOldEvent);
  console.log("\nKết quả đối soát nghiêm ngặt:");
  console.log(`- passed: ${result.passed}`);
  console.log(`- reason: ${result.reason}`);
  console.log(`=> KẾT LUẬN: ${!result.passed ? "✅ BỘ LỌC ĐÃ BẮT LỖI THÀNH CÔNG VÀ CHÍNH XÁC!" : "❌ BỊ LỌT LỖI"}`);

  // --- Item 6b: Mock event with ONLY old Viettel facts (thử nghiệm, no cấp phép / thương mại) ---
  console.log("\n--- Item 6b: Mock Viettel event with ONLY old facts (should FAIL) ---");
  const viettelOnlyOldFacts = {
    title: "Viettel hoàn tất thử nghiệm kỹ thuật trạm Open RAN đầu tiên tại Hà Nội",
    core_verdict: "Viettel đã thực hiện đợt phát sóng thử nghiệm Open RAN tại quận Cầu Giấy, Hà Nội.",
    key_highlights: [
      "Đây là trạm 5G Open RAN đầu tiên do Viettel tự phát triển.",
      "Thử nghiệm hoàn tất đạt tiêu chuẩn kỹ thuật cơ bản."
    ]
  };
  console.log("Đầu vào giả lập (Viettel - chỉ có thông tin cũ, không có cấp phép/thương mại):");
  console.log(JSON.stringify(viettelOnlyOldFacts, null, 2));
  const viettelResult = inspectEventForUnwantedRepetition(viettelOnlyOldFacts);
  console.log(`- passed: ${viettelResult.passed}`);
  console.log(`- reason: ${viettelResult.reason}`);
  console.log(`=> Item 6b KẾT LUẬN: ${!viettelResult.passed ? "✅ BỘ LỌC BẮT ĐÚNG (Tin chỉ có thông tin cũ bị lọc)" : "❌ BỊ LỌT LỖI (Tin cũ không bị lọc)"}`);
}

async function main() {
  // 1. Chạy ví dụ cố tình gây lỗi để chứng minh bộ lọc bắt đúng lỗi
  demonstrateIntentionalFailure();

  // 2. Chạy 2 lần thực tế qua Free AI Model
  console.log("\n================================================================================");
  console.log("CHẠY THỰC TẾ 2 LẦN VỚI MÔ HÌNH MIỄN PHÍ QUA ZERO-COST GUARD");
  console.log("================================================================================");

  console.log("\n>>> ĐANG CHẠY RUN 1...");
  const digest1 = await synthesizeArticles(
    TOPIC,
    CURRENT_ARTICLES,
    "Ưu tiên các bước tiến công nghệ, hợp tác đầu tư và chính sách kinh tế.",
    [],
    TARGET_LANG,
    PREVIOUS_EVENTS,
    "scheduled"
  );
  const eval1 = evaluateOutputStrict(digest1, "RUN 1");

  console.log("\n>>> ĐANG CHẠY RUN 2...");
  const digest2 = await synthesizeArticles(
    TOPIC,
    CURRENT_ARTICLES,
    "Ưu tiên các bước tiến công nghệ, hợp tác đầu tư và chính sách kinh tế.",
    [],
    TARGET_LANG,
    PREVIOUS_EVENTS,
    "scheduled"
  );
  const eval2 = evaluateOutputStrict(digest2, "RUN 2");

  const allPassed = 
    eval1.noUnwantedRepetition && eval1.hasVinfastUpdate && eval1.hasViettelLicense && eval1.hasNvidiaCenter &&
    eval2.noUnwantedRepetition && eval2.hasVinfastUpdate && eval2.hasViettelLicense && eval2.hasNvidiaCenter;

  console.log("\n================================================================================");
  console.log("TỔNG KẾT ĐỐI SOÁT CUỐI CÙNG:");
  console.log(`Toàn bộ tiêu chí trên cả RUN 1 và RUN 2: ${allPassed ? "✅ ĐẠT TOÀN BỘ TIÊU CHÍ" : "❌ CÓ ĐIỂM CHƯA ĐẠT"}`);
  console.log("================================================================================");

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error("Lỗi:", err);
  process.exit(1);
});
