#!/usr/bin/env bash
# Runs Predator on every cases/*.c and records its diagnostics and the time in cases/results.json
# (read by build.py). Also renders the heap graphs of heaps/*.c to heaps/*.svg (needs Graphviz).
#
# Usage: scripts/run-cases.sh path/to/predator/sl_build    (the directory that contains libsl.so)
#
# A case may ask for extra analyser options in a comment on its first line, for example
#   /* predator-args: oom */
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SL_BUILD="$(cd "${1:?usage: $0 path/to/predator/sl_build}" && pwd)"
PLUGIN="$SL_BUILD/libsl.so"
test -f "$PLUGIN" || { echo "$PLUGIN not found" >&2; exit 1; }
GCC="${GCC:-gcc}"

python3 - "$ROOT" "$PLUGIN" "$GCC" <<'EOF'
import json, pathlib, re, subprocess, sys, time

root, plugin, gcc = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
SUFFIX = " [-fplugin=libsl.so]"


def predator(src, cwd, extra=()):
    first = src.read_text().splitlines()[0]
    m = re.match(r"/\* predator-args: (.*) \*/", first)
    args = [f"-fplugin-arg-libsl-args={m.group(1)}"] if m else []
    cmd = [gcc, "-S", "-O0", "-o", "/dev/null", f"-fplugin={plugin}", *args, *extra, src.name]
    start = time.perf_counter()
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    seconds = time.perf_counter() - start
    # keep only Predator's own diagnostics, without internal locations and the final summary
    lines = [l[: -len(SUFFIX)] for l in proc.stderr.splitlines()
             if l.endswith(SUFFIX) and "[internal location]" not in l]
    return " ".join(["gcc", "-fplugin=libsl.so", *args, src.name]), lines, seconds


gcc_version = subprocess.run([gcc, "-dumpfullversion"], capture_output=True, text=True).stdout.strip()
sl_dir = pathlib.Path(plugin).parent.parent
rev = subprocess.run(["git", "-C", str(sl_dir), "log", "-1", "--format=%h %cs"],
                     capture_output=True, text=True).stdout.strip()
results = {"predator": rev or "unknown", "gcc": gcc_version, "cases": {}}
for path in sorted((root / "cases").glob("*.c")):
    command, lines, seconds = predator(path, path.parent)
    errors = sum(1 for l in lines if ": error: " in l)
    warnings = sum(1 for l in lines if ": warning: " in l)
    verdict = "bug" if errors or warnings else "safe"
    results["cases"][path.stem] = {"command": command, "verdict": verdict, "errors": errors,
                                   "warnings": warnings, "output": lines, "seconds": round(seconds, 3)}
    print(f"{path.name:24} {verdict:5} {errors} errors, {warnings} warnings, {seconds:.2f}s")
(root / "cases" / "results.json").write_text(json.dumps(results, indent=2) + "\n")

heaps = root / "heaps"
for old in [*heaps.glob("*.dot"), *heaps.glob("*.svg")]:
    old.unlink()
for path in sorted(heaps.glob("*.c")):
    predator(path, heaps)
for dot in sorted(heaps.glob("*.dot")):
    subprocess.run(["dot", "-Tsvg", dot.name, "-o", dot.with_suffix(".svg").name], cwd=heaps, check=True)
    print(f"heaps/{dot.with_suffix('.svg').name}")
EOF
