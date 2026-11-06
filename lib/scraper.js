const cheerio = require("cheerio");
const { analyzeIntent } = require("./intent_analyzer");
const {
  GEO_EDITIONS,
  DIRECT_PILLAR_FEEDS,
  getSourceMeta,
  getSourceBadge
} = require("./sources_config");
const { extractFullText } = require("./fulltext_extractor");

/**
 * OSINT Scraper, Lineage Tracker & Semantic Gatekeeper Module v4.
 * Adheres strictly to SRP: Content scraping, extraction, semantic gatekeeping,
 * lineage tracking, and normalization only.
 * Never touches the database or sends messages.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 8000;
const MAX_SNIPPET_LENGTH = 800;
const MAX_ARTICLES_RETURNED = 45;
const MAX_DEEP_FULLTEXT_ARTICLES = 6;

const SPAM_MARKERS = [
  "[sponsored]",
  "[ad]",
  "[pr]",
  "promoted",
  "khuyến mãi",
  "mã giảm giá",
  "flash sale",
  "mua ngay",
  "buy now",
  "deal hời",
  "affiliate",
  "partner content",
  "sponsored content",
  "press release"
];

// Patterns indicating an article is merely copying/citing a third-party root source
const CITATION_PATTERNS = [
  /(?:theo|trích dẫn từ|dẫn nguồn từ|nguồn tin từ)\s+([A-Z][a-zA-Z\s]+)/i,
  /(?:according to|citing|reported by|as per)\s+([A-Z][a-zA-Z\s]+)/i
];

// Synthetic AI-generated SEO spam markers (Layer 12)
const SYNTHETIC_SPAM_PATTERNS = [
  "as an ai language model",
  "in this blog post, we will delve into",
  "delve into the world of",
  "test your knowledge with",
  "click here to read full article"
];

/**
 * Checks if an article title or snippet contains promotional/ad markers.
 * @param {string} title
 * @param {string} snippet
 * @returns {boolean}
 */
function isPromotionalSpam(title, snippet) {
  const combined = `${title || ""} ${snippet || ""}`.toLowerCase();
  return (
    SPAM_MARKERS.some((marker) => combined.includes(marker)) ||
    SYNTHETIC_SPAM_PATTERNS.some((pat) => combined.includes(pat))
  );
}

/**
 * Detects Astroturfing / PR Seeding campaigns (Layer 7).
 * Flags articles that have >=75% vocabulary overlap across low-tier or PR wire sources.
 * @param {Array<Object>} articles
 */
function flagAstroturfingCampaigns(articles) {
  const tokenSets = articles.map((a) => {
    const text = (a.title + " " + (a.contentSnippet || "")).toLowerCase().replace(/[^a-z0-9\s]/g, "");
    return new Set(text.split(/\s+/).filter((w) => w.length > 3));
  });

  for (let i = 0; i < articles.length; i++) {
    let duplicateCount = 0;
    const tokensA = tokenSets[i];
    if (tokensA.size < 5) continue;

    for (let j = 0; j < articles.length; j++) {
      if (i === j) continue;
      const tokensB = tokenSets[j];
      let intersection = 0;
      for (const t of tokensA) {
        if (tokensB.has(t)) intersection++;
      }
      const similarity = intersection / Math.max(tokensA.size, tokensB.size);
      if (similarity >= 0.75) {
        duplicateCount++;
      }
    }

    if (duplicateCount >= 2 && articles[i].source_tier !== 1) {
      articles[i].is_pr_campaign = true;
      articles[i].suspected_astroturfing = true;
    }
  }
}

/**
 * Detects if an article cites a third-party source rather than reporting independently.
 * @param {string} text
 * @returns {string|null} Name of cited source, or null
 */
function detectCitedSource(text) {
  if (!text) return null;
  for (const pattern of CITATION_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim().slice(0, 40);
    }
  }
  return null;
}

/**
 * Formats a Date object or valid date string into MySQL DATETIME format (YYYY-MM-DD HH:MM:SS).
 * @param {Date|string|number} rawDate
 * @returns {string}
 */
