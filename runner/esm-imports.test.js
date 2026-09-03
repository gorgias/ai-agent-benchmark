import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// WHY THIS TEST EXISTS (2026-09-03). package.json declares "type": "module", so every local
// .js here is an ES module. Several tools loaded vendors.js through createRequire anyway. That
// works on Node >=22.12, where require(esm) is unflagged — the laptop runs 22.22 — and throws
// ERR_REQUIRE_ESM on the capture server's Node 22.11. Result: `auto-probe <store> failed` on
// every dormant-store probe in production for weeks, while every local run passed. A version
// difference between laptop and server is exactly the kind of gap a test has to close, because
// no amount of local exercise will surface it.
function sourceFiles() {
  const out = [];
  for (const dir of [HERE, path.join(HERE, "tools")]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.(mjs|js)$/.test(f)) continue;
      if (f.endsWith(".test.js")) continue;
      out.push(path.join(dir, f));
    }
  }
  return out;
}

test("no local module is loaded through createRequire", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    // Only actual code counts — the explanatory comments above mention createRequire by name.
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (!/createRequire/.test(code)) continue;
    // Requiring a *package* is fine; requiring a relative path is a local ESM module.
    if (/require\(\s*["']\.{1,2}\//.test(code)) offenders.push(path.relative(HERE, file));
  }
  assert.deepEqual(
    offenders,
    [],
    `these load a local ES module via createRequire and will throw ERR_REQUIRE_ESM on Node <22.12:\n  ${offenders.join("\n  ")}`,
  );
});

test("every relative import resolves to a file that exists", () => {
  const missing = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of code.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const spec = m[1];
      if (spec.includes("node_modules")) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      if (!existsSync(resolved)) missing.push(`${path.relative(HERE, file)} → ${spec}`);
    }
  }
  // probe-fin2/probe-zd pointed at "./vendors.js" from inside tools/, a path that never existed;
  // the createRequire indirection hid it because the throw happened at run time, not at parse.
  assert.deepEqual(missing, [], `unresolvable relative imports:\n  ${missing.join("\n  ")}`);
});
