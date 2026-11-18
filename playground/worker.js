// Runs Predator (predator.js/.wasm, built by wasm/build.sh) off the main thread.
// Messages in:  {type: "load"} | {type: "run", file, code, args}
// Messages out: {type: "progress", loaded, total} | {type: "ready"} |
//               {type: "done", lines, status, ms} | {type: "failed", error}
importScripts("predator.js");

let loading = null;

function load() {
  return loading || (loading = download().catch((e) => { loading = null; throw e; }));
}

async function download() {
  const resp = await fetch("predator.wasm");
  if (!resp.ok) throw new Error(`cannot download predator.wasm (HTTP ${resp.status})`);
  const total = Number(resp.headers.get("content-length")) || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    postMessage({ type: "progress", loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let pos = 0;
  for (const c of chunks) { bytes.set(c, pos); pos += c.length; }
  return await WebAssembly.compile(bytes);
}

async function run({ file, code, args }) {
  const module = await load();
  postMessage({ type: "ready" });
  const lines = [];
  // a fresh instance per run: Predator keeps global state between analyses
  const predator = await createPredator({
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(module, imports).then((inst) => done(inst, module));
      return {};
    },
    print: (t) => lines.push(t),
    printErr: (t) => lines.push(t),
  });
  predator.FS.mkdirTree("/work");
  predator.FS.writeFile(`/work/${file}`, code);
  predator.FS.chdir("/work");
  const start = performance.now();
  let status;
  try {
    status = predator.callMain([file, ...args]);
  } catch (e) {
    if (e && e.name === "ExitStatus") status = e.status;
    else { lines.push(`internal error: ${e && e.message ? e.message : e}`); status = 99; }
  }
  return { lines, status, ms: performance.now() - start };
}

onmessage = async (e) => {
  try {
    if (e.data.type === "load") {
      await load();
      postMessage({ type: "ready" });
    } else if (e.data.type === "run") {
      const result = await run(e.data);
      postMessage({ type: "done", ...result });
    }
  } catch (err) {
    postMessage({ type: "failed", error: String(err && err.message ? err.message : err) });
  }
};