function toMysqlDateTime(rawDate) {
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Strips HTML tags and normalizes whitespace cleanly.
 * @param {string} html
 * @returns {string}
 */
function stripHtmlAndNormalize(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>?/gm, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Semantic Gatekeeper: Filters out off-topic or irrelevant articles.
 * Enforces strict presence of entity keywords when query is TARGETED.
 * @param {Object} article
 * @param {Object} intent
 * @returns {boolean}
 */
function isRelevantToTopic(article, intent) {
  const text = `${article.title || ""} ${article.contentSnippet || ""}`.toLowerCase();

  if (intent.scope === "TARGETED" && intent.targetKeywords && intent.targetKeywords.length > 0) {
    const matched = intent.targetKeywords.some((kw) => text.includes(kw.toLowerCase()));
    if (!matched) {
      return false;
    }
  } else if (intent.scope === "BROAD" && intent.targetKeywords && intent.targetKeywords.length > 0) {
    const matchesKeyword = intent.targetKeywords.some((kw) => text.includes(kw.toLowerCase()));
    if (!matchesKeyword) {
      return false;
    }
  }

  return true;
}

/**
 * Generic RSS/Atom feed fetcher and parser.
 * @param {string} feedUrl
 * @param {string} defaultSource
 * @param {string} topic
 * @param {number} defaultTier
 * @returns {Promise<Array<Object>>}
 */
async function fetchRssFeed(feedUrl, defaultSource, topic, defaultTier = 2) {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];

    // RSS standard: <item>
    $("item").each((_, element) => {
      const el = $(element);
      const title = stripHtmlAndNormalize(el.find("title").text());
      const link = el.find("link").text().trim();
      const pubDateRaw = el.find("pubDate").text().trim();
      const rawSource = el.find("source").text().trim();
      const descriptionRaw = el.find("description").text() || el.find("content\\:encoded").text();
      const contentSnippet = stripHtmlAndNormalize(descriptionRaw).slice(0, MAX_SNIPPET_LENGTH);

      if (!title || !link) return;

      const meta = getSourceMeta(link || defaultSource);
      const displaySource = rawSource || meta.name || defaultSource;
      const cited = detectCitedSource(`${title} ${contentSnippet}`);

      items.push({
        topic: topic.trim().toLowerCase(),
        title,
        link,
        source: displaySource,
        source_tier: meta.tier || defaultTier,
        sourceTier: meta.tier || defaultTier,
        source_type: meta.type || "MAINSTREAM",
        sourceType: meta.type || "MAINSTREAM",
        source_country: meta.country || "Quốc tế",
        cited_root_source: cited,
        pubDate: toMysqlDateTime(pubDateRaw || new Date()),
        pub_date: toMysqlDateTime(pubDateRaw || new Date()),
        contentSnippet,
        content_snippet: contentSnippet,
        full_text: null
      });
    });

    // Atom standard: <entry>
    if (items.length === 0) {
      $("entry").each((_, element) => {
        const el = $(element);
        const title = stripHtmlAndNormalize(el.find("title").text());
        const link = el.find("link[href]").attr("href") || el.find("link").text().trim();
        const updatedRaw = el.find("updated").text() || el.find("published").text();
        const contentRaw = el.find("content").text() || el.find("summary").text();
        const contentSnippet = stripHtmlAndNormalize(contentRaw).slice(0, MAX_SNIPPET_LENGTH);

        if (!title || !link) return;

        const meta = getSourceMeta(link || defaultSource);
        const cited = detectCitedSource(`${title} ${contentSnippet}`);

        items.push({
          topic: topic.trim().toLowerCase(),
          title,
          link,
          source: meta.name || defaultSource,
          source_tier: meta.tier || defaultTier,
          sourceTier: meta.tier || defaultTier,
          source_type: meta.type || "MAINSTREAM",
          sourceType: meta.type || "MAINSTREAM",
          source_country: meta.country || "Quốc tế",
          cited_root_source: cited,
          pubDate: toMysqlDateTime(updatedRaw || new Date()),
          pub_date: toMysqlDateTime(updatedRaw || new Date()),
          contentSnippet,
          content_snippet: contentSnippet,
          full_text: null
        });
      });
    }

    return items;
  } catch {
    return [];
  }
}

