/**
 * scripts/number_check_report.js
 *
 * Phase 5.2 - Real-Data Report Script (Read-only on DB).
 * Inspects sent digests over the last N records:
 * - Counts numbers checked, found_in_cited, found_in_batch_only, derived_ok, not_found.
 * - Lists any not_found numbers along with their source snippets for human review.
 * - Does NOT call any LLM.
 * - Closes pool cleanly.
 */

"use strict";

require("dotenv").config();
const { pool, closePool } = require("../lib/db");
const { verifyEventNumbers, extractNumbers } = require("../lib/number_check");

const DEFAULT_LIMIT = 10;

async function runReport() {
  console.log("================================================================================");
  console.log("PHASE 5.2 - NUMBER VERIFICATION REAL-DATA REPORT (READ-ONLY)");
  console.log("================================================================================\n");

  try {
    // 1. Fetch recent sent digests
    const [rows] = await pool.query(
      `SELECT id, topic, delivery_date, delivery_hour, is_sent, summary_json, created_at
       FROM shift_digests
       ORDER BY id DESC
       LIMIT ?`,
      [DEFAULT_LIMIT]
    );

    console.log(`Fetched ${rows.length} recent digest records from shift_digests.\n`);

    if (rows.length === 0) {
      console.log("No stored digests found in database. Nothing to inspect.");
      return;
    }

    let totalDigests = 0;
    let totalEvents = 0;
    let totalNumbersChecked = 0;
    let totalFoundInCited = 0;
    let totalFoundInBatchOnly = 0;
    let totalDerivedOk = 0;
    let totalNotFound = 0;

    const notFoundDetails = [];
    const passedExamples = [];
    const skippedExamples = [];

    for (const row of rows) {
      totalDigests++;
      let parsed;
      try {
        parsed = typeof row.summary_json === "string" ? JSON.parse(row.summary_json) : row.summary_json;
      } catch (err) {
        console.warn(`[Digest #${row.id}] Malformed summary_json: ${err.message}`);
        continue;
      }

      const events = Array.isArray(parsed?.events) ? parsed.events : [];

      // Query raw_articles for this topic as reference context
      const [articles] = await pool.query(
        `SELECT id, topic, title, link, source, content_snippet, pub_date
         FROM raw_articles
         WHERE topic = ?
         ORDER BY id DESC
         LIMIT 20`,
        [row.topic]
      );

      for (const evt of events) {
        totalEvents++;

        // If number_check is already stored, use it; otherwise run in-memory verification
        let checkData = evt.number_check;
        if (!checkData || !checkData.checked) {
          verifyEventNumbers(evt, articles, []);
          checkData = evt.number_check;
        }

        const notFoundList = checkData?.not_found || [];
        const derivedList = checkData?.derived || [];
        const mismatches = checkData?.notes?.citation_mismatches || [];
        const skippedList = checkData?.notes?.skipped || [];

        // Count all extracted checkable numbers in this event
        const textToExtract = [evt.title, evt.core_verdict, ...(evt.key_highlights || []), evt.impact].filter(Boolean).join(" ");
        const { extracted } = extractNumbers(textToExtract, "event");

        const eventCheckedCount = extracted.length;
        const eventNotFoundCount = notFoundList.length;
        const eventDerivedCount = derivedList.length;
        const eventMismatchCount = mismatches.length;
        const eventFoundCitedCount = Math.max(0, eventCheckedCount - eventNotFoundCount - eventDerivedCount - eventMismatchCount);

        totalNumbersChecked += eventCheckedCount;
        totalFoundInCited += eventFoundCitedCount;
        totalFoundInBatchOnly += eventMismatchCount;
        totalDerivedOk += eventDerivedCount;
        totalNotFound += eventNotFoundCount;

        // Collect examples for the report
        if (eventFoundCitedCount > 0 && passedExamples.length < 3) {
          const passNum = extracted.find(e => !notFoundList.some(nf => nf.raw === e.raw));
          if (passNum) {
            passedExamples.push({
              digestId: row.id,
              topic: row.topic,
              eventTitle: evt.title,
              rawNumber: passNum.raw,
              sourceArticlesSnippet: articles.slice(0, 2).map(a => a.content_snippet || a.title).join(" | ")
            });
          }
        }

        if (skippedList.length > 0 && skippedExamples.length < 3) {
          skippedExamples.push({
            digestId: row.id,
            topic: row.topic,
            eventTitle: evt.title,
            skipped: skippedList[0],
            sourceText: evt.core_verdict || evt.title
          });
        }

        if (notFoundList.length > 0) {
          for (const nf of notFoundList) {
            notFoundDetails.push({
              digestId: row.id,
              topic: row.topic,
              eventTitle: evt.title,
              field: nf.field,
              rawNumber: nf.raw,
              sourceArticles: articles.slice(0, 3).map(a => ({
                source: a.source,
                title: a.title,
                snippet: a.content_snippet
              }))
            });
          }
        }
      }
    }

    // 2. Print Summary Metrics
    console.log("--------------------------------------------------------------------------------");
    console.log("SUMMARY METRICS ACROSS RECENT DIGESTS");
    console.log("--------------------------------------------------------------------------------");
    console.log(`Digests inspected:            ${totalDigests}`);
    console.log(`Events inspected:             ${totalEvents}`);
    console.log(`Total checkable numbers:      ${totalNumbersChecked}`);
    console.log(`  - Found in cited sources:   ${totalFoundInCited} (${totalNumbersChecked > 0 ? ((totalFoundInCited / totalNumbersChecked) * 100).toFixed(1) : 0}%)`);
    console.log(`  - Found in batch only:      ${totalFoundInBatchOnly} (citation mismatch, reader NOT warned)`);
    console.log(`  - Derived OK (math):        ${totalDerivedOk} (sums/differences/ratios)`);
    console.log(`  - Not found (warn reader):  ${totalNotFound} (${totalNumbersChecked > 0 ? ((totalNotFound / totalNumbersChecked) * 100).toFixed(1) : 0}%)`);
    console.log("--------------------------------------------------------------------------------\n");

    // 3. Print Flagged Numbers with Source Snippets
    console.log("--------------------------------------------------------------------------------");
    console.log("DETAILS OF FLAGGED NUMBERS (not_found) FOR FALSE-POSITIVE AUDIT");
    console.log("--------------------------------------------------------------------------------");
    if (notFoundDetails.length === 0) {
      console.log("✅ Zero numbers were flagged as not_found. All numbers matched or were derived.");
    } else {
      console.log(`Found ${notFoundDetails.length} instances requiring review:`);
      notFoundDetails.forEach((item, idx) => {
        console.log(`\n[#${idx + 1}] Digest #${item.digestId} | Topic: "${item.topic}"`);
        console.log(`  Event: "${item.eventTitle}"`);
        console.log(`  Flagged Number: "${item.rawNumber}" in field [${item.field}]`);
        console.log(`  Reference Article Snippets:`);
        if (item.sourceArticles.length === 0) {
          console.log(`    (No raw_articles found in DB for this topic)`);
        } else {
          item.sourceArticles.forEach((art, sIdx) => {
            console.log(`    [Source ${sIdx + 1}] ${art.source || "News"}: "${art.snippet || art.title}"`);
          });
        }
      });
    }
    console.log("\n--------------------------------------------------------------------------------");

    // 4. Print Real Examples
    console.log("REPRESENTATIVE REAL EXAMPLES FROM STORED DATA");
    console.log("--------------------------------------------------------------------------------");
    if (passedExamples.length > 0) {
      console.log("\n[Example 1: Passed Number]");
      console.log(`  Topic: ${passedExamples[0].topic}`);
      console.log(`  Event: ${passedExamples[0].eventTitle}`);
      console.log(`  Number: "${passedExamples[0].rawNumber}"`);
      console.log(`  Source Snippet: "${passedExamples[0].sourceArticlesSnippet.slice(0, 150)}..."`);
    }

    if (notFoundDetails.length > 0) {
      console.log("\n[Example 2: Flagged Number]");
      console.log(`  Topic: ${notFoundDetails[0].topic}`);
      console.log(`  Event: ${notFoundDetails[0].eventTitle}`);
      console.log(`  Number: "${notFoundDetails[0].rawNumber}"`);
      console.log(`  Source Snippet: "${(notFoundDetails[0].sourceArticles[0]?.snippet || "").slice(0, 150)}..."`);
    } else {
      console.log("\n[Example 2: Flagged Number]");
      console.log(`  (None in recent digests - all numbers were verified against sources)`);
    }

    if (skippedExamples.length > 0) {
      console.log("\n[Example 3: Skipped Number / Token]");
      console.log(`  Topic: ${skippedExamples[0].topic}`);
      console.log(`  Event: ${skippedExamples[0].eventTitle}`);
      console.log(`  Token: "${skippedExamples[0].skipped.raw}" (Reason: ${skippedExamples[0].skipped.reason})`);
      console.log(`  Source Context: "${skippedExamples[0].sourceText.slice(0, 150)}..."`);
    }

  } catch (err) {
    console.error("Error executing number_check_report:", err);
  } finally {
    await closePool();
  }
}

runReport();
