/**
 * Intent & Entity Analyzer for OSINT Global Intelligence Engine v3.
 * Unicode-aware entity and domain detection for Vietnamese and multi-language queries.
 */

// Helper to create Unicode-aware word boundary pattern
function uWord(word) {
  // Escapes regex specials in word
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "iu");
}

const KNOWN_ENTITIES = [
  {
    canonical: "Mỹ",
    patterns: [uWord("mỹ"), uWord("hoa kỳ"), /(?<!\p{L})u\.?s\.?a?(?!\p{L})/iu, uWord("united states"), uWord("america")],
    keywords: [
      "mỹ", "hoa kỳ", "us", "u.s.", "usa", "united states", "fed", "federal reserve",
      "wall street", "nhà trắng", "white house", "washington", "dollar", "usd",
      "treasury", "biden", "trump", "american"
    ],
    crossBorderTerms: ["US economy", "US policy", "United States", "Fed"]
  },
  {
    canonical: "Trung Quốc",
    patterns: [uWord("trung quốc"), uWord("tq"), uWord("china"), uWord("chinese"), uWord("bắc kinh")],
    keywords: [
      "trung quốc", "tq", "china", "chinese", "bắc kinh", "beijing", "tập cận bình",
      "xi jinping", "tệ", "yuan", "renminbi", "scmp", "đại lục"
    ],
    crossBorderTerms: ["China", "Chinese economy", "Beijing"]
  },
  {
    canonical: "Nhật Bản",
    patterns: [uWord("nhật bản"), uWord("nhật"), uWord("japan"), uWord("japanese"), uWord("tokyo")],
    keywords: ["nhật bản", "nhật", "japan", "japanese", "tokyo", "yen", "boj", "nikkei", "bank of japan"],
    crossBorderTerms: ["Japan", "Bank of Japan", "Yen"]
  },
  {
    canonical: "Hàn Quốc",
    patterns: [uWord("hàn quốc"), uWord("hàn"), uWord("korea"), uWord("korean"), uWord("seoul")],
    keywords: ["hàn quốc", "hàn", "korea", "korean", "seoul", "won", "samsung", "sk hynix"],
    crossBorderTerms: ["South Korea", "Seoul", "Korean tech"]
  },
  {
    canonical: "Đức",
    patterns: [uWord("đức"), uWord("germany"), uWord("german"), uWord("berlin")],
    keywords: ["đức", "germany", "german", "berlin", "bundesbank", "scholz", "handelsblatt"],
    crossBorderTerms: ["Germany", "German economy", "Berlin"]
  },
  {
    canonical: "Pháp",
    patterns: [uWord("pháp"), uWord("france"), uWord("french"), uWord("paris")],
    keywords: ["pháp", "france", "french", "paris", "macron", "les echos"],
    crossBorderTerms: ["France", "French economy", "Paris"]
  },
  {
    canonical: "Anh",
    patterns: [uWord("anh"), /(?<!\p{L})u\.?k\.?(?!\p{L})/iu, uWord("britain"), uWord("british"), uWord("london")],
    keywords: ["anh", "uk", "u.k.", "britain", "british", "london", "boe", "bank of england", "downing street"],
    crossBorderTerms: ["UK", "Britain", "Bank of England"]
  },
  {
    canonical: "Nga",
    patterns: [uWord("nga"), uWord("russia"), uWord("russian"), uWord("moscow"), uWord("kremlin")],
    keywords: ["nga", "russia", "russian", "moscow", "kremlin", "putin", "ruble", "tass"],
    crossBorderTerms: ["Russia", "Moscow", "Kremlin"]
  },
  {
    canonical: "Đài Loan",
    patterns: [uWord("đài loan"), uWord("taiwan"), uWord("taipei"), uWord("tsmc")],
    keywords: ["đài loan", "taiwan", "taipei", "tsmc", "đúc chip", "foundry"],
    crossBorderTerms: ["Taiwan", "TSMC", "Taipei"]
  },
  {
    canonical: "Hà Lan",
    patterns: [uWord("hà lan"), uWord("netherlands"), uWord("dutch"), uWord("asml")],
    keywords: ["hà lan", "netherlands", "dutch", "asml", "lithography", "quang khắc", "veldhoven"],
    crossBorderTerms: ["Netherlands", "ASML", "Dutch"]
  },
  {
    canonical: "Israel",
    patterns: [uWord("israel"), uWord("israeli"), uWord("tel aviv"), uWord("jerusalem"), uWord("idf")],
    keywords: ["israel", "israeli", "tel aviv", "jerusalem", "idf", "netanyahu"],
    crossBorderTerms: ["Israel", "Tel Aviv", "IDF"]
  },
  {
    canonical: "Singapore",
    patterns: [uWord("singapore"), uWord("sing")],
    keywords: ["singapore", "singaporean", "mas", "temasek"],
    crossBorderTerms: ["Singapore", "MAS"]
  },
  {
    canonical: "Việt Nam",
    patterns: [uWord("việt nam"), uWord("vn"), uWord("vietnam"), uWord("hà nội"), uWord("sài gòn"), /(?<!\p{L})tp\.?hcm(?!\p{L})/iu],
    keywords: ["việt nam", "vietnam", "vn", "hà nội", "tp.hcm", "sài gòn", "vnd", "vneconomy", "ngân hàng nhà nước"],
    crossBorderTerms: ["Vietnam", "State Bank of Vietnam", "Vietnamese"]
  },
  {
    canonical: "ASML",
    patterns: [uWord("asml")],
    keywords: ["asml", "lithography", "euv", "duv", "quang khắc", "veldhoven", "hà lan", "dutch"],
    crossBorderTerms: ["ASML", "EUV lithography"]
  },
  {
    canonical: "TSMC",
    patterns: [uWord("tsmc")],
    keywords: ["tsmc", "đài loan", "taiwan", "wafer", "foundry", "đúc chip"],
    crossBorderTerms: ["TSMC", "Taiwan semiconductor"]
  },
  {
    canonical: "Nvidia",
    patterns: [uWord("nvidia")],
    keywords: ["nvidia", "jensen huang", "gpu", "blackwell", "h100", "b200", "cuda"],
    crossBorderTerms: ["Nvidia", "Jensen Huang", "Blackwell"]
  }
];

