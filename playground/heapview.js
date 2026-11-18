"use strict";
// Shows the heap graphs (Graphviz .dot files) that the analyser wrote during a run, one at a time,
// and highlights the source line each belongs to.  Shared by the Predator and Forester playgrounds.
//
//   HeapView.init({ editor, simplify })   simplify(dot) -> dot, or null (no "hide" toggle)
//   HeapView.extract(lines) -> { lines, states }   removes the "writing ... graph" notes from the
//                                                   output and returns them as states, in order
//   HeapView.show(states, graphs)          graphs: { "name.dot": "digraph ..." }
//   HeapView.clear()
const HeapView = (() => {
  const VIZ_URL = "https://cdn.jsdelivr.net/npm/@viz-js/viz@3.2.4/lib/viz-standalone.js";
  const NOTE = /^(?<file>[^:\s]+)(?::(?<line>\d+))?(?::(?<col>\d+))?: note: writing (?:heap|memory) graph to '(?<name>[^']+)\.dot'/;
  const DIAG = /^[^:\s]+:\d+:(?:\d+:)? (?<kind>error|warning): (?<msg>.*)$/;

  let editor = null, simplify = null;
  let states = [], graphs = {}, current = -1, mark = null, vizPromise = null, fit = true;
  const cache = new Map();
  const $ = (id) => document.getElementById(id);

  function init(opts) {
    editor = opts.editor;
    simplify = opts.simplify || null;
    $("heap-simplify-wrap").hidden = !simplify;
    $("heap-step").addEventListener("input", () => select(Number($("heap-step").value) - 1));
    $("heap-prev").addEventListener("click", () => select(current - 1));
    $("heap-next").addEventListener("click", () => select(current + 1));
    $("heap-simplify").addEventListener("change", () => select(current, true));
    $("heap-fit").addEventListener("click", () => { fit = !fit; applyFit(); });
    $("heaps").addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" && e.target.type === "range") return;  // has its own keys
      if (e.key === "ArrowLeft") { select(current - 1); e.preventDefault(); }
      if (e.key === "ArrowRight") { select(current + 1); e.preventDefault(); }
    });
    editor.on("change", unmark);
  }

  function extract(lines) {
    const out = [], found = [];
    let lastDiag = null;
    for (const l of lines) {
      const m = l.match(NOTE);
      if (m) {
        found.push({
          name: m.groups.name,
          line: m.groups.line ? Number(m.groups.line) : 0,
          col: m.groups.col ? Number(m.groups.col) : 0,
          diag: lastDiag,
        });
        continue;
      }
      const d = l.match(DIAG);
      if (d) lastDiag = { kind: d.groups.kind, msg: d.groups.msg };
      out.push(l);
    }
    return { lines: out, states: found };
  }

  // what a state is, from its file name: error-state-0001, warning-state-0000 (Predator with
  // plot_errors), trace-0012 (Forester with print-trace), or NAME-0003 from __VERIFIER_plot("NAME")
  function describe(s, i, all) {
    const base = s.name.replace(/-\d{4}$/, "");
    if (base === "error-state") return { kind: "error", text: s.diag && s.diag.kind === "error" ? s.diag.msg : "error" };
    if (base === "warning-state") return { kind: "warning", text: s.diag && s.diag.kind === "warning" ? s.diag.msg : "warning" };
    if (base === "trace") {
      const trace = all.filter((t) => t.name.startsWith("trace-"));
      const k = trace.indexOf(s);
      const last = k === trace.length - 1;
      return { kind: "trace", text: `error trace, step ${k + 1} of ${trace.length}` + (last ? " (the failing instruction)" : "") };
    }
    return { kind: "plot", text: `__VERIFIER_plot("${base}")` };
  }

  function show(found, files) {
    states = found.filter((s) => files[`${s.name}.dot`] !== undefined);
    graphs = files;
    cache.clear();
    const panel = $("heaps");
    if (!states.length) { clear(); return; }
    panel.hidden = false;
    $("heap-count").textContent = `${states.length} heap graph${states.length > 1 ? "s" : ""}`;
    const range = $("heap-step");
    range.max = String(states.length);
    range.disabled = states.length < 2;
    // start at the first error or warning, or at the end of an error trace
    let start = states.findIndex((s) => /^(error|warning)-state-/.test(s.name));
    if (start < 0 && states.some((s) => s.name.startsWith("trace-"))) {
      start = states.map((s) => s.name.startsWith("trace-")).lastIndexOf(true);
    }
    select(Math.max(0, start), true);
  }

  function clear() {
    states = []; graphs = {}; current = -1;
    cache.clear();
    unmark();
    $("heaps").hidden = true;
    $("heap-svg").textContent = "";
  }

  function unmark() {
    if (mark !== null) { editor.removeLineClass(mark, "background", "cm-line-state"); mark = null; }
  }

  async function select(i, force) {
    if (!states.length) return;
    i = Math.max(0, Math.min(states.length - 1, i));
    if (i === current && !force) return;
    current = i;
    const s = states[i];
    const d = describe(s, i, states);
    $("heap-step").value = String(i + 1);
    $("heap-prev").disabled = i === 0;
    $("heap-next").disabled = i === states.length - 1;
    $("heap-pos").textContent = `${i + 1} / ${states.length}`;

    const cap = $("heap-caption");
    cap.textContent = "";
    const kind = document.createElement("span");
    kind.className = `heap-kind ${d.kind}`;
    kind.textContent = d.kind === "plot" ? "plot" : d.kind;
    cap.append(kind, " ");
    if (s.line) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = `line ${s.line}`;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        editor.focus();
        editor.setCursor({ line: s.line - 1, ch: Math.max(0, s.col - 1) });
      });
      cap.append(a, " · ");
    }
    cap.append(d.text);

    unmark();
    if (s.line && s.line <= editor.lineCount()) {
      mark = s.line - 1;
      editor.addLineClass(mark, "background", "cm-line-state");
      const y = editor.charCoords({ line: mark, ch: 0 }, "local").top;
      const info = editor.getScrollInfo();
      if (y < info.top || y > info.top + info.clientHeight - 40) editor.scrollTo(null, Math.max(0, y - info.clientHeight / 3));
    }

    const file = `${s.name}.dot`;
    const raw = graphs[file];
    const hide = simplify && $("heap-simplify").checked;
    const dot = cleanup(hide ? simplify(raw) : raw);
    const dl = $("heap-download");
    URL.revokeObjectURL(dl.href);
    dl.href = URL.createObjectURL(new Blob([raw], { type: "text/vnd.graphviz" }));
    dl.download = file;

    const box = $("heap-svg");
    const key = `${file}|${hide}`;
    if (!cache.has(key)) {
      if (!vizPromise) box.innerHTML = '<p class="heap-msg">loading Graphviz…</p>';
      try {
        const viz = await loadViz();
        cache.set(key, viz.renderSVGElement(dot));
      } catch (e) {
        if (current === i) box.innerHTML = `<p class="heap-msg">cannot draw this graph: ${String(e && e.message || e).replace(/[<&]/g, "")}</p>`;
        return;
      }
    }
    if (current !== i) return;  // the user moved on while Graphviz was loading
    box.textContent = "";
    box.appendChild(cache.get(key));
    applyFit();
  }

  function applyFit() {
    const svg = $("heap-svg").querySelector("svg");
    $("heap-fit").textContent = fit ? "Actual size" : "Fit to width";
    if (!svg) return;
    if (!svg.dataset.w) { svg.dataset.w = svg.getAttribute("width"); svg.dataset.h = svg.getAttribute("height"); }
    if (fit) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.width = "100%";
      svg.style.maxWidth = svg.dataset.w;
      svg.style.height = "auto";
    } else {
      svg.setAttribute("width", svg.dataset.w);
      svg.setAttribute("height", svg.dataset.h);
      svg.style.width = svg.style.maxWidth = svg.style.height = "";
    }
  }

  function loadViz() {
    if (!vizPromise) {
      vizPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = VIZ_URL;
        s.onload = () => resolve(Viz.instance());
        s.onerror = () => { vizPromise = null; reject(new Error("cannot download Graphviz (viz.js)")); };
        document.head.appendChild(s);
      });
    }
    return vizPromise;
  }

  // the page shows the name of the graph itself; '~' marks a register named after a C variable
  // (see the Forester patches)
  function cleanup(dot) {
    return dot
      .replace(/^\s*label=<<FONT POINT-SIZE="18">[^\n]*<\/FONT>>;\n/m, "")
      .replace(/^(\s*digraph [^\n]*\{)/m, '$1\n  fontname="Helvetica"; node [fontname="Helvetica"]; edge [fontname="Helvetica"];')
      .replace(/label="~/g, 'label="');
  }

  return { init, extract, show, clear };
})();
