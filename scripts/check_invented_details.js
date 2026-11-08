/**
 * scripts/check_invented_details.js
 *
 * Accent-insensitive check for specific phrases in article content_snippets.
 * Checks whether phrases claimed in test data actually appear in the source articles.
 * Uses NFD normalization to strip Vietnamese diacritics before comparison.
 */

"use strict";

// Source articles from test_vietnamese_anti_repetition.js
const CURRENT_ARTICLES = [
  {
    title: "VinFast tổ chức lễ khánh thành nhà máy sản xuất pack pin giai đoạn 1 tại Hải Phòng",
    source: "VnExpress",
    content_snippet: "Sáng nay VinFast chính thức đưa vào vận hành giai đoạn 1 nhà máy pin tại tổ hợp Cát Hải, Hải Phòng với công suất thiết kế 5 GWh/năm."
  },
  {
    title: "VinFast nhận thêm 10.000 đơn hàng pin và công bố khởi công giai đoạn 2 nâng công suất lên 12 GWh/năm",
    source: "Tuổi Trẻ",
    content_snippet: "Sau khi hoàn tất giai đoạn 1, VinFast công bố đã nhận thêm 10.000 đơn hàng xuất khẩu và chính thức khởi công giai đoạn 2, nâng tổng công suất nhà máy lên 12 GWh mỗi năm."
  },
  {
    title: "Hà Nội ghi nhận trạm 5G Open RAN đầu tiên do Viettel tự nghiên cứu phát sóng thành công",
    source: "Dân Trí",
    content_snippet: "Viettel vừa hoàn tất đợt phát sóng thử nghiệm kỹ thuật trạm 5G Open RAN đầu tiên tại khu vực quận Cầu Giấy, Hà Nội."
  },
  {
    title: "Bộ Thông tin và Truyền thông chính thức cấp giấy phép thương mại hóa tần số 5G cho Viettel",
    source: "VietnamNet",
    content_snippet: "Chiều nay Bộ TT&TT đã chính thức trao giấy phép thiết lập mạng và cung cấp dịch vụ viễn thông 5G thương mại cho Viettel sau quá trình thử nghiệm đạt tiêu chuẩn."
  },
  {
    title: "NVIDIA cùng Trung tâm Đổi mới sáng tạo Quốc gia (NIC) khai trương Trung tâm nghiên cứu AI 100 triệu USD",
    source: "Znews",
    content_snippet: "Tập đoàn công nghệ NVIDIA phối hợp cùng NIC khai trương trung tâm nghiên cứu và ươm tạo tài năng trí tuệ nhân tạo tại Hà Nội với quy mô vốn đầu tư 100 triệu USD."
  },
  {
    title: "Các hãng hàng không nội địa bắt đầu mở bán vé máy bay Tết Nguyên đán 2027",
    source: "Tiền Phong",
    content_snippet: "Các hãng hàng không Việt Nam bắt đầu mở bán đợt 1 vé máy bay dịp Tết với hơn 2 triệu ghế trên các đường bay trục chính."
  }
];

/**
 * Strips Vietnamese diacritical marks and lowercases a string.
 * Uses NFD normalization to decompose combined characters, then removes
 * combining characters (Unicode category Mn).
 */
function normalize(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Checks whether a phrase appears (accent-insensitive) in any source article
 * (title + content_snippet combined).
 */
function phraseFoundInSources(phrase, articles) {
  const normalizedPhrase = normalize(phrase);
  for (const art of articles) {
    const haystack = normalize((art.title || "") + " " + (art.content_snippet || ""));
    if (haystack.includes(normalizedPhrase)) {
      return true;
    }
  }
  return false;
}

// Phrases to check - these appear in the VinFast "10.000 đơn" article content_snippet
// and the Viettel articles' content_snippets
const phrasesToCheck = [
  {
    phrase: "xuất khẩu",
    description: "VinFast 10.000 đơn article: 'xuất khẩu' (xuat khau)",
    article: "VinFast 10.000 đơn (Tuổi Trẻ) content_snippet"
  },
  {
    phrase: "do tự nghiên cứu",
    description: "Viettel article: 'do tự nghiên cứu' (do tu nghien cuu)",
    article: "Viettel 5G (Dân Trí) title"
  }
];

console.log("=== ACCENT-INSENSITIVE PHRASE CHECK ===");
console.log("Checking phrases against all source article titles + content_snippets");
console.log("");

for (const item of phrasesToCheck) {
  const found = phraseFoundInSources(item.phrase, CURRENT_ARTICLES);
  console.log(`Phrase: "${item.phrase}"`);
  console.log(`Expected in: ${item.article}`);
  console.log(`Result: ${found ? "FOUND" : "INVENTED DETAIL"}`);
  console.log("");
}

// Also show what each article actually contains (normalized) for reference
console.log("--- Normalized content of relevant articles for reference ---");
for (const art of CURRENT_ARTICLES) {
  const haystack = normalize((art.title || "") + " " + (art.content_snippet || ""));
  if (haystack.includes("vinfast") || haystack.includes("viettel")) {
    console.log(`[${art.source}] normalized: ${haystack.slice(0, 200)}`);
    console.log("");
  }
}