const PILLAR_PATTERNS = {
  DEFENSE: [
    uWord("quân sự"), uWord("vũ khí"), uWord("chiến sự"), uWord("phòng không"), uWord("uav"),
    uWord("drone"), uWord("nato"), uWord("tên lửa"), uWord("xung đột"), uWord("chiến tranh"),
    uWord("quốc phòng"), uWord("military"), uWord("defense"), uWord("missile"), uWord("war")
  ],
  SEMICONDUCTOR: [
    uWord("bán dẫn"), uWord("chip"), uWord("vi mạch"), uWord("quang khắc"), uWord("wafer"),
    uWord("lithography"), uWord("euv"), uWord("asml"), uWord("tsmc"), uWord("semiconductor"),
    uWord("đúc chip"), uWord("foundry")
  ],
  TECH_AI: [
    uWord("ai"), uWord("trí tuệ nhân tạo"), uWord("llm"), uWord("openai"), uWord("gemini"),
    uWord("deepseek"), uWord("machine learning"), uWord("công nghệ"), uWord("phần mềm"),
    uWord("software"), uWord("startup"), uWord("tech"), uWord("cloud")
  ],
  ECONOMY: [
    uWord("kinh tế"), uWord("tài chính"), uWord("lạm phát"), uWord("fed"), uWord("chứng khoán"),
    uWord("ngân hàng"), uWord("thị trường"), uWord("bất động sản"), uWord("bđs"), uWord("ngoại hối"),
    uWord("gdp"), uWord("xuất nhập khẩu"), uWord("fdi"), uWord("economy"), uWord("finance"),
    uWord("market"), uWord("inflation")
  ]
};

/**
 * Detects the strategic pillar of a topic.
 * @param {string} topic
 * @returns {"DEFENSE" | "SEMICONDUCTOR" | "TECH_AI" | "ECONOMY" | "GENERAL"}
 */
function detectPillar(topic) {
  for (const [pillar, patterns] of Object.entries(PILLAR_PATTERNS)) {
    if (patterns.some((re) => re.test(topic))) {
      return pillar;
    }
  }
  return "GENERAL";
}