/**
 * Fetches Google News RSS for a specific query and regional edition.
 * @param {string} query
 * @param {string} geoKey
 * @param {string} topic
 * @returns {Promise<Array<Object>>}
 */
async function fetchGoogleNews(query, geoKey, topic) {
  const geo = GEO_EDITIONS[geoKey] || GEO_EDITIONS.US;
  const encodedQuery = encodeURIComponent(query);
  const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=${geo.hl}&gl=${geo.gl}&ceid=${geo.ceid}`;

  try {
    const res = await fetch(rssUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];

    $("item").each((_, el) => {
      const item = $(el);
      const title = stripHtmlAndNormalize(item.find("title").text());
      const link = item.find("link").text().trim();
      const pubDateRaw = item.find("pubDate").text().trim();
      const rawSource = item.find("source").text().trim();
      const descriptionRaw = item.find("description").text().trim();
      const contentSnippet = stripHtmlAndNormalize(descriptionRaw).slice(0, MAX_SNIPPET_LENGTH);

      if (!title || !link) return;

      const meta = getSourceMeta(rawSource || link);
      const sourceName = rawSource ? `${rawSource} (${geo.name})` : meta.name;
      const cited = detectCitedSource(`${title} ${contentSnippet}`);

      items.push({
        topic: topic.trim().toLowerCase(),
        title,
        link,
        source: sourceName,
        source_tier: meta.tier,
        sourceTier: meta.tier,
        source_type: meta.type,
        sourceType: meta.type,
        source_country: meta.country,
        cited_root_source: cited,
        pubDate: toMysqlDateTime(pubDateRaw || new Date()),
        pub_date: toMysqlDateTime(pubDateRaw || new Date()),
        contentSnippet,
        content_snippet: contentSnippet,
        full_text: null
      });
    });

    return items;
  } catch {
    return [];
  }
}

/**
 * Scrapes Reddit via RSS/Atom feed for tech/community-oriented discussions (Tier 3).
 * @param {string} topic
 * @returns {Promise<Array<Object>>}
 */
async function scrapeReddit(topic) {
  const encodedTopic = encodeURIComponent(topic);
  const redditRssUrl = `https://www.reddit.com/search.rss?q=${encodedTopic}&sort=new&limit=10`;

  try {
    const res = await fetch(redditRssUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];

    $("entry").each((_, element) => {
      const el = $(element);
      const title = stripHtmlAndNormalize(el.find("title").text());
      const link = el.find("link[href]").attr("href") || "";
      const updatedRaw = el.find("updated").text().trim();
      const categoryLabel = el.find("category").attr("label") || "";
      const contentRaw = el.find("content").text().trim();
      const contentSnippet = stripHtmlAndNormalize(contentRaw).slice(0, MAX_SNIPPET_LENGTH);

      if (!title || !link) return;

      items.push({
        topic: topic.trim().toLowerCase(),
        title,
        link,
        source: categoryLabel ? `r/${categoryLabel}` : "Reddit Community",
        source_tier: 3,
        sourceTier: 3,
        source_type: "COMMUNITY",
        sourceType: "COMMUNITY",
        source_country: "Toàn cầu",
        cited_root_source: null,
        pubDate: toMysqlDateTime(updatedRaw || new Date()),
        pub_date: toMysqlDateTime(updatedRaw || new Date()),
        contentSnippet,
        content_snippet: contentSnippet,
        full_text: null
      });
    });

    return items;
  } catch {
    return [];
  }
}

/**
 * Comprehensive OSINT Scrape & Semantic Gatekeeping Pipeline v4.
 * 1. Intent & Entity Analysis
 * 2. Multi-nation Parallel Fetching (8s timeout)
 * 3. Semantic Relevance Gatekeeper (Discards off-topic articles)
 * 4. Anti-spam & Lineage/Citation Tagging
 * 5. Tiered Full-Text Scraping for top Tier-1 & Tier-2 articles
 * @param {string} topic
 * @returns {Promise<Array<Object>>}
 */
