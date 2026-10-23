// Exercise the real bake, preview, and blind packer against an isolated corpus.
// A transport failure after three good answers still passes the latency gate;
// its flag must exclude it before automation or a stale quality score is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { convoValidity } from "./classify.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATE = "2026-10-22";

test("unavailable captures with earlier valid answers cannot affect bake, preview, or judging", () => {
  const root = mkdtempSync(path.join(tmpdir(), "benchmark-unavailable-"));
  const runner = path.join(root, "runner");
  const convDir = path.join(runner, "results", DATE, "conv");
  mkdirSync(convDir, { recursive: true });
  try {
    // Copy executable modules, without any live corpus, credentials, or browser dependency.
    for (const name of readdirSync(HERE)) {
      if (name.endsWith(".js") && !name.endsWith(".test.js")) copyFileSync(path.join(HERE, name), path.join(runner, name));
    }
    writeFileSync(path.join(runner, "package.json"), '{"type":"module"}');
    const sites = ["alpha", "beta"].map(key => ({ key, vendor: `Fixture ${key}`, store: `Store ${key}`, url: `https://${key}.example/`, widget: "fixture" }));
    writeFileSync(path.join(runner, "vendors.js"), `export const STORES = ${JSON.stringify(sites)}; export const WIDGETS = {};`);
    for (const name of ["report.html", "report-archive.html"]) writeFileSync(path.join(root, name), "const STORES = [];\nlet MODE='shopping';");
    for (const name of ["takeaways.html", "takeaways-archive.html"]) writeFileSync(path.join(root, name), "/*SCORES_START*//*SCORES_END*/\n<!-- STATS_JSON:{} -->");

    const scores = {}, keep = [], exclude = [];
    for (const site of sites) for (const mode of ["shopping", "support"]) {
      const turns = Array.from({ length: 3 }, (_, i) => ({
        turn: i + 1, q: "What is the return window?", by: "ai", complete_ms: 2000,
        ai_latency_ms: 2000, handover: false,
        replyText: "Unused items can be returned within 30 days. Start the return through the portal linked in your confirmation email.",
      }));
      const badName = `${site.key}-${mode}-unavailable.json`;
      const good = { ...site, mode, theme: "beginner", capturedAt: `${DATE}T12:00:00Z`, valid: true, turns,
        stats: { avg_ms: 2000, success_rate: 100, handover_turn: null } };
      const failed = structuredClone(good);
      failed.theme = "gift";
      failed.widget_unavailable = true;
      // Keep stale valid:true and a quality score on purpose. Neither can override
      // the transport verdict, even after enough measured answers to pass validity.
      for (const t of failed.turns) t.complete_ms = t.ai_latency_ms = 100000;
      failed.turns[2].replyText = "For your return, please email our team at support@example.com with your order number and we will assist you there.";
      failed.turns.push({ turn: 4, q: "Can you help here?", by: "ai", complete_ms: null, ai_latency_ms: null, widget_unavailable: true, replyText: "" });
      assert.equal(convoValidity(failed.turns).valid, true, "fixture must otherwise pass the latency gate");
      for (let i = 0; i < 5; i++) {
        const goodName = `${site.key}-${mode}-good-${i}.json`;
        writeFileSync(path.join(convDir, goodName), JSON.stringify(good));
        scores[`${DATE}/${goodName}`] = { total: 80, rubric: { answer: 80 }, resolution_class: "resolved" };
        keep.push(`${DATE}/${goodName}`);
      }
      writeFileSync(path.join(convDir, badName), JSON.stringify(failed));
      scores[`${DATE}/${badName}`] = { total: 0, rubric: { answer: 0 }, resolution_class: "failed" };
      exclude.push(`${DATE}/${badName}`);
    }
    writeFileSync(path.join(runner, "eval-scores.json"), JSON.stringify(scores));
    const run = (name, args = []) => {
      const result = spawnSync(process.execPath, [path.join(runner, name), ...args], { cwd: root, encoding: "utf8", timeout: 20000 });
      assert.equal(result.status, 0, `${name} failed:\n${result.stdout}\n${result.stderr}`);
    };

    run("gen.js");
    const board = JSON.parse(readFileSync(path.join(root, "board.json"), "utf8"));
    assert.equal(board.totals.conversations, keep.length);
    assert.equal(board.totals.judged_conversations, keep.length);
    for (const store of board.stores) for (const mode of ["shopping", "support"]) {
      assert.deepEqual([store[mode].conversations, store[mode].automation_pct, store[mode].quality, store[mode].latency_mean_s], [5, 100, 80, 2]);
    }

    const previewPath = path.join(root, "preview.json");
    run("scoreboard-preview.js", ["--no-baked", "--json", previewPath]);
    const preview = JSON.parse(readFileSync(previewPath, "utf8"));
    assert.deepEqual(preview.active.entries, { shopping: 2, support: 2 });
    assert.equal(Object.keys(preview.active.D).length, 2);
    for (const vendor of Object.values(preview.active.D)) for (const key of ["s", "p"]) {
      assert.deepEqual([vendor[key].n, vendor[key].a, vendor[key].q, vendor[key].l, vendor[key].l75], [5, 100, 80, 2, 2]);
    }

    const pack = path.join(root, "batches");
    run("eval-pack.js", [pack, "12", "--rejudge", [...keep, ...exclude].join(",")]);
    const ids = readdirSync(pack).filter(name => /^map-/.test(name)).flatMap(name => Object.values(JSON.parse(readFileSync(path.join(pack, name), "utf8"))));
    assert.deepEqual(ids.sort(), keep.sort(), "unavailable captures must not reach a blind judge, including pinned rejudges");
    assert.ok(existsSync(path.join(pack, "batch-001.json")), "control conversations must still reach the judge");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
