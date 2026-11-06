/**
 * Strategic Multi-Nation News Catalog & Publisher Source Configuration.
 * OSINT Institutional Intelligence Engine v4 Standard.
 *
 * Covers 3 Source Credibility Tiers:
 *   - TIER 1: Primary Official (Government, Central Banks, SEC Filings, Official Corporate IR, Defense Institutes)
 *   - TIER 2: High-Standard Mainstream Press (Reuters, Bloomberg, WSJ, FT, Nikkei, VnExpress)
 *   - TIER 3: Community, Aggregators & Social Media (Reddit, Tech Forums, Blogs)
 */

const DOMAIN_CATALOG = {
  // =========================================================================
  // TIER 1: PRIMARY SOURCES (Chính phủ, Ngân hàng TW, Báo cáo gốc, IR)
  // =========================================================================
  "sbv.gov.vn": { name: "Ngân hàng Nhà nước VN", country: "Việt Nam", tier: 1, type: "GOVERNMENT" },
  "moit.gov.vn": { name: "Bộ Công Thương VN", country: "Việt Nam", tier: 1, type: "GOVERNMENT" },
  "gso.gov.vn": { name: "Tổng cục Thống kê VN", country: "Việt Nam", tier: 1, type: "GOVERNMENT" },
  "chinhphu.vn": { name: "Cổng TTĐT Chính phủ VN", country: "Việt Nam", tier: 1, type: "GOVERNMENT" },
  "federalreserve.gov": { name: "Federal Reserve (Fed)", country: "Mỹ", tier: 1, type: "GOVERNMENT" },
  "whitehouse.gov": { name: "Nhà Trắng (White House)", country: "Mỹ", tier: 1, type: "GOVERNMENT" },
  "defense.gov": { name: "Bộ Quốc phòng Mỹ (DoD)", country: "Mỹ", tier: 1, type: "GOVERNMENT" },
  "sec.gov": { name: "U.S. SEC", country: "Mỹ", tier: 1, type: "GOVERNMENT" },
  "iswresearch.org": { name: "ISW (Viện NC Chiến tranh)", country: "Mỹ", tier: 1, type: "GOVERNMENT" },
  "ecb.europa.eu": { name: "Ngân hàng Trung ương Châu Âu (ECB)", country: "Châu Âu", tier: 1, type: "GOVERNMENT" },
  "bankofengland.co.uk": { name: "Bank of England (BoE)", country: "Anh", tier: 1, type: "GOVERNMENT" },
  "boj.or.jp": { name: "Bank of Japan (BoJ)", country: "Nhật Bản", tier: 1, type: "GOVERNMENT" },
  "bundesbank.de": { name: "Bundesbank", country: "Đức", tier: 1, type: "GOVERNMENT" },
  "asml.com": { name: "ASML Official IR", country: "Hà Lan", tier: 1, type: "GOVERNMENT" },
  "tsmc.com": { name: "TSMC Official", country: "Đài Loan", tier: 1, type: "GOVERNMENT" },
  "nvidia.com": { name: "Nvidia Newsroom", country: "Mỹ", tier: 1, type: "GOVERNMENT" },

  // =========================================================================
  // TIER 2: MAINSTREAM & ESTABLISHED JOURNALISM (Báo chí chuẩn mực cao)
  // =========================================================================
  // --- Mỹ ---
  "wsj.com": { name: "Wall Street Journal", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "bloomberg.com": { name: "Bloomberg", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "reuters.com": { name: "Reuters", country: "Quốc tế", tier: 2, type: "MAINSTREAM" },
  "apnews.com": { name: "Associated Press", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "cnbc.com": { name: "CNBC", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "nytimes.com": { name: "New York Times", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "washingtonpost.com": { name: "Washington Post", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "defensenews.com": { name: "Defense News", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "twz.com": { name: "The War Zone", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "defenseone.com": { name: "Defense One", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "technologyreview.com": { name: "MIT Tech Review", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "techcrunch.com": { name: "TechCrunch", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "wired.com": { name: "Wired", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "theverge.com": { name: "The Verge", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "arstechnica.com": { name: "Ars Technica", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "tomshardware.com": { name: "Tom's Hardware", country: "Mỹ", tier: 2, type: "MAINSTREAM" },
  "semiengineering.com": { name: "Semiconductor Engineering", country: "Mỹ", tier: 2, type: "MAINSTREAM" },

  // --- Anh ---
  "ft.com": { name: "Financial Times", country: "Anh", tier: 2, type: "MAINSTREAM" },
  "economist.com": { name: "The Economist", country: "Anh", tier: 2, type: "MAINSTREAM" },
  "bbc.com": { name: "BBC News", country: "Anh", tier: 2, type: "MAINSTREAM" },
  "theguardian.com": { name: "The Guardian", country: "Anh", tier: 2, type: "MAINSTREAM" },
  "janes.com": { name: "Jane's Defence", country: "Anh", tier: 2, type: "MAINSTREAM" },
  "ukdefencejournal.org.uk": { name: "UK Defence Journal", country: "Anh", tier: 2, type: "MAINSTREAM" },
  "theregister.com": { name: "The Register", country: "Anh", tier: 2, type: "MAINSTREAM" },

  // --- Đức ---
  "handelsblatt.com": { name: "Handelsblatt", country: "Đức", tier: 2, type: "MAINSTREAM" },
  "dw.com": { name: "Deutsche Welle", country: "Đức", tier: 2, type: "MAINSTREAM" },
  "spiegel.de": { name: "Der Spiegel", country: "Đức", tier: 2, type: "MAINSTREAM" },
  "faz.net": { name: "Frankfurter Allgemeine", country: "Đức", tier: 2, type: "MAINSTREAM" },

  // --- Pháp ---
  "lesechos.fr": { name: "Les Echos", country: "Pháp", tier: 2, type: "MAINSTREAM" },
  "lemonde.fr": { name: "Le Monde", country: "Pháp", tier: 2, type: "MAINSTREAM" },
  "france24.com": { name: "France 24", country: "Pháp", tier: 2, type: "MAINSTREAM" },
  "meta-defense.fr": { name: "Meta-Defense", country: "Pháp", tier: 2, type: "MAINSTREAM" },

  // --- Nhật Bản ---
  "nikkei.com": { name: "Nikkei Asia", country: "Nhật Bản", tier: 2, type: "MAINSTREAM" },
  "japantimes.co.jp": { name: "The Japan Times", country: "Nhật Bản", tier: 2, type: "MAINSTREAM" },
  "mainichi.jp": { name: "The Mainichi", country: "Nhật Bản", tier: 2, type: "MAINSTREAM" },
  "asahi.com": { name: "The Asahi Shimbun", country: "Nhật Bản", tier: 2, type: "MAINSTREAM" },

  // --- Hàn Quốc ---
  "kedglobal.com": { name: "The Korea Economic Daily", country: "Hàn Quốc", tier: 2, type: "MAINSTREAM" },
  "koreajoongangdaily.joins.com": { name: "Korea JoongAng Daily", country: "Hàn Quốc", tier: 2, type: "MAINSTREAM" },
  "koreaherald.com": { name: "The Korea Herald", country: "Hàn Quốc", tier: 2, type: "MAINSTREAM" },
  "koreatimes.co.kr": { name: "The Korea Times", country: "Hàn Quốc", tier: 2, type: "MAINSTREAM" },
  "pulsenews.co.kr": { name: "Pulse News Korea", country: "Hàn Quốc", tier: 2, type: "MAINSTREAM" },

  // --- Đài Loan & Hà Lan ---
  "digitimes.com": { name: "DigiTimes", country: "Đài Loan", tier: 2, type: "MAINSTREAM" },
  "taipeitimes.com": { name: "Taipei Times", country: "Đài Loan", tier: 2, type: "MAINSTREAM" },
  "focustaiwan.tw": { name: "Focus Taiwan", country: "Đài Loan", tier: 2, type: "MAINSTREAM" },
  "dutchnews.nl": { name: "DutchNews", country: "Hà Lan", tier: 2, type: "MAINSTREAM" },
  "nltimes.nl": { name: "NL Times", country: "Hà Lan", tier: 2, type: "MAINSTREAM" },
  "bits-chips.nl": { name: "Bits&Chips", country: "Hà Lan", tier: 2, type: "MAINSTREAM" },

  // --- Israel ---
  "timesofisrael.com": { name: "Times of Israel", country: "Israel", tier: 2, type: "MAINSTREAM" },
  "jpost.com": { name: "Jerusalem Post", country: "Israel", tier: 2, type: "MAINSTREAM" },
  "calcalistech.com": { name: "CTech Israel", country: "Israel", tier: 2, type: "MAINSTREAM" },
  "haaretz.com": { name: "Haaretz", country: "Israel", tier: 2, type: "MAINSTREAM" },

  // --- Nga & Trung Quốc ---
  "tass.com": { name: "TASS", country: "Nga", tier: 2, type: "MAINSTREAM" },
  "rt.com": { name: "RT", country: "Nga", tier: 2, type: "MAINSTREAM" },
  "scmp.com": { name: "South China Morning Post", country: "Hồng Kông/TQ", tier: 2, type: "MAINSTREAM" },
  "chinadaily.com.cn": { name: "China Daily", country: "Trung Quốc", tier: 2, type: "MAINSTREAM" },

  // --- Singapore & Việt Nam ---
  "straitstimes.com": { name: "The Straits Times", country: "Singapore", tier: 2, type: "MAINSTREAM" },
  "channelnewsasia.com": { name: "CNA", country: "Singapore", tier: 2, type: "MAINSTREAM" },
  "businesstimes.com.sg": { name: "The Business Times SG", country: "Singapore", tier: 2, type: "MAINSTREAM" },
  "vnexpress.net": { name: "VnExpress", country: "Việt Nam", tier: 2, type: "MAINSTREAM" },
  "cafef.vn": { name: "CafeF", country: "Việt Nam", tier: 2, type: "MAINSTREAM" },
  "tuoitre.vn": { name: "Tuổi Trẻ", country: "Việt Nam", tier: 2, type: "MAINSTREAM" },
  "thanhnien.vn": { name: "Thanh Niên", country: "Việt Nam", tier: 2, type: "MAINSTREAM" },
  "vietnamnet.vn": { name: "VietNamNet", country: "Việt Nam", tier: 2, type: "MAINSTREAM" },

  // =========================================================================
  // TIER 3: COMMUNITY, AGGREGATORS & PR WIRES (Cộng đồng, Diễn đàn, PR Seeding)
  // =========================================================================
  "reddit.com": { name: "Reddit Community", country: "Toàn cầu", tier: 3, type: "COMMUNITY" },
  "ycombinator.com": { name: "Hacker News", country: "Toàn cầu", tier: 3, type: "COMMUNITY" },
  "twitter.com": { name: "X (Twitter)", country: "Toàn cầu", tier: 3, type: "COMMUNITY" },
  "x.com": { name: "X (Twitter)", country: "Toàn cầu", tier: 3, type: "COMMUNITY" },
  "prnewswire.com": { name: "PR Newswire", country: "Toàn cầu", tier: 3, type: "PR_WIRE" },
  "businesswire.com": { name: "Business Wire", country: "Toàn cầu", tier: 3, type: "PR_WIRE" },
  "globenewswire.com": { name: "GlobeNewswire", country: "Toàn cầu", tier: 3, type: "PR_WIRE" },
  "pressat.co.uk": { name: "Pressat UK", country: "Anh", tier: 3, type: "PR_WIRE" }
};

/**
 * Google News RSS Geo Endpoints for strategic regions.
 */
const GEO_EDITIONS = {
  US: { hl: "en-US", gl: "US", ceid: "US:en", name: "Mỹ" },
  GB: { hl: "en-GB", gl: "GB", ceid: "GB:en", name: "Anh" },
  JP: { hl: "en-JP", gl: "JP", ceid: "JP:en", name: "Nhật Bản" },
  KR: { hl: "en-KR", gl: "KR", ceid: "KR:en", name: "Hàn Quốc" },
  DE: { hl: "de", gl: "DE", ceid: "DE:de", name: "Đức" },
  FR: { hl: "fr", gl: "FR", ceid: "FR:fr", name: "Pháp" },
  IL: { hl: "en-IL", gl: "IL", ceid: "IL:en", name: "Israel" },
  SG: { hl: "en-SG", gl: "SG", ceid: "SG:en", name: "Singapore" },
  VN: { hl: "vi", gl: "VN", ceid: "VN:vi", name: "Việt Nam" }
};

/**
 * Curated Direct RSS feeds by Pillar.
 */
const DIRECT_PILLAR_FEEDS = {
  DEFENSE: [
    { url: "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml", source: "Defense News (Mỹ)", tier: 2 },
    { url: "https://www.twz.com/feed", source: "The War Zone (Mỹ)", tier: 2 }
  ],
  SEMICONDUCTOR: [
    { url: "https://www.tomshardware.com/feeds/tag/semiconductors", source: "Tom's Hardware (Mỹ)", tier: 2 },
    { url: "https://semiengineering.com/feed/", source: "Semiconductor Engineering", tier: 2 }
  ],
  TECH_AI: [
    { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch AI (Mỹ)", tier: 2 },
    { url: "https://www.technologyreview.com/feed/", source: "MIT Tech Review (Mỹ)", tier: 2 },
    { url: "https://feeds.arstechnica.com/arstechnica/technology-lab", source: "Ars Technica (Mỹ)", tier: 2 },
    { url: "https://vnexpress.net/rss/so-hoa.rss", source: "VnExpress Số Hóa (VN)", tier: 2 }
  ],
  ECONOMY: [
    { url: "https://search.cnbc.com/rs/search/combinedserver/search.xml?partnerId=wrss01&id=10000664", source: "CNBC Economy (Mỹ)", tier: 2 },
    { url: "https://search.cnbc.com/rs/search/combinedserver/search.xml?partnerId=wrss01&id=20910258", source: "CNBC World News", tier: 2 },
    { url: "https://vnexpress.net/rss/kinh-doanh.rss", source: "VnExpress Kinh Doanh (VN)", tier: 2 },
    { url: "https://cafef.vn/tai-chinh-quoc-te.rss", source: "CafeF Tài Chính QT (VN)", tier: 2 }
  ]
};

/**
 * Resolves source metadata, country, and Tier (1, 2, 3) from a domain or URL.
 * @param {string} domainOrUrl
 * @returns {{ name: string, country: string, tier: 1 | 2 | 3, type: string, badge: string }}
 */
function getSourceMeta(domainOrUrl) {
  if (!domainOrUrl) {
    return { name: "Nguồn tin", country: "Quốc tế", tier: 3, type: "COMMUNITY", badge: "Nguồn tin" };
  }

  let host = domainOrUrl.toLowerCase();
  try {
    if (domainOrUrl.startsWith("http")) {
      host = new URL(domainOrUrl).hostname.replace(/^www\./, "");
    }
  } catch {}

  // Check if government domain (.gov, .gov.vn, etc.)
  if (host.includes(".gov") || host.includes(".gob") || host.includes(".gouv")) {
    return {
      name: host,
      country: host.includes(".vn") ? "Việt Nam" : host.includes(".uk") ? "Anh" : "Mỹ",
      tier: 1,
      type: "GOVERNMENT",
      badge: `🏛️ ${host} (Chính phủ/Cấp 1)`
    };
  }

  // Exact or suffix match in catalog
  for (const [dom, meta] of Object.entries(DOMAIN_CATALOG)) {
    if (host === dom || host.endsWith("." + dom)) {
      const tierIcon = meta.type === "PR_WIRE" ? "📢" : meta.tier === 1 ? "🏛️" : meta.tier === 2 ? "📰" : "💬";
      const typeLabel = meta.type === "PR_WIRE" ? "PR Wire" : `Cấp ${meta.tier}`;
      return {
        name: meta.name,
        country: meta.country,
        tier: meta.tier,
        type: meta.type,
        badge: `${tierIcon} ${meta.name} (${meta.country}/${typeLabel})`
      };
    }
  }

  // Fallback defaults to Tier 2 if general news domain, or Tier 3
  return {
    name: host,
    country: "Quốc tế",
    tier: 2,
    type: "MAINSTREAM",
    badge: `📰 ${host}`
  };
}

/**
 * Returns human-friendly source badge for Telegram presentation.
 * @param {string} domainOrUrl
 * @returns {string}
 */
function getSourceBadge(domainOrUrl) {
  const meta = getSourceMeta(domainOrUrl);
  return meta.badge;
}

module.exports = {
  DOMAIN_CATALOG,
  GEO_EDITIONS,
  DIRECT_PILLAR_FEEDS,
  getSourceMeta,
  getSourceBadge
};
