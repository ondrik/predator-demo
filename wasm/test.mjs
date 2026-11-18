// Runs playground/predator.wasm (under Node) on every cases/*.c and compares the errors and warnings
// with the ones the GCC plug-in reported (cases/results.json).   Usage: node wasm/test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const createPredator = createRequire(import.meta.url)(path.join(root, "playground/predator.js"));
const results = JSON.parse(readFileSync(path.join(root, "cases/results.json"), "utf8")).cases;
const DIAG = /^([^:]+):(\d+):(?:\d+:)? (error|warning): (.*)$/;
const key = (lines) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").replace(/ \[-sl\]$/, ""))
  .map((l) => l.match(DIAG)).filter(Boolean).map((m) => `${m[2]} ${m[3]}: ${m[4]}`).join("\n");

let failed = 0;
for (const [name, expected] of Object.entries(results)) {
  const src = readFileSync(path.join(root, "cases", `${name}.c`), "utf8");
  const m = src.split("\n")[0].match(/\/\* predator-args: (.*) \*\//);
  const lines = [];
  const predator = await createPredator({ print: (t) => lines.push(t), printErr: (t) => lines.push(t) });
  predator.FS.mkdirTree("/work");
  predator.FS.writeFile(`/work/${name}.c`, src);
  predator.FS.chdir("/work");
  const t0 = performance.now();
  const status = predator.callMain([`${name}.c`, ...(m ? [`-args=${m[1]}`] : [])]);
  const ms = performance.now() - t0;
  const got = key(lines), want = key(expected.output);
  const ok = status === 0 && got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms`);
  if (!ok) console.log(`  status ${status}\n  got:\n${got || lines.join("\n")}\n  expected:\n${want}`);
}
process.exit(failed ? 1 : 0);