/**
 * Detects targeted entity in the query.
 * @param {string} topic
 * @returns {Object|null}
 */
function detectEntity(topic) {
  for (const ent of KNOWN_ENTITIES) {
    if (ent.patterns.some((re) => re.test(topic))) {
      return ent;
    }
  }
  return null;
}

/**
 * Analyzes the user's topic and determines the execution strategy.
 * @param {string} rawTopic
 * @returns {{
 *   scope: "BROAD" | "TARGETED",
 *   pillar: "DEFENSE" | "SEMICONDUCTOR" | "TECH_AI" | "ECONOMY" | "GENERAL",
 *   coreEntity: string | null,
 *   targetKeywords: string[],
 *   geoSearchQueries: Array<{ geo: string, query: string }>
 * }}
 */
function analyzeIntent(rawTopic) {
  const topic = (rawTopic || "").trim();
  const pillar = detectPillar(topic);
  const matchedEntity = detectEntity(topic);

  // If a known entity or country is detected, lock onto TARGETED mode
  if (matchedEntity) {
    const coreEntity = matchedEntity.canonical;
    const targetKeywords = [...matchedEntity.keywords];

    // Build cross-border search queries enforcing the core entity
    const crossBorderQueries = [
      { geo: "US", query: `${coreEntity} ${pillar !== "GENERAL" ? pillar.toLowerCase() : topic}` },
      { geo: "GB", query: `"${matchedEntity.crossBorderTerms[0] || coreEntity}" ${pillar === "ECONOMY" ? "economy" : topic}` },
      { geo: "JP", query: `"${matchedEntity.crossBorderTerms[0] || coreEntity}"` },
      { geo: "VN", query: topic }
    ];

    return {
      scope: "TARGETED",
      pillar,
      coreEntity,
      targetKeywords,
      geoSearchQueries: crossBorderQueries
    };
  }

  // Check if topic is a broad industry / technology term
  const broadKeywordsList = [
    "ai", "trí tuệ nhân tạo", "bán dẫn", "chip bán dẫn", "công nghệ",
    "kinh tế thế giới", "thị trường tài chính", "chiến sự thế giới"
  ];

  const lowerTopic = topic.toLowerCase();
  const isExplicitBroad = broadKeywordsList.some((kw) => lowerTopic.includes(kw));

  if (isExplicitBroad || pillar !== "GENERAL") {
    // Generate broad multi-source queries
    const geoSearchQueries = [
      { geo: "US", query: topic },
      { geo: "GB", query: topic },
      { geo: "VN", query: topic }
    ];

    // Build relevant keywords for gatekeeping broad domains
    let broadKeywords = [];
    if (pillar === "TECH_AI") {
      broadKeywords = ["ai", "trí tuệ nhân tạo", "llm", "model", "nvidia", "openai", "tech", "software", "robot", "cloud"];
    } else if (pillar === "SEMICONDUCTOR") {
      broadKeywords = ["semiconductor", "bán dẫn", "chip", "wafer", "lithography", "asml", "tsmc", "intel", "nvidia"];
    } else if (pillar === "DEFENSE") {
      broadKeywords = ["defense", "quân sự", "vũ khí", "military", "war", "missile", "nato", "uav", "chiến sự"];
    } else if (pillar === "ECONOMY") {
      broadKeywords = ["economy", "kinh tế", "lạm phát", "fed", "thị trường", "market", "inflation", "chứng khoán", "tài chính"];
    }

    return {
      scope: "BROAD",
      pillar,
      coreEntity: null,
      targetKeywords: broadKeywords,
      geoSearchQueries
    };
  }

  // Fallback for custom or general queries
  return {
    scope: "TARGETED",
    pillar: "GENERAL",
    coreEntity: topic,
    targetKeywords: topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
    geoSearchQueries: [
      { geo: "US", query: topic },
      { geo: "VN", query: topic }
    ]
  };
}

module.exports = {
  analyzeIntent,
  detectPillar,
  detectEntity,
  KNOWN_ENTITIES,
  PILLAR_PATTERNS
};
