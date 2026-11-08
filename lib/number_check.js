/**
 * lib/number_check.js
 *
 * Phase 5.2 - Number verification in code (no extra LLM call).
 * Checks every number written by the model in a synthesized digest against source articles.
 * Never deletes or alters numbers. Only flags numbers that cannot be verified in the sources,
 * attaching metadata to the digest for display warnings.
 *
 * Pure functions, zero database access, never throws.
 */

"use strict";

const MAX_FIELD_LENGTH = 20000;
const MAX_TOKENS_PER_EVENT = 50;
const MAX_DERIVATION_CANDIDATES = 30;
const MAX_RAW_LENGTH = 40;

// Known technical / acronym prefixes to skip
const TECH_PREFIX_REGEX = /(?:(?<=^|[\s([{\-])(?:[fmabqv]|gpt|covid|iphone|llama|boeing|airbus))[-\s]?$/i;

// Unit Kinds mapping
const UNIT_KINDS = {
  // Percentage
  "%": "PERCENT",
  "percent": "PERCENT",
  "phần trăm": "PERCENT",
  "phan tram": "PERCENT",

  // Currency
  "$": "CURRENCY_USD",
  "usd": "CURRENCY_USD",
  "đô": "CURRENCY_USD",
  "do": "CURRENCY_USD",
  "dollar": "CURRENCY_USD",
  "đô la": "CURRENCY_USD",
  "do la": "CURRENCY_USD",
  "vnd": "CURRENCY_VND",
  "đồng": "CURRENCY_VND",
  "dong": "CURRENCY_VND",
  "đ": "CURRENCY_VND",
  "vnđ": "CURRENCY_VND",
  "€": "CURRENCY_EUR",
  "eur": "CURRENCY_EUR",
  "euro": "CURRENCY_EUR",

  // Energy & Power (canonical base: GWh, MW)
  "gwh": "ENERGY_GWH",
  "mwh": "ENERGY_MWH",
  "kwh": "ENERGY_KWH",
  "mw": "POWER_MW",
  "kw": "POWER_KW",
  "w": "POWER_W",

  // Data size
  "tb": "DATA_TB",
  "gb": "DATA_GB",
  "mb": "DATA_MB",
  "kb": "DATA_KB",

  // Distance / Time / Mass
  "km": "LENGTH_KM",
  "m": "LENGTH_M",
  "cm": "LENGTH_CM",
  "mm": "LENGTH_MM",
  "ms": "TIME_MS",
  "s": "TIME_S",
  "giây": "TIME_S",
  "giay": "TIME_S",
  "kg": "MASS_KG",
  "tấn": "MASS_TON",
  "tan": "MASS_TON",
  "tạ": "MASS_TA",
  "ta": "MASS_TA",
  "yến": "MASS_YEN",
  "yen": "MASS_YEN",

  // Business & Count units
  "người": "COUNT_PERSON",
  "nguoi": "COUNT_PERSON",
  "đơn hàng": "COUNT_ORDER",
  "don hang": "COUNT_ORDER",
  "đơn": "COUNT_ORDER",
  "don": "COUNT_ORDER",
  "order": "COUNT_ORDER",
  "orders": "COUNT_ORDER",
  "vé": "COUNT_TICKET",
  "ve": "COUNT_TICKET",
  "ticket": "COUNT_TICKET",
  "tickets": "COUNT_TICKET",
  "ghế": "COUNT_SEAT",
  "ghe": "COUNT_SEAT",
  "seat": "COUNT_SEAT",
  "seats": "COUNT_SEAT",
  "xe": "COUNT_VEHICLE",
  "chiếc xe": "COUNT_VEHICLE",
  "chiec xe": "COUNT_VEHICLE",
  "car": "COUNT_VEHICLE",
  "cars": "COUNT_VEHICLE",
  "căn": "COUNT_HOUSING",
  "can": "COUNT_HOUSING",
  "cổ phiếu": "COUNT_SHARE",
  "co phieu": "COUNT_SHARE",
  "share": "COUNT_SHARE",
  "shares": "COUNT_SHARE",
  "doanh nghiệp": "COUNT_COMPANY",
  "doanh nghiep": "COUNT_COMPANY",
  "công ty": "COUNT_COMPANY",
  "cong ty": "COUNT_COMPANY",
  "nhà máy": "COUNT_FACTORY",
  "nha may": "COUNT_FACTORY",
  "dự án": "COUNT_PROJECT",
  "du an": "COUNT_PROJECT",
  "chuyến": "COUNT_TRIP",
  "chuyen": "COUNT_TRIP",
  "bàn": "COUNT_SPORTS",
  "ban": "COUNT_SPORTS",
  "điểm": "COUNT_SPORTS",
  "diem": "COUNT_SPORTS",
  "trận": "COUNT_SPORTS",
  "tran": "COUNT_SPORTS"
};

// Magnitude Multipliers
const MAGNITUDES = {
  "nghìn tỷ": 1e12,
  "ngàn tỷ": 1e12,
  "nghin ty": 1e12,
  "ngan ty": 1e12,
  "trillion": 1e12,
  "tỷ": 1e9,
  "tỉ": 1e9,
  "ty": 1e9,
  "ti": 1e9,
  "billion": 1e9,
  "bn": 1e9,
  "b": 1e9,
  "triệu": 1e6,
  "trieu": 1e6,
  "million": 1e6,
  "m": 1e6,
  "nghìn": 1e3,
  "ngàn": 1e3,
  "nghin": 1e3,
  "ngan": 1e3,
  "thousand": 1e3,
  "k": 1e3
};

// Known technical / acronym suffixes to skip (where digits touch letters)
const KNOWN_IDENTIFIERS_SET = new Set([
  "g", "k", "d", "v", "q", "p", "a", "b", "c", "e", "f", "h", "i", "j", "l", "n", "o", "r", "s", "t", "u", "x", "y", "z"
]);

/**
 * Checks if number check is enabled in environment.
 * Default is ON unless NUMBER_CHECK=off.
 */
function isNumberCheckEnabled() {
  const val = process.env.NUMBER_CHECK;
  if (!val) return true;
  return val.trim().toLowerCase() !== "off";
}

/**
 * Pre-cleans and normalizes text before extraction.
 */
function cleanText(text) {
  if (typeof text !== "string") return "";
  let s = text;
  if (s.length > MAX_FIELD_LENGTH) {
    s = s.slice(0, MAX_FIELD_LENGTH);
  }

  // 1. NFC normalization
  s = s.normalize("NFC");

  // 2. Remove previously injected warning lines (idempotency)
  s = s.replace(/Số liệu chưa đối chiếu được với nguồn:[^\n]*/gi, "");

  // 3. Strip Markdown bold/italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");

  // 4. Strip HTML tags
  s = s.replace(/<[^>]+>/g, " ");

  // 5. Normalize whitespace characters (NBSP, narrow NBSP, thin space)
  s = s.replace(/[\u00A0\u202F\u2009\u2000-\u200B]/g, " ");

  // 6. Normalize minus and dash characters
  s = s.replace(/[\u2212\u2013\u2014]/g, "-");

  // 7. Fullwidth digits to ASCII
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

  return s;
}

/**
 * Strips diacritics and lowercases a string for fuzzy unit matching.
 */
function stripDiacritics(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Parses numeric string with potential ambiguous separators (. or ,)
 * into a set of candidate numbers.
 * E.g. "1.234" -> [1234, 1.234]
 *      "1,234" -> [1234, 1.234]
 *      "1.234,56" -> [1234.56]
 *      "1,234.56" -> [1234.56]
 */
function parseCandidateNumbers(numStr) {
  if (!numStr || typeof numStr !== "string") return [];
  const s = numStr.trim();
  const candidates = new Set();

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot > lastComma) {
      // English style: 1,234.56
      const v = parseFloat(s.replace(/,/g, ""));
      if (!isNaN(v)) candidates.add(v);
    } else {
      // European/Vietnamese style: 1.234,56
      const v = parseFloat(s.replace(/\./g, "").replace(/,/g, "."));
      if (!isNaN(v)) candidates.add(v);
    }
    return Array.from(candidates);
  }

  if (hasDot && !hasComma) {
    const parts = s.split(".");
    if (parts.length > 2) {
      // Multiple dots: 1.234.567 -> thousands
      const v = parseFloat(s.replace(/\./g, ""));
      if (!isNaN(v)) candidates.add(v);
    } else {
      // Exactly 1 dot
      const decVal = parseFloat(s);
      if (!isNaN(decVal)) candidates.add(decVal);
      if (parts[1].length === 3) {
        // e.g. 1.234 or 10.000 could also be thousands
        const thouVal = parseFloat(s.replace(/\./g, ""));
        if (!isNaN(thouVal)) candidates.add(thouVal);
      }
    }
    return Array.from(candidates);
  }

  if (hasComma && !hasDot) {
    const parts = s.split(",");
    if (parts.length > 2) {
      // Multiple commas: 1,234,567 -> thousands
      const v = parseFloat(s.replace(/,/g, ""));
      if (!isNaN(v)) candidates.add(v);
    } else {
      // Exactly 1 comma
      const decVal = parseFloat(s.replace(/,/g, "."));
      if (!isNaN(decVal)) candidates.add(decVal);
      if (parts[1].length === 3) {
        const thouVal = parseFloat(s.replace(/,/g, ""));
        if (!isNaN(thouVal)) candidates.add(thouVal);
      }
    }
    return Array.from(candidates);
  }

  const plainVal = parseFloat(s);
  if (!isNaN(plainVal)) candidates.add(plainVal);
  return Array.from(candidates);
}

/**
 * Counts stated decimal places in a number representation.
 */
function getStatedDecimals(numStr) {
  if (!numStr) return 0;
  const s = numStr.trim();
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const sepIdx = Math.max(lastDot, lastComma);
  if (sepIdx === -1) return 0;
  const after = s.slice(sepIdx + 1);
  if (after.length <= 2) return after.length;
  // If 3 digits, usually thousands separator rather than decimals
  return 0;
}

/**
 * Resolves unit and magnitude from a text string.
 */
function resolveUnitAndMagnitude(rawUnit) {
  if (!rawUnit) return { unitKind: "GENERIC_COUNT", multiplier: 1, rawUnit: "", matchedUnitStr: "" };

  const words = rawUnit.trim().split(/\s+/);
  let multiplier = 1;
  let unitKind = null;
  const matchedWords = [];

  const w0 = stripDiacritics(words[0] || "");
  const w01 = words.length > 1 ? stripDiacritics(words[0] + " " + words[1]) : "";

  // 1. Check magnitudes (multi-word like 'nghìn tỷ' or single-word like 'tỷ', 'triệu')
  if (w01 && MAGNITUDES[w01]) {
    multiplier = MAGNITUDES[w01];
    matchedWords.push(words[0], words[1]);
  } else if (MAGNITUDES[w0]) {
    multiplier = MAGNITUDES[w0];
    matchedWords.push(words[0]);
  }

  // 2. Check unit kinds on subsequent words
  const checkWords = words.slice(matchedWords.length);
  if (checkWords.length > 0) {
    const cw0 = stripDiacritics(checkWords[0]);
    const cw01 = checkWords.length > 1 ? stripDiacritics(checkWords[0] + " " + checkWords[1]) : "";

    if (cw01 && UNIT_KINDS[cw01]) {
      unitKind = UNIT_KINDS[cw01];
      matchedWords.push(checkWords[0], checkWords[1]);
    } else if (UNIT_KINDS[cw0]) {
      unitKind = UNIT_KINDS[cw0];
      matchedWords.push(checkWords[0]);
    } else {
      for (const [uk, uval] of Object.entries(UNIT_KINDS)) {
        const normUk = stripDiacritics(uk);
        if (cw0 === normUk || cw0.startsWith(normUk + "/") || cw0.endsWith("/" + normUk)) {
          unitKind = uval;
          matchedWords.push(checkWords[0]);
          break;
        }
      }
    }
  }

  // 3. If no magnitude was matched, check if first words match a unit directly
  if (!unitKind && matchedWords.length === 0 && words.length > 0) {
    if (w01 && UNIT_KINDS[w01]) {
      unitKind = UNIT_KINDS[w01];
      matchedWords.push(words[0], words[1]);
    } else if (UNIT_KINDS[w0]) {
      unitKind = UNIT_KINDS[w0];
      matchedWords.push(words[0]);
    } else {
      for (const [uk, uval] of Object.entries(UNIT_KINDS)) {
        const normUk = stripDiacritics(uk);
        if (w0 === normUk || w0.startsWith(normUk + "/") || w0.endsWith("/" + normUk)) {
          unitKind = uval;
          matchedWords.push(words[0]);
          break;
        }
      }
    }
  }

  if (!unitKind) {
    if (multiplier > 1) {
      unitKind = "DIMENSIONLESS_MAGNITUDE";
    } else {
      unitKind = "GENERIC_COUNT";
    }
  }

  const matchedUnitStr = matchedWords.join(" ");
  return { unitKind, multiplier, rawUnit: matchedUnitStr || rawUnit.trim(), matchedUnitStr };
}

/**
 * Tests if a number match at a given index should be skipped.
 */
function shouldSkipMatch(text, matchIndex, matchStr) {
  const prefix = text.slice(Math.max(0, matchIndex - 30), matchIndex);
  const suffix = text.slice(matchIndex + matchStr.length, Math.min(text.length, matchIndex + matchStr.length + 30));

  // 1. Preceded by ordinal / time / version markers
  const ordinalRegex = /(?:ngày|tháng|năm|quý|quy|lúc|luc|giờ|gio|thứ|thu|giai đoạn|giai đoan|vòng|vong|hiệp|hiep|phút|phut|phần|phan|tập|tap|phiên bản|phien ban|version|v|q)\s*$/i;
  if (ordinalRegex.test(prefix)) {
    return { skip: true, reason: "preceded_by_ordinal_or_time_marker" };
  }

  // 2. Preceded by technical acronym / product prefix: GPT-4, iPhone 16, F-35, COVID-19, v2, Q3
  if (TECH_PREFIX_REGEX.test(prefix)) {
    return { skip: true, reason: "identifier_prefix" };
  }

  // 3. Dates: e.g. 8/11, 08/11/2026, 2026-11-08, 08-11-2026
  if (/^\s*[\/-]\s*\d{1,4}/.test(suffix) || /[\/-]\s*$/.test(prefix)) {
    return { skip: true, reason: "part_of_date" };
  }

  // 4. Times: e.g. 7h30, 07:30, 19 giờ
  if (/^h\d{2}\b/i.test(suffix) || /^\s*(?:h(?!\p{L})|giờ|gio(?![\p{L}]))/iu.test(suffix) || /^\s*:\s*\d{2}\b/.test(suffix) || /:\s*$/.test(prefix)) {
    return { skip: true, reason: "part_of_time" };
  }

  // 5. Standalone Years (1900 - 2100) without attached unit
  const numOnly = matchStr.replace(/[^\d]/g, "");
  if (/^(?:19|20)\d{2}$/.test(numOnly)) {
    const afterWord = suffix.trim().split(/\s+/)[0] || "";
    const isUnit = resolveUnitAndMagnitude(afterWord).unitKind !== "GENERIC_COUNT";
    if (!isUnit) {
      return { skip: true, reason: "standalone_year" };
    }
  }

  // 6. Telecom generation identifier: 5G, 4G, 3G, 6G
  const fullWord = text.slice(matchIndex).match(/^[0-9]+[\p{L}0-9_-]+/u);
  if (fullWord && /^[3-6]g\b/i.test(fullWord[0])) {
    return { skip: true, reason: "telecom_generation_identifier" };
  }

  // 7. Identifiers where digits touch letters outside recognized units
  const charBefore = matchIndex > 0 ? text[matchIndex - 1] : " ";
  const charAfter = matchIndex + matchStr.length < text.length ? text[matchIndex + matchStr.length] : " ";

  if (/[a-zA-Z-]/.test(charBefore) && !/[\s([{"']/.test(charBefore)) {
    // E.g. GPT-4, COVID-19, iPhone16
    return { skip: true, reason: "identifier_prefix" };
  }

  // Check if character after is letter (e.g. G7, B2B)
  if (/[a-zA-Z]/.test(charAfter)) {
    const wordAfter = text.slice(matchIndex).match(/^[0-9]+([a-zA-Z0-9_-]+)/);
    if (wordAfter && wordAfter[1]) {
      const suffixCandidate = wordAfter[1].toLowerCase();
      const resolved = resolveUnitAndMagnitude(suffixCandidate);
      if (resolved.unitKind === "GENERIC_COUNT" && resolved.multiplier === 1) {
        return { skip: true, reason: "identifier_suffix" };
      }
    }
  }

  return { skip: false };
}

/**
 * Extracts checkable numbers from clean text.
 */
function extractNumbers(rawText, sourceField = "unknown") {
  const text = cleanText(rawText);
  if (!text) return { extracted: [], skipped: [] };

  const extracted = [];
  const skipped = [];

  // 1. Sports Scores: e.g. 3-1, 3–1, 3:1
  const scoreRegex = /\b(\d{1,2})\s*[-–—:]\s*(\d{1,2})\b/g;
  let sm;
  while ((sm = scoreRegex.exec(text)) !== null) {
    if (extracted.length >= MAX_TOKENS_PER_EVENT) break;
    const matchStr = sm[0];
    const score1 = parseInt(sm[1], 10);
    const score2 = parseInt(sm[2], 10);

    const skipCheck = shouldSkipMatch(text, sm.index, matchStr);
    if (skipCheck.skip) {
      skipped.push({ raw: matchStr, field: sourceField, reason: skipCheck.reason });
      continue;
    }

    extracted.push({
      raw: matchStr.slice(0, MAX_RAW_LENGTH),
      field: sourceField,
      type: "SCORE",
      unitKind: "SCORE",
      scores: [Math.min(score1, score2), Math.max(score1, score2)],
      candidates: [score1, score2],
      multiplier: 1,
      statedDecimals: 0
    });
  }

  // 2. Ranges: e.g. "5-7 triệu", "50-70 người", "10 - 15%"
  const rangeRegex = /\b(\d[\d,\.]*)\s*[-–—]\s*(\d[\d,\.]*)\s*([%$\/€\p{L}]+(?:\s+[%$\/€\p{L}]+)?)\b/gu;
  let rm;
  while ((rm = rangeRegex.exec(text)) !== null) {
    if (extracted.length >= MAX_TOKENS_PER_EVENT) break;
    const rawMatch = rm[0];
    const num1Str = rm[1];
    const num2Str = rm[2];
    const unitPart = rm[3];

    const skipCheck = shouldSkipMatch(text, rm.index, rawMatch);
    if (skipCheck.skip) {
      skipped.push({ raw: rawMatch, field: sourceField, reason: skipCheck.reason });
      continue;
    }

    const { unitKind, multiplier } = resolveUnitAndMagnitude(unitPart);
    if (unitKind !== "GENERIC_COUNT" || multiplier > 1) {
      for (const numPart of [num1Str, num2Str]) {
        const cands = parseCandidateNumbers(numPart);
        extracted.push({
          raw: `${numPart} ${unitPart}`.slice(0, MAX_RAW_LENGTH),
          field: sourceField,
          type: "RANGE_PART",
          unitKind,
          multiplier,
          candidates: cands.map((c) => c * multiplier),
          baseCandidates: cands,
          statedDecimals: getStatedDecimals(numPart)
        });
      }
    }
  }

  // 3. Currency prefix: e.g. $100M, $3.2B, €50
  const currPrefixRegex = /([\$€])\s*(\d[\d,\.]*)\s*([\p{L}]*)/gu;
  let cpm;
  while ((cpm = currPrefixRegex.exec(text)) !== null) {
    if (extracted.length >= MAX_TOKENS_PER_EVENT) break;
    const symbol = cpm[1];
    const numPart = cpm[2];
    const magPart = cpm[3] || "";
    const fullRaw = cpm[0].trim();

    const unitKind = symbol === "$" ? "CURRENCY_USD" : "CURRENCY_EUR";
    let multiplier = 1;
    if (magPart) {
      const magNorm = stripDiacritics(magPart);
      if (MAGNITUDES[magNorm]) multiplier = MAGNITUDES[magNorm];
    }

    const cands = parseCandidateNumbers(numPart);
    extracted.push({
      raw: fullRaw.slice(0, MAX_RAW_LENGTH),
      field: sourceField,
      type: "CURRENCY_PREFIX",
      unitKind,
      multiplier,
      candidates: cands.map((c) => c * multiplier),
      baseCandidates: cands,
      statedDecimals: getStatedDecimals(numPart)
    });
  }

  // 4. Standard numbers with attached or trailing unit / magnitude
  // Matches: 10.000 đơn hàng, 12 GWh, 5%, 1.5 tỷ, 100 triệu USD, etc.
  const stdRegex = /\b(\d[\d,\.]*)\s*([%$\/€\p{L}]+(?:\s+[%$\/€\p{L}]+)?)?\b/gu;
  let m;
  while ((m = stdRegex.exec(text)) !== null) {
    if (extracted.length >= MAX_TOKENS_PER_EVENT) break;
    const matchStr = m[0];
    const numPart = m[1];
    const unitPart = (m[2] || "").trim();

    // Check if match was already part of score or range or currency
    const idx = m.index;
    const alreadyExtracted = extracted.some(
      (e) => text.indexOf(e.raw) <= idx && idx < text.indexOf(e.raw) + e.raw.length
    );
    if (alreadyExtracted) continue;

    const skipCheck = shouldSkipMatch(text, idx, matchStr);
    if (skipCheck.skip) {
      skipped.push({ raw: matchStr.slice(0, MAX_RAW_LENGTH), field: sourceField, reason: skipCheck.reason });
      continue;
    }

    const { unitKind, multiplier, matchedUnitStr } = resolveUnitAndMagnitude(unitPart);

    // If unitKind is GENERIC_COUNT and multiplier is 1:
    // Only keep if the number has a thousands separator (e.g. 10.000) or looks like a significant number
    if (unitKind === "GENERIC_COUNT" && multiplier === 1) {
      const isThousands = (numPart.includes(".") || numPart.includes(",")) && numPart.length >= 4;
      if (!isThousands) {
        // Plain standalone small digit without unit -> skip
        skipped.push({ raw: matchStr.slice(0, MAX_RAW_LENGTH), field: sourceField, reason: "plain_small_number" });
        continue;
      }
    }

    const cands = parseCandidateNumbers(numPart);
    const rawToStore = (matchedUnitStr ? `${numPart} ${matchedUnitStr}` : matchStr).slice(0, MAX_RAW_LENGTH);
    extracted.push({
      raw: rawToStore,
      field: sourceField,
      type: "STANDARD_NUMBER",
      unitKind,
      multiplier,
      candidates: cands.map((c) => c * multiplier),
      baseCandidates: cands,
      statedDecimals: getStatedDecimals(numPart)
    });
  }

  return { extracted, skipped };
}

/**
 * Checks whether two unit kinds are compatible.
 */
function areUnitKindsCompatible(u1, u2) {
  if (u1 === u2) return true;
  // Generic counts can match specific counts conservatively to avoid false-flagging
  const isCount1 = u1 === "GENERIC_COUNT" || u1.startsWith("COUNT_");
  const isCount2 = u2 === "GENERIC_COUNT" || u2.startsWith("COUNT_");
  if (isCount1 && isCount2) return true;

  // Dimensionless magnitude can match counts
  if (u1 === "DIMENSIONLESS_MAGNITUDE" && isCount2) return true;
  if (u2 === "DIMENSIONLESS_MAGNITUDE" && isCount1) return true;

  return false;
}

/**
 * Checks if a target model number matches any source number directly.
 */
function checkDirectMatch(targetNum, sourceNumbers) {
  // Score matching
  if (targetNum.type === "SCORE") {
    for (const src of sourceNumbers) {
      if (src.type === "SCORE") {
        if (src.scores[0] === targetNum.scores[0] && src.scores[1] === targetNum.scores[1]) {
          return { match: true, src };
        }
      }
    }
    return { match: false };
  }

  // Numeric candidate matching
  for (const src of sourceNumbers) {
    if (src.type === "SCORE") continue;

    // Check unit kind compatibility
    if (!areUnitKindsCompatible(targetNum.unitKind, src.unitKind)) {
      continue;
    }

    // 1. Intersection of candidate values
    for (const tVal of targetNum.candidates) {
      for (const sVal of src.candidates) {
        // Exact match
        if (Math.abs(tVal - sVal) < 1e-5) {
          return { match: true, src };
        }

        // Rounding match (only if magnitudes are compatible)
        const tol = 0.5 * Math.pow(10, -targetNum.statedDecimals) * targetNum.multiplier + 1e-9;
        if (Math.abs(tVal - sVal) <= tol) {
          // Reject if magnitudes differ by more than 1 order
          const ratio = Math.max(tVal, sVal) / Math.max(Math.min(tVal, sVal), 1e-9);
          if (ratio < 2.0) {
            return { match: true, src, rounding: true };
          }
        }
      }
    }
  }

  return { match: false };
}

/**
 * Checks if a target number can be derived as a sum, difference, or percent change
 * of two numbers from the source reference.
 */
function checkDerivedMatch(targetNum, sourceNumbers) {
  if (targetNum.type === "SCORE") return { derived: false };

  // Filter reference numbers with compatible unit kind
  const pool = sourceNumbers.slice(0, MAX_DERIVATION_CANDIDATES);

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];

      // Must have compatible unit kind
      if (!areUnitKindsCompatible(a.unitKind, b.unitKind)) continue;

      for (const aVal of a.candidates) {
        for (const bVal of b.candidates) {
          for (const tVal of targetNum.candidates) {
            // 1. Sum: a + b = target
            const sumVal = aVal + bVal;
            if (Math.abs(sumVal - tVal) < 1e-5) {
              return {
                derived: true,
                formula: `${a.raw} + ${b.raw} = ${targetNum.raw}`
              };
            }

            // 2. Difference: |a - b| = target
            const diffVal = Math.abs(aVal - bVal);
            if (Math.abs(diffVal - tVal) < 1e-5 && diffVal > 0) {
              return {
                derived: true,
                formula: `|${a.raw} - ${b.raw}| = ${targetNum.raw}`
              };
            }

            // 3. Percent Change: |a - b| / a * 100 = target (if target is percent)
            if (targetNum.unitKind === "PERCENT" && aVal > 0) {
              const pctChange = (Math.abs(aVal - bVal) / aVal) * 100;
              if (Math.abs(pctChange - tVal) < 1e-2) {
                return {
                  derived: true,
                  formula: `|${a.raw} - ${b.raw}| / ${a.raw} = ${targetNum.raw}`
                };
              }
            }
          }
        }
      }
    }
  }

  return { derived: false };
}

/**
 * Extracts numbers from a collection of article objects and recent event titles.
 */
function extractSourceCorpusNumbers(articles = [], recentEvents = []) {
  const allNumbers = [];
  const allSkipped = [];

  for (const art of articles) {
    if (!art) continue;
    const text = [art.title, art.content_snippet, art.full_text].filter(Boolean).join(" ");
    const { extracted, skipped } = extractNumbers(text, art.source || "article");
    allNumbers.push(...extracted);
    allSkipped.push(...skipped);
  }

  for (const evt of recentEvents) {
    if (!evt || !evt.title) continue;
    const { extracted, skipped } = extractNumbers(evt.title, "recent_event");
    allNumbers.push(...extracted);
    allSkipped.push(...skipped);
  }

  return { numbers: allNumbers, skipped: allSkipped };
}

/**
 * Verifies all numbers in an individual event.
 *
 * @param {Object} event - The single event object
 * @param {Array<Object>} allArticles - All articles available in this digest
 * @param {Array<Object>} recentEvents - Previously delivered event history
 * @returns {Object} Updated event with number_check attached
 */
function verifyEventNumbers(event, allArticles = [], recentEvents = []) {
  if (!event || typeof event !== "object") return event;

  try {
    // 1. Gather all text fields from event
    const eventTextBlocks = [
      { text: event.title, field: "title" },
      { text: event.core_verdict, field: "core_verdict" },
      { text: event.impact, field: "impact" }
    ];

    if (Array.isArray(event.key_highlights)) {
      event.key_highlights.forEach((hl, idx) => {
        eventTextBlocks.push({ text: hl, field: `key_highlights[${idx}]` });
      });
    }

    // Extract all checkable numbers in this event
    const eventNumbers = [];
    const eventSkipped = [];
    for (const block of eventTextBlocks) {
      if (!block.text) continue;
      const { extracted, skipped } = extractNumbers(block.text, block.field);
      eventNumbers.push(...extracted);
      eventSkipped.push(...skipped);
    }

    // 2. Build Reference Corpora
    // A. Cited articles (based on event.source_indices)
    const rawIndices = Array.isArray(event.source_indices) ? event.source_indices : [];
    const validIndices = rawIndices
      .map((idx) => parseInt(idx, 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= allArticles.length);

    const isCitationInvalid = validIndices.length === 0;
    const citedArticles = validIndices.map((idx) => allArticles[idx - 1]);
    const { numbers: citedNumbers } = extractSourceCorpusNumbers(citedArticles, []);

    // B. Batch articles (all articles + recentEvents)
    const { numbers: batchNumbers } = extractSourceCorpusNumbers(allArticles, recentEvents);

    // 3. Verify each number
    const notFound = [];
    const derivedList = [];
    const citationMismatches = [];

    // Deduplicate event numbers by raw string + field
    const seen = new Set();
    const uniqueEventNumbers = [];
    for (const num of eventNumbers) {
      const key = `${num.raw}_${num.field}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEventNumbers.push(num);
      }
    }

    for (const target of uniqueEventNumbers) {
      // 1. Check cited articles first (if valid citation exists)
      if (!isCitationInvalid) {
        const citedMatch = checkDirectMatch(target, citedNumbers);
        if (citedMatch.match) {
          continue; // found_in_cited -> OK
        }

        const citedDerived = checkDerivedMatch(target, citedNumbers);
        if (citedDerived.derived) {
          derivedList.push({
            raw: target.raw,
            field: target.field,
            formula: citedDerived.formula
          });
          continue; // derived_ok -> OK
        }
      }

      // 2. Check batch articles (all articles + history)
      const batchMatch = checkDirectMatch(target, batchNumbers);
      if (batchMatch.match) {
        // found_in_batch_only: citation mismatch, log only, do not warn reader
        citationMismatches.push({
          raw: target.raw,
          field: target.field,
          status: "found_in_batch_only"
        });
        continue;
      }

      const batchDerived = checkDerivedMatch(target, batchNumbers);
      if (batchDerived.derived) {
        derivedList.push({
          raw: target.raw,
          field: target.field,
          formula: batchDerived.formula
        });
        continue;
      }

      // 3. Not found in cited AND not found in batch -> NOT_FOUND (warn reader)
      notFound.push({
        raw: target.raw,
        field: target.field
      });
    }

    // 4. Attach number_check metadata idempotently
    event.number_check = {
      checked: true,
      not_found: notFound,
      derived: derivedList,
      notes: {
        citation_invalid: isCitationInvalid,
        citation_mismatches: citationMismatches,
        skipped: eventSkipped
      }
    };

    return event;
  } catch (err) {
    console.error("[NumberCheck] Error checking event numbers:", err.message);
    event.number_check = {
      checked: false,
      not_found: [],
      derived: [],
      notes: { error: err.message }
    };
    return event;
  }
}

/**
 * Verifies numbers in the overall digest overview field against the batch.
 */
function verifyOverviewNumbers(overviewText, allArticles = [], recentEvents = []) {
  if (!overviewText || typeof overviewText !== "string") return null;
  try {
    const { extracted } = extractNumbers(overviewText, "overview");
    const { numbers: batchNumbers } = extractSourceCorpusNumbers(allArticles, recentEvents);

    const notFound = [];
    for (const target of extracted) {
      const match = checkDirectMatch(target, batchNumbers);
      if (!match.match) {
        const derived = checkDerivedMatch(target, batchNumbers);
        if (!derived.derived) {
          notFound.push({ raw: target.raw, field: "overview" });
        }
      }
    }
    return { not_found: notFound };
  } catch {
    return null;
  }
}

/**
 * Main entry point: Verifies all numbers in a synthesized digest JSON.
 * Pure function, never throws, idempotent.
 *
 * @param {Object} digest - { overview, events }
 * @param {Array<Object>} articles - Source articles
 * @param {Array<Object>} recentEvents - Recent history events
 * @returns {Object} The same digest with number_check attached to events
 */
function checkDigestNumbers(digest, articles = [], recentEvents = []) {
  if (!digest || typeof digest !== "object") return digest;

  // If disabled via config, return silently
  if (!isNumberCheckEnabled()) {
    return digest;
  }

  try {
    if (Array.isArray(digest.events)) {
      for (const event of digest.events) {
        verifyEventNumbers(event, articles, recentEvents);
      }
    }

    if (typeof digest.overview === "string" && digest.overview.trim()) {
      const overviewCheck = verifyOverviewNumbers(digest.overview, articles, recentEvents);
      if (overviewCheck && overviewCheck.not_found.length > 0) {
        digest.overview_number_check = overviewCheck;
      }
    }

    return digest;
  } catch (err) {
    console.error("[NumberCheck] Fatal error in checkDigestNumbers:", err.message);
    return digest;
  }
}

module.exports = {
  checkDigestNumbers,
  verifyEventNumbers,
  extractNumbers,
  cleanText,
  parseCandidateNumbers,
  isNumberCheckEnabled,
  resolveUnitAndMagnitude
};
