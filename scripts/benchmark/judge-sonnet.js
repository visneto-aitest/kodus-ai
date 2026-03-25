#!/usr/bin/env node
/**
 * Judge benchmark candidates against golden comments using Sonnet.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node judge-sonnet.js <golden.json> <candidates.json> <output.json> <level>
 */
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");

const JUDGE_PROMPT = `You are evaluating AI code review tools.
Determine if the candidate issue matches the golden (expected) comment.

Golden Comment (the issue we're looking for):
{golden_comment}

Candidate Issue (from the tool's review):
{candidate}

Instructions:
- Determine if the candidate identifies the SAME underlying issue as the golden comment
- Accept semantic matches - different wording is fine if it's the same problem
- Focus on whether they point to the same bug, concern, or code issue

Respond with ONLY a JSON object:
{"reasoning": "brief explanation", "match": true/false, "confidence": 0.0-1.0}`;

async function main() {
  const [goldenFile, candidatesFile, outputFile, level] = process.argv.slice(2);

  if (!goldenFile || !candidatesFile || !outputFile) {
    console.error("Usage: node judge-sonnet.js <golden.json> <candidates.json> <output.json> [level]");
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const client = new Anthropic.default({ apiKey });
  const golden = JSON.parse(fs.readFileSync(goldenFile, "utf8"));
  const candidates = JSON.parse(fs.readFileSync(candidatesFile, "utf8"));

  const judgments = {};
  let totalTP = 0, totalFP = 0, totalFN = 0;

  for (let i = 0; i < golden.length; i++) {
    const pr = golden[i];
    const cand = candidates[i];
    const matches = [];
    const goldenMatched = new Set();
    const candMatched = new Set();

    for (let gi = 0; gi < pr.golden_comments.length; gi++) {
      if (goldenMatched.has(gi)) continue;
      let bestCi = -1, bestConf = 0;

      for (let ci = 0; ci < cand.issues.length; ci++) {
        if (candMatched.has(ci)) continue;

        const prompt = JUDGE_PROMPT
          .replace("{golden_comment}", pr.golden_comments[gi].comment)
          .replace("{candidate}", cand.issues[ci].comment);

        try {
          const resp = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 200,
            temperature: 0,
            messages: [{ role: "user", content: prompt }],
          });
          const text = resp.content[0].text.trim();
          const clean = text.replace(/```json?/g, "").replace(/```/g, "").trim();
          const json = JSON.parse(clean);
          if (json.match && (json.confidence || 0) > bestConf) {
            bestCi = ci;
            bestConf = json.confidence || 0;
          }
        } catch (e) {
          process.stderr.write("    judge error: " + (e.message || e).toString().substring(0, 100) + "\n");
        }
      }

      if (bestCi >= 0) {
        matches.push([bestCi, gi]);
        goldenMatched.add(gi);
        candMatched.add(bestCi);
      }
    }

    judgments[i] = { matches };
    const tp = matches.length;
    const fp = cand.issues.length - tp;
    const fn = pr.golden_comments.length - tp;
    totalTP += tp; totalFP += fp; totalFN += fn;

    const repo = cand.repo || pr.repo.split("/").pop();
    process.stderr.write(
      "    " + repo.padEnd(18) + (pr.title || "").substring(0, 37).padEnd(39) +
      "TP=" + tp + " FP=" + fp + " FN=" + fn + "\n"
    );
  }

  const p = totalTP / (totalTP + totalFP) || 0;
  const r = totalTP / (totalTP + totalFN) || 0;
  const f1 = p + r === 0 ? 0 : 2 * p * r / (p + r);

  // Per-PR and per-repo breakdown
  const prResults = [];
  const repoStats = {};

  for (let i = 0; i < golden.length; i++) {
    const pr = golden[i];
    const cand = candidates[i];
    const ms = judgments[i].matches;
    const repo = cand.repo || pr.repo.split("/").pop();
    const tp = ms.length;
    const fp = cand.issues.length - tp;
    const fn = pr.golden_comments.length - tp;

    const matchedG = new Set(ms.map(m => m[1]));
    const matchedC = new Set(ms.map(m => m[0]));
    const found = pr.golden_comments.filter((g, gi) => matchedG.has(gi)).map(g => ({ comment: g.comment.substring(0, 120), severity: g.severity }));
    const missed = pr.golden_comments.filter((g, gi) => !matchedG.has(gi)).map(g => ({ comment: g.comment.substring(0, 120), severity: g.severity }));
    const noise = cand.issues.filter((c, ci) => !matchedC.has(ci)).map(c => c.comment.substring(0, 120));

    prResults.push({ repo, title: (pr.title || "").substring(0, 50), tp, fp, fn, golden: pr.golden_comments.length, candidates: cand.issues.length, found, missed, noise });

    if (!repoStats[repo]) repoStats[repo] = { tp: 0, fp: 0, fn: 0, golden: 0, candidates: 0, prs: 0 };
    repoStats[repo].tp += tp;
    repoStats[repo].fp += fp;
    repoStats[repo].fn += fn;
    repoStats[repo].golden += pr.golden_comments.length;
    repoStats[repo].candidates += cand.issues.length;
    repoStats[repo].prs++;
  }

  const result = { level: level || "all", tp: totalTP, fp: totalFP, fn: totalFN, precision: p, recall: r, f1, prResults, repoStats };
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