async function scrapeTopic(topic) {
  const normalizedTopic = (topic || "").trim();
  if (!normalizedTopic) return [];

  // Step 1: Analyze user intent and scope
  const intent = analyzeIntent(normalizedTopic);
  console.log(
    `[Scraper] Topic: "${normalizedTopic}" | Scope: ${intent.scope} | Pillar: ${intent.pillar} | Entity: ${intent.coreEntity || "None"}`
  );

  // Step 2: Build parallel fetch tasks
  const fetchTasks = [];

  // 2.1 Google News Geo-editions
  for (const { geo, query } of intent.geoSearchQueries) {
    fetchTasks.push(fetchGoogleNews(query, geo, normalizedTopic));
  }

  // 2.2 Direct Curated Feeds (for specific pillars)
  if (DIRECT_PILLAR_FEEDS[intent.pillar]) {
    for (const feed of DIRECT_PILLAR_FEEDS[intent.pillar]) {
      fetchTasks.push(fetchRssFeed(feed.url, feed.source, normalizedTopic, feed.tier || 2));
    }
  }

  // 2.3 Community feeds for Tech/AI
  if (intent.pillar === "TECH_AI") {
    fetchTasks.push(scrapeReddit(normalizedTopic));
  }

  // Step 3: Execute all in parallel with Promise.allSettled
  const results = await Promise.allSettled(fetchTasks);
  const rawArticles = [];

  for (const res of results) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      rawArticles.push(...res.value);
    }
  }

  console.log(`[Scraper] Raw fetched: ${rawArticles.length} articles across all channels.`);

  // Step 4: Semantic Gatekeeper, Anti-Spam & Deduplication
  const seenLinks = new Set();
  const seenTitles = new Set();
  const filteredArticles = [];

  for (const art of rawArticles) {
    if (!art.title || !art.link) continue;

    if (isPromotionalSpam(art.title, art.contentSnippet)) {
      continue;
    }

    if (!isRelevantToTopic(art, intent)) {
      continue;
    }

    const cleanLink = art.link.split("?")[0].trim().toLowerCase();
    const cleanTitle = art.title.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (seenLinks.has(cleanLink) || seenTitles.has(cleanTitle)) {
      continue;
    }

    seenLinks.add(cleanLink);
    seenTitles.add(cleanTitle);
    filteredArticles.push(art);

    if (filteredArticles.length >= MAX_ARTICLES_RETURNED) {
      break;
    }
  }

  // Detect Astroturfing / PR Seeding campaigns across articles
  flagAstroturfingCampaigns(filteredArticles);

  // Prioritize Tier 1 > Tier 2 > Tier 3
  filteredArticles.sort((a, b) => (a.source_tier || 3) - (b.source_tier || 3));

  // Step 5: Tiered Deep Full-Text Extraction for top Tier 1 & Tier 2 articles
  const deepCandidates = filteredArticles
    .filter((a) => (a.source_tier === 1 || a.source_tier === 2) && a.link && a.link.startsWith("http"))
    .slice(0, MAX_DEEP_FULLTEXT_ARTICLES);

  if (deepCandidates.length > 0) {
    console.log(`[Scraper] 📖 Deep Full-Text extraction initiated for ${deepCandidates.length} top articles...`);
    const deepResults = await Promise.allSettled(deepCandidates.map((art) => extractFullText(art.link)));

    deepResults.forEach((res, idx) => {
      if (res.status === "fulfilled" && res.value && res.value.length > 200) {
        deepCandidates[idx].full_text = res.value;
        deepCandidates[idx].content_snippet = res.value.slice(0, 800);
      }
    });
  }

  console.log(
    `[Scraper] ✅ Cleaned & Validated: ${filteredArticles.length} high-relevance articles (Deep-scraped: ${deepCandidates.filter((c) => c.full_text).length}).`
  );

  return filteredArticles;
}

module.exports = {
  scrapeTopic,
  fetchGoogleNews,
  fetchRssFeed,
  scrapeReddit,
  detectCitedSource,
  isRelevantToTopic,
  isPromotionalSpam,
  toMysqlDateTime,
  stripHtmlAndNormalize
};
