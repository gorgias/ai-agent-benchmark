// tools/fix-gate-blocked.mjs — retro-apply the login-wall STOP to already-captured convs.
//
// run.js now stops a conversation the moment a login/verification wall (which a logged-out
// harness can't clear) is followed by a turn with no substantive answer — the widget is
// stuck on the login modal and every further scripted question just records a FAKE empty
// "failure". This tool finds convs captured BEFORE that guard existed and fixes them the
// same way: truncate the trailing run of empty turns, mark the conversation gate_blocked +
// invalid (a logged-out order-support flow is not a measurable data point). It NEVER touches
// a conversation where the AI kept answering substantively after the gate — that gate is a
// trailing UI button (chrome), not a wall (see the 2026-07-10 false-gate revert).
//
//   node tools/fix-gate-blocked.mjs           # dry run
//   node tools/fix-gate-blocked.mjs --apply
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripWidgetChrome, LOGIN_GATE, loginWallStop } from "../reply-clean.js";
import { convoValidity } from "../classify.js";

const APPLY = process.argv.includes("--apply");
const MIN_SUBSTANCE = 80;
const raw = (t) => t.replyText || t.replyTail || "";
const substantive = (t) => t.by === "ai" && t.complete_ms != null && stripWidgetChrome(raw(t), t.q).length >= MIN_SUBSTANCE;

let touched = 0, turnsDropped = 0; const rows = [];
for (const d of readdirSync("results").filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) {
  let files; try { files = readdirSync(`results/${d}/conv`); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const path = `results/${d}/conv/${f}`;
    let j; try { j = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    if (j.gate_blocked) continue;                       // already processed
    const ts = j.turns || [];
    if (ts.length < 2) continue;

    // Replicate the runner via the shared helper: once a login gate has appeared, the FIRST
    // ai turn with no substantive answer is the stop point.
    const stop = loginWallStop(ts, substantive);
    if (stop < 0) continue;
    // SAFETY: only a genuine wall — every turn from the stop point on must be non-substantive
    // (a fabricated empty run), and at least one gate must have been in an ANSWERED turn
    // before it (so we don't nuke a conv that merely had one trailing blank).
    const tail = ts.slice(stop);
    if (!tail.every((t) => !substantive(t))) continue;                       // a real answer follows → not a wall
    const gatedAnswerBefore = ts.slice(0, stop).some((t) => substantive(t) && LOGIN_GATE.test(raw(t)));
    const emptyTail = tail.filter((t) => t.by === "ai" && t.complete_ms == null).length;
    if (!gatedAnswerBefore || emptyTail < 1) continue;

    const kept = ts.slice(0, stop);
    j.turns = kept;
    j.gate_blocked = true; j.gate_turn = stop + 1;
    const v = convoValidity(kept);
    j.valid = false; j.invalid_reason = `login-gated flow — logged-out harness stopped at T${stop + 1}`;
    const ai = kept.filter((t) => t.by === "ai" && t.complete_ms != null).map((t) => t.complete_ms);
    if (j.stats) Object.assign(j.stats, {
      turns: kept.length, answered_no_handover: ai.length,
      success_rate: kept.length ? Math.round(ai.length / kept.length * 100) : null,
      valid: false, timed_turns: v.timed,
    });
    touched++; turnsDropped += (ts.length - kept.length);
    rows.push(`  ${d}/${f} — kept ${kept.length}, dropped ${ts.length - kept.length} empty (wall@T${stop + 1})`);
    if (APPLY) writeFileSync(path, JSON.stringify(j));
  }
}
rows.slice(0, 40).forEach((r) => console.log(r));
console.log(`${APPLY ? "APPLIED" : "DRY RUN —"} ${touched} login-walled convs fixed, ${turnsDropped} fake-empty turns dropped`);
