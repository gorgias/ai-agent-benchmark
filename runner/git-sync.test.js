// Regression tests for server/git-sync.sh — the capture machine's only way to pull master.
// Run:  node --test
//
// 2026-10-05: a stash re-apply collided on runner/driver-triage.json, git wrote conflict markers
// into it, the nightly publish committed them, and capture crashed on every run for three nights.
// These tests rebuild that exact collision in a throwaway repository and check sync_master leaves
// no marker behind, keeps tonight's local ledger, and keeps an untracked capture file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "git-sync.sh");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_NOSYSTEM: "1", HOME: tmpdir() };
const git = (cwd, ...a) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "init.defaultBranch=master", ...a], { cwd, env: ENV, stdio: ["ignore", "pipe", "pipe"] }).toString();
const ledger = (at) => JSON.stringify({ stores: { "yuma-tediber": { class: "ANSWERED", at, fixed: true } } }, null, 1) + "\n";

function scenario() {
  const root = mkdtempSync(path.join(tmpdir(), "gitsync-"));
  const origin = path.join(root, "origin.git"), seed = path.join(root, "seed"), box = path.join(root, "box");
  git(root, "init", "-q", "--bare", origin);
  git(root, "clone", "-q", origin, seed);
  mkdirSync(path.join(seed, "runner"), { recursive: true });
  writeFileSync(path.join(seed, "runner", "driver-triage.json"), ledger("2026-10-01T00:00:00Z"));
  git(seed, "add", "-A"); git(seed, "commit", "-q", "-m", "seed"); git(seed, "push", "-q", "origin", "HEAD:master");
  git(root, "clone", "-q", origin, box);                        // the capture machine
  // master moves the same ledger line…
  writeFileSync(path.join(seed, "runner", "driver-triage.json"), ledger("2026-10-04T13:02:04Z"));
  git(seed, "commit", "-q", "-am", "upstream"); git(seed, "push", "-q", "origin", "HEAD:master");
  // …while the machine wrote its own value tonight and holds an untracked capture
  writeFileSync(path.join(box, "runner", "driver-triage.json"), ledger("2026-10-05T13:21:59Z"));
  mkdirSync(path.join(box, "runner", "results", "2026-10-08", "conv"), { recursive: true });
  writeFileSync(path.join(box, "runner", "results", "2026-10-08", "conv", "x.json"), "{}\n");
  return { root, box };
}

test("sync_master: a colliding ledger is healed — no conflict markers, valid JSON, tonight's value kept", () => {
  const { root, box } = scenario();
  try {
    execFileSync("bash", ["-c", `. "${LIB}"; sync_master`], { cwd: box, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    const txt = readFileSync(path.join(box, "runner", "driver-triage.json"), "utf8");
    assert.doesNotMatch(txt, /^(<<<<<<<|>>>>>>>) /m);
    const j = JSON.parse(txt);
    assert.equal(j.stores["yuma-tediber"].at, "2026-10-05T13:21:59Z");    // the machine's newer write
    assert.ok(existsSync(path.join(box, "runner", "results", "2026-10-08", "conv", "x.json")), "untracked capture kept");
    assert.equal(git(box, "rev-parse", "HEAD"), git(box, "rev-parse", "origin/master"));   // on master
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("heal_conflicts: markers already sitting in a tracked file are replaced by master's copy", () => {
  const { root, box } = scenario();
  try {
    git(box, "pull", "-q", "--rebase", "--autostash", "origin", "master");   // the old, unsafe pull
    // (whether or not that pull collided, plant the exact text found on master on 2026-10-08)
    writeFileSync(path.join(box, "runner", "driver-triage.json"),
      '{\n<<<<<<< Updated upstream\n "a": 1\n=======\n "a": 2\n>>>>>>> Stashed changes\n}\n');
    execFileSync("bash", ["-c", `. "${LIB}"; heal_conflicts`], { cwd: box, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
    const txt = readFileSync(path.join(box, "runner", "driver-triage.json"), "utf8");
    assert.doesNotMatch(txt, /^(<<<<<<<|>>>>>>>) /m);
    JSON.parse(txt);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("repository: no tracked file carries git conflict markers", () => {
  let hits = "";
  try { hits = execFileSync("git", ["grep", "-lE", "^(<<<<<<<|>>>>>>>) ", "--", ".", ":!*.md"], { cwd: path.join(path.dirname(LIB), ".."), stdio: ["ignore", "pipe", "ignore"] }).toString(); }
  catch (e) { if (e.status !== 1) return; }        // exit 1 = no match; no git = nothing to check
  assert.equal(hits.trim(), "", `conflict markers in: ${hits.trim()}`);
});
