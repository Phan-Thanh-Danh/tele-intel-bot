const cheerio = require("cheerio");

/**
 * Scraper module for Google News RSS and Reddit API.
 * Adheres strictly to SRP: Content scraping, extraction, and normalization only.
 * Never touches the database or sends messages.
 */

const USER_AGENT = "Mozilla/5.0 (compatible; TeleIntelBot/1.0; +https://github.com/tele-intel-bot)";
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
 * Strips HTML tags from text.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, "").trim();
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
      signal: AbortSignal.timeout(10000)
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
      const contentSnippet = stripHtml(descriptionRaw).slice(0, 500);

      if (!title || !link) return;

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
 * Scrapes Reddit Search API for a tech-oriented topic.
 * @param {string} topic
 * @returns {Promise<Array<{topic: string, title: string, link: string, source: string, pubDate: string, contentSnippet: string}>>}
 */
async function scrapeReddit(topic) {
  const encodedTopic = encodeURIComponent(topic);
  const redditUrl = `https://www.reddit.com/search.json?q=${encodedTopic}&sort=hot&limit=10`;

  try {
    const response = await fetch(redditUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.warn(`[Reddit] HTTP ${response.status} for topic: "${topic}"`);
      return [];
    }

    const data = await response.json();
    const children = data?.data?.children;
    if (!Array.isArray(children)) return [];

    const items = [];
    for (const post of children) {
      const p = post.data;
      if (!p || !p.title) continue;

      const link = p.permalink
        ? `https://reddit.com${p.permalink}`
        : p.url || `https://reddit.com/r/${p.subreddit}`;
      const source = p.subreddit_name_prefixed || "Reddit";
      const pubDate = toMysqlDateTime(p.created_utc ? p.created_utc * 1000 : new Date());
      const contentSnippet = stripHtml(p.selftext || p.title).slice(0, 500);

      items.push({
        topic: topic.trim().toLowerCase(),
        title: p.title.trim(),
        link,
        source,
        pubDate,
        contentSnippet
      });
    }

    return items;
  } catch (error) {
    console.error(`[Scraper Exception] Reddit failed for topic "${topic}": ${error.message}`);
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
  toMysqlDateTime
};
