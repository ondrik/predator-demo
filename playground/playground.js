"use strict";

const $ = (id) => document.getElementById(id);
const DEFAULT_CODE = `#include <stdlib.h>

extern int __VERIFIER_nondet_int(void);

struct node {
    struct node *next;
    int data;
};

int main(void)
{
    struct node *head = NULL;

    /* a list of unknown length */
    while (__VERIFIER_nondet_int()) {
        struct node *n = malloc(sizeof *n);
        if (!n)
            return 1;
        n->next = head;
        n->data = 0;
        head = n;
    }

    /* free it again: is anything wrong here? */
    while (head) {
        struct node *next = head->next;
        free(head);
        head = next->next;
    }
    return 0;
}
`;

// ---------------------------------------------------------------------------------------------
// Editor

const editor = CodeMirror.fromTextArea($("code"), {
  mode: "text/x-csrc",
  lineNumbers: true,
  indentUnit: 4,
  tabSize: 4,
  indentWithTabs: false,
  viewportMargin: Infinity,
  extraKeys: {
    "Ctrl-Enter": () => run(),
    "Cmd-Enter": () => run(),
    Tab: (cm) => cm.replaceSelection("    "),
  },
});

let marks = [];
function clearMarks() {
  for (const m of marks) m.clear ? m.clear() : editor.removeLineClass(m.line, "background", m.cls);
  marks = [];
}
function markLine(lineNo, kind, message) {
  const line = lineNo - 1;
  if (line < 0 || line >= editor.lineCount()) return;
  const cls = kind === "error" ? "cm-line-err" : "cm-line-warn";
  editor.addLineClass(line, "background", cls);
  marks.push({ line, cls });
  const el = document.createElement("div");
  el.className = `cm-callout ${kind}`;
  el.textContent = `▲ ${kind}: ${message}`;
  marks.push(editor.addLineWidget(line, el, { coverGutter: false, noHScroll: true }));
}
editor.on("change", () => { if (marks.length) clearMarks(); });

// ---------------------------------------------------------------------------------------------
// Examples, options and shareable links

let examples = [];
const exampleSel = $("example");

async function loadExamples() {
  try {
    examples = await (await fetch("examples.json")).json();
  } catch { examples = []; }
  exampleSel.innerHTML = '<option value="">— your program —</option>';
  let group = null, optgroup = null;
  for (const ex of examples) {
    if (ex.story !== group) {
      group = ex.story;
      optgroup = document.createElement("optgroup");
      optgroup.label = group;
      exampleSel.appendChild(optgroup);
    }
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.label;
    optgroup.appendChild(opt);
  }
}

async function selectExample(id) {
  const ex = examples.find((e) => e.id === id);
  if (!ex) return false;
  const code = await (await fetch(`../cases/${ex.id}.c`)).text();
  editor.setValue(code);
  $("filename").value = `${ex.id}.c`;
  setArgs(ex.args);
  exampleSel.value = id;
  updateLabels();
  return true;
}

exampleSel.addEventListener("change", () => {
  if (exampleSel.value) selectExample(exampleSel.value);
});
editor.on("change", (cm, change) => {
  if (change.origin !== "setValue") exampleSel.value = "";
});

function getArgs() {
  const args = [...document.querySelectorAll("[data-arg]")].filter((c) => c.checked).map((c) => c.dataset.arg);
  return args;
}
// examples set the options they need, but leave the "sticky" ones (heap graphs) as they are;
// a shared link sets all of them
function setArgs(args, all) {
  for (const c of document.querySelectorAll("[data-arg]")) {
    if (all || !c.hasAttribute("data-sticky")) c.checked = args.includes(c.dataset.arg);
  }
  updateLabels();
}
function safeName() {
  const name = $("filename").value.trim().replace(/[^A-Za-z0-9._-]/g, "_") || "program.c";
  return name.endsWith(".c") ? name : name + ".c";
}
function predatorArgs() {
  const a = getArgs();
  return a.length ? [`-args=${a.join(",")}`] : [];
}
function updateLabels() {
  $("editor-label").textContent = safeName();
  $("cmdline").textContent = ["$ predator", ...predatorArgs(), safeName()].join(" ");
}
$("filename").addEventListener("input", updateLabels);
document.querySelectorAll("[data-arg]").forEach((c) => c.addEventListener("change", updateLabels));

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function pack(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function unpack(text) {
  const stream = new Blob([unb64url(text)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

$("share").addEventListener("click", async () => {
  // always the code itself (not #example=...), so that the link keeps showing this program even
  // if the examples change
  const params = new URLSearchParams();
  params.set("code", await pack(editor.getValue()));
  params.set("file", safeName());
  if (getArgs().length) params.set("args", getArgs().join(","));
  const url = `${location.origin}${location.pathname}#${params}`;
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    flash($("share"), "Copied");
  } catch {
    flash($("share"), "Link in address bar");
  }
});
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1500);
}

async function fromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("example") && (await selectExample(params.get("example")))) return;
  if (params.get("code")) {
    try {
      editor.setValue(await unpack(params.get("code")));
      $("filename").value = params.get("file") || "program.c";
      setArgs((params.get("args") || "").split(",").filter(Boolean), true);
      return;
    } catch { /* fall through to the default program */ }
  }
  editor.setValue(DEFAULT_CODE);
  updateLabels();
}

// ---------------------------------------------------------------------------------------------
// Running Predator in a worker

