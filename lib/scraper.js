const cheerio = require("cheerio");

/**
 * Scraper module for Google News RSS and Reddit RSS.
 * Adheres strictly to SRP: Content scraping, extraction, and normalization only.
 * Never touches the database or sends messages.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 10000;
const MAX_SNIPPET_LENGTH = 800;

const TECH_KEYWORDS = [
  "dotnet",
  "node",
  "ai",
  "python",
  "code",
  "tech",
  "developer",
  "programming",
  "software",
  "javascript",
  "typescript",
  "cloud",
  "devops",
  "api",
  "database"
];

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
  "partner content"
];

/**
 * Checks if an article title or snippet contains promotional/ad markers.
 * @param {string} title
 * @param {string} snippet
 * @returns {boolean}
 */
function isPromotionalSpam(title, snippet) {
  const combined = `${title || ""} ${snippet || ""}`.toLowerCase();
  return SPAM_MARKERS.some((marker) => combined.includes(marker));
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
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a topic contains any tech/developer-oriented keyword.
 * @param {string} topic
 * @returns {boolean}
 */
function isTechTopic(topic) {
  const lower = topic.toLowerCase();
  return TECH_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Scrapes Google News RSS for a given topic.
 * @param {string} topic
 * @returns {Promise<Array<{topic: string, title: string, link: string, source: string, pubDate: string, contentSnippet: string}>>}
 */
async function scrapeGoogleNewsRss(topic) {
  const encodedTopic = encodeURIComponent(topic);
  const rssUrl = `https://news.google.com/rss/search?q=${encodedTopic}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const response = await fetch(rssUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      console.warn(`[Google News] HTTP ${response.status} for topic: "${topic}"`);
      return [];
    }

    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];

    $("item").each((_, element) => {
      const el = $(element);
      const title = el.find("title").text().trim();
      const link = el.find("link").text().trim();
      const pubDateRaw = el.find("pubDate").text().trim();
      const source = el.find("source").text().trim() || "Google News";
      const descriptionRaw = el.find("description").text().trim();
      const contentSnippet = stripHtmlAndNormalize(descriptionRaw).slice(0, MAX_SNIPPET_LENGTH);

      if (!title || !link) return;

      // Filter out promotional/ad content
      if (isPromotionalSpam(title, contentSnippet)) {
        return;
      }

      items.push({
        topic: topic.trim().toLowerCase(),
        title,
        link,
        source,
        pubDate: toMysqlDateTime(pubDateRaw || new Date()),
        contentSnippet
      });
    });

    return items;
  } catch (error) {
    console.error(`[Scraper Exception] Google News failed for topic "${topic}": ${error.message}`);
    return [];
  }
}

/**
 * Scrapes Reddit via old.reddit.com or www.reddit.com RSS/Atom feed for a tech-oriented topic.
 * Uses the RSS XML endpoint to bypass Reddit's JSON API blocks.
 * @param {string} topic
 * @returns {Promise<Array<{topic: string, title: string, link: string, source: string, pubDate: string, contentSnippet: string}>>}
 */
async function scrapeReddit(topic) {
  const encodedTopic = encodeURIComponent(topic);
  const redditRssUrl = `https://www.reddit.com/search.rss?q=${encodedTopic}&sort=new&limit=10`;

  try {
    const response = await fetch(redditRssUrl, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      console.warn(`[Reddit RSS] HTTP ${response.status} for topic: "${topic}"`);
      return [];
    }

    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];

    // Reddit RSS uses Atom format with <entry> tags
    $("entry").each((_, element) => {
      const el = $(element);
      const title = el.find("title").text().trim();
      const link = el.find("link[href]").attr("href") || "";
      const updatedRaw = el.find("updated").text().trim();
      const author = el.find("author name").text().trim();
      const categoryLabel = el.find("category").attr("label") || "";
      const contentRaw = el.find("content").text().trim();
      const contentSnippet = stripHtmlAndNormalize(contentRaw).slice(0, MAX_SNIPPET_LENGTH);

      if (!title || !link) return;

      // Filter out promotional/ad content
      if (isPromotionalSpam(title, contentSnippet)) {
        return;
      }

      const source = categoryLabel
        ? `r/${categoryLabel}`
        : author
          ? `u/${author}`
          : "Reddit";

      items.push({
        topic: topic.trim().toLowerCase(),
        title,
        link,
        source,
        pubDate: toMysqlDateTime(updatedRaw || new Date()),
        contentSnippet
      });
    });

    return items;
  } catch (error) {
    console.error(`[Scraper Exception] Reddit RSS failed for topic "${topic}": ${error.message}`);
    return [];
  }
}

/**
 * Executes a comprehensive scrape for a topic across Google News and (if applicable) Reddit.
 * Combines results safely without throwing exceptions.
 * @param {string} topic
 * @returns {Promise<Array<{topic: string, title: string, link: string, source: string, pubDate: string, contentSnippet: string}>>}
 */
async function scrapeTopic(topic) {
  const normalizedTopic = topic.trim().toLowerCase();
  const googleArticles = await scrapeGoogleNewsRss(normalizedTopic);

  let redditArticles = [];
  if (isTechTopic(normalizedTopic)) {
    redditArticles = await scrapeReddit(normalizedTopic);
  }

  return [...googleArticles, ...redditArticles];
}

module.exports = {
  scrapeGoogleNewsRss,
  scrapeReddit,
  scrapeTopic,
  isTechTopic,
  isPromotionalSpam,
  toMysqlDateTime,
  stripHtmlAndNormalize
};
