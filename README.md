# Finding memory bugs with Predator

A static page that shows how the [Predator](https://github.com/kdudka/predator) shape analyser finds
memory-safety bugs in C programs with linked lists (use after free, leaks, out-of-bounds writes,
NULL dereferences, double free, Linux kernel lists) and verifies that the fixed versions are safe.

```
cases/*.c              the example programs (one per code version)
cases/results.json     recorded Predator diagnostics and times
heaps/*.c              programs that dump Predator's abstract heaps; heaps/*.svg are the rendered graphs
scripts/run-cases.sh   re-runs everything:  scripts/run-cases.sh path/to/predator/sl_build
build.py               the stories (prose + line ranges); renders template.html -> index.html
template.html, style.css
```

Build Predator against the system GCC (needs the GCC plug-in headers, e.g. `gcc-13-plugin-dev`,
plus CMake and Boost), then rebuild the page:

```shell
git clone https://github.com/kdudka/predator && (cd predator && ./switch-host-gcc.sh /usr/bin/gcc)
scripts/run-cases.sh predator/sl_build      # needs Graphviz for heaps/*.svg
python3 build.py
```

A case can pass options to the analyser in its first line, e.g. `/* predator-args: oom */`.

`index.html` is generated but committed, so GitHub Pages can serve the repository as it is
(*Settings → Pages → Deploy from a branch → master, / (root)*).

## Playground

`playground/` runs Predator in the browser: clang 14 and Predator's LLVM front-end, compiled to
WebAssembly with Emscripten (`playground/predator.wasm`, about 27 MB) and run in a Web Worker.

```
wasm/driver.cc         clang -> -lowerswitch -global-vars -nestedgep -> Predator, in one process
wasm/build.sh          builds everything:  wasm/build.sh WORK_DIR   (LLVM takes a few hours)
wasm/test.mjs          checks the wasm build against cases/results.json:  node wasm/test.mjs
playground/template.html, playground.js, playground.css, worker.js
```

`build.py` also renders `playground/index.html` and `playground/examples.json`.