let worker = null, ready = false, running = false, timerId = null, startedAt = 0;
const runBtn = $("run");

function newWorker() {
  worker = new Worker("worker.js");
  ready = false;
  worker.onmessage = (e) => handle(e.data);
  worker.onerror = (e) => { finish(); showFailure(e.message || "the analyser crashed"); };
}

function setVerdict(cls, text) {
  const v = $("verdict");
  v.className = `verdict ${cls}`;
  v.textContent = text;
}

function startTimer(label) {
  startedAt = performance.now();
  clearInterval(timerId);
  timerId = setInterval(() => {
    $("timer").textContent = `${label} ${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
  }, 100);
}

function finish() {
  running = false;
  clearInterval(timerId);
  runBtn.textContent = "Run Predator";
  runBtn.classList.remove("stop");
}

function run() {
  if (running) { stop(); return; }
  if (!worker) newWorker();
  running = true;
  clearMarks();
  HeapView.clear();
  runBtn.textContent = "Stop";
  runBtn.classList.add("stop");
  updateLabels();
  if (!ready) {
    setVerdict("busy", "downloading the analyser…");
    $("output").textContent = "";
  } else {
    setVerdict("busy", "analysing…");
  }
  startTimer("");
  worker.postMessage({ type: "run", file: safeName(), code: editor.getValue(), args: predatorArgs() });
}

function stop() {
  worker.terminate();
  worker = null;
  finish();
  $("timer").textContent = "";
  setVerdict("idle", "stopped");
  $("output").textContent = "The analysis was stopped. Predator may not terminate on programs outside its scope (see below).";
}

function handle(msg) {
  if (msg.type === "progress") {
    const mb = (n) => (n / 1048576).toFixed(1);
    // with a compressed transfer, content-length is smaller than the data
    const text = msg.total && msg.loaded <= msg.total
      ? `downloading the analyser… ${mb(msg.loaded)} / ${mb(msg.total)} MB`
      : `downloading the analyser… ${mb(msg.loaded)} MB`;
    setVerdict(running ? "busy" : "idle", text);
  } else if (msg.type === "ready") {
    ready = true;
    if (running) { setVerdict("busy", "analysing…"); startTimer(""); }
    else setVerdict("idle", "analyser ready");
  } else if (msg.type === "done") {
    ready = true;
    finish();
    $("timer").textContent = `${(msg.ms / 1000).toFixed(2)} s`;
    showResult(msg.lines, msg.status, msg.graphs || {});
  } else if (msg.type === "failed") {
    finish();
    showFailure(msg.error);
  }
}

function showFailure(text) {
  setVerdict("bug", "the analyser failed");
  $("output").textContent = text;
  worker && worker.terminate();
  worker = null;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const DIAG = /^(?<file>[^:\s]+):(?<line>\d+):(?:(?<col>\d+):)? (?<kind>fatal error|error|warning|note): (?<msg>.*)$/;

function cleanLines(lines) {
  return lines
    .map((l) => l.replace(ANSI, "").replace(/ \[-sl\]$/, ""))
    .filter((l) => l && !l.includes("[internal location]"));
}

function showResult(rawLines, status, graphs) {
  const { lines, states } = HeapView.extract(cleanLines(rawLines));
  const out = $("output");
  out.textContent = "";
  let errors = 0, warnings = 0;
  const file = safeName();
  const predatorLines = new Set();
  for (const text of lines) {
    const row = document.createElement("div");
    const m = text.match(DIAG);
    if (m) {
      const { line, kind, msg } = m.groups;
      const kindCls = kind === "fatal error" ? "error" : kind;
      const loc = document.createElement(m.groups.file === file ? "a" : "span");
      loc.className = "loc";
      loc.textContent = text.slice(0, m.index + text.indexOf(kind + ":"));
      if (m.groups.file === file) {
        loc.href = "#";
        loc.addEventListener("click", (ev) => {
          ev.preventDefault();
          editor.focus();
          editor.setCursor({ line: Number(line) - 1, ch: Math.max(0, Number(m.groups.col || 1) - 1) });
          editor.scrollIntoView(null, 120);
        });
      }
      const k = document.createElement("span");
      k.className = kindCls;
      k.textContent = `${kind}:`;
      row.append(loc, k, ` ${msg}`);
      if (kindCls === "error") errors++;
      if (kindCls === "warning") warnings++;
      if ((kindCls === "error" || kindCls === "warning") && m.groups.file === file) {
        const key = `${line}|${kindCls}|${msg}`;
        if (!predatorLines.has(key)) { predatorLines.add(key); markLine(Number(line), kindCls, msg); }
      }
    } else {
      row.textContent = text;
    }
    out.appendChild(row);
  }
  HeapView.show(states, graphs);
  if (status === 3) {
    setVerdict("bug", "does not compile");
  } else if (status !== 0) {
    setVerdict("bug", `the analyser failed (status ${status})`);
  } else if (errors || warnings) {
    const parts = [];
    if (errors) parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
    if (warnings) parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
    setVerdict("bug", `bug found · ${parts.join(", ")}`);
  } else {
    setVerdict("safe", "verified · no memory errors");
    if (!lines.length) out.innerHTML = '<span class="quiet">(no diagnostics)</span>';
  }
}

runBtn.addEventListener("click", run);
HeapView.init({ editor });

(async () => {
  await loadExamples();
  await fromHash();
  // start downloading the analyser right away
  newWorker();
  worker.postMessage({ type: "load" });
})();
