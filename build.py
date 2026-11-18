#!/usr/bin/env python3
"""Builds index.html from template.html, the stories below, cases/*.c and cases/results.json.

Usage: python3 build.py          (run scripts/run-cases.sh first to refresh Predator's results)
"""
import difflib
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
REPO = "https://github.com/ondrik/predator-demo"

# Each story is a bug class; each step is a version of the program checked by Predator.
# "show" lists the line ranges displayed on the page (the whole file is one click away).
STORIES = [
    {
        "id": "use-after-free",
        "title": "Use after free while destroying a list",
        "tag": "CWE-416",
        "intro": """The first bug almost everyone writes when freeing a linked list. <code>create()</code>
builds a list whose length depends on input that Predator does not know
(<code>__VERIFIER_nondet_int()</code>), so the analysis has to cover lists of <em>every</em> length,
including the empty one.""",
        "steps": [
            {
                "case": "sll-free",
                "label": "The original loop",
                "show": [(25, 37)],
                "after": """Predator reports the read of <code>p-&gt;next</code> on line 29 after
<code>p</code> was freed on line 28. It also reports a leak on line 28: once the node is freed,
nothing valid points to the rest of the list, so it can never be freed. One bug, two
consequences.""",
            },
            {
                "case": "sll-free-fixed",
                "label": "The fix: save the successor first",
                "show": [(25, 38)],
                "after": """No errors and no warnings. Predator does not try lengths 0, 1, 2, …
up to some bound. It finds a finite set of abstract heaps that covers lists of any length
(see <a href="#how">How it works</a>), so this result holds for all of them.""",
            },
        ],
    },
    {
        "id": "leak",
        "title": "Losing a list while reversing it",
        "tag": "CWE-401",
        "intro": """In-place reversal is a classic exam question. The order of the four pointer
assignments matters, and a wrong order does not crash. It quietly drops most of the list,
so tests that only check the result for short lists can miss it.""",
        "steps": [
            {
                "case": "sll-reverse",
                "label": "Assignments in the wrong order",
                "show": [(24, 33), (44, 48)],
                "after": """Line 28 overwrites <code>p-&gt;next</code> before it is saved, and line 30
then reads the new value, which is <code>prev</code>. The loop stops after the first node and the
remaining nodes are unreachable. Predator reports the leak on the assignment that loses the last
pointer to them.""",
            },
            {
                "case": "sll-reverse-fixed",
                "label": "The fix: save, relink, advance",
                "show": [(24, 34), (45, 49)],
                "after": """With the successor saved first, every node stays reachable and
<code>destroy()</code> frees all of them. Predator proves that for lists of any length.""",
            },
        ],
    },
    {
        "id": "out-of-bounds",
        "title": "Allocating the size of a pointer",
        "tag": "CWE-131",
        "intro": """A doubly linked list node has two pointers and an <code>int</code>: 24 bytes on
x86-64. <code>sizeof(n)</code> looks almost like <code>sizeof(*n)</code>, but it is the size of
the pointer, 8 bytes. The program compiles without a warning and often runs fine, because
<code>malloc</code> rounds small blocks up. Predator tracks the size of every block, byte by byte.""",
        "steps": [
            {
                "case": "dll-sizeof",
                "label": "The original allocation",
                "show": [(5, 22)],
                "after": """Writing <code>n-&gt;next</code> (offset 0) still fits into the 8 bytes.
Writing <code>n-&gt;prev</code> on line 17 is the first access past the end of the block:
<i>points 0B beyond a heap object of size 8B</i>.""",
            },
            {
                "case": "dll-sizeof-fixed",
                "label": "The fix: sizeof the object",
                "show": [(5, 22)],
                "after": """With the right size, all accesses are in bounds, and Predator also checks
that the list is built and freed through the <code>prev</code> pointers without leaks.""",
            },
        ],
    },
    {
        "id": "null",
        "title": "Unchecked malloc",
        "tag": "CWE-476",
        "intro": """By default Predator assumes that <code>malloc</code> succeeds, which is what most
programs implicitly assume as well. With the <code>oom</code> option, every <code>malloc</code>
may also return <code>NULL</code>, and Predator checks both outcomes of each call.""",
        "steps": [
            {
                "case": "oom",
                "label": "No checks at all",
                "show": [(10, 17), (25, 33)],
                "after": """Both allocations can fail. Line 13 writes into a <code>NULL</code>
<code>b</code>, and the <code>memset</code> on line 15 writes into a <code>NULL</code>
<code>b-&gt;data</code>. (Predator reaches line 13 along two paths and reports it once for each.)""",
            },
            {
                "case": "oom-half",
                "label": "The quick fix: return NULL on failure",
                "show": [(10, 21), (29, 37)],
                "after": """No more <code>NULL</code> dereferences, but if the second allocation fails,
the function returns without freeing the first one. Error paths are rarely tested, and Predator
checks them in the same way as the main path.""",
            },
            {
                "case": "oom-fixed",
                "label": "The fix: clean up on the error path",
                "show": [(10, 23), (31, 39)],
                "after": """Each of the three outcomes (both allocations succeed, the first fails, the
second fails) is now free of errors and leaks.""",
            },
        ],
    },
    {
        "id": "double-free",
        "title": "Double free on an error path",
        "tag": "CWE-415",
        "intro": """Ownership bugs come from two functions that disagree about who frees a buffer.
Here <code>parse()</code> frees the request body when it fails, as its comment says. Its caller
did not read the comment.""",
        "steps": [
            {
                "case": "double-free",
                "label": "Both functions free the body",
                "show": [(11, 33)],
                "after": """On the failure path, line 31 frees memory that <code>parse()</code> has
already freed. The heap allocator can be corrupted this way, and double frees are often
exploitable.""",
            },
            {
                "case": "double-free-fixed",
                "label": "The fix: reset the pointer",
                "show": [(11, 34)],
                "after": """After <code>free(req-&gt;body)</code>, <code>parse()</code> stores
<code>NULL</code>, and <code>free(NULL)</code> does nothing. Predator verifies both paths.""",
            },
        ],
    },
    {
        "id": "kernel-list",
        "title": "Freeing while iterating a Linux kernel list",
        "tag": "CWE-416",
        "intro": """System code does not use textbook lists. The Linux kernel embeds a
<code>struct list_head</code> <em>inside</em> each object, links the heads into a cyclic doubly linked
list, and gets from a head back to its object with <code>container_of</code>, that is, by subtracting
the offset of the member from the pointer. Predator was designed for such code: it handles pointer
arithmetic, pointers into the middle of blocks and lists that are linked through embedded
structures.""",
        "steps": [
            {
                "case": "kernel-list",
                "label": "Deleting inside list_for_each_entry",
                "show": [(18, 21), (45, 63)],
                "after": """The loop body frees <code>dev</code>, and then the macro computes the
next entry from <code>dev-&gt;link.next</code>, a field of the freed block. This is why the kernel
has <code>list_for_each_entry_safe</code>, and why reviewers keep asking for it.""",
            },
            {
                "case": "kernel-list-fixed",
                "label": "The fix: the _safe iterator",
                "show": [(18, 27), (51, 69)],
                "after": """<code>list_for_each_entry_safe</code> reads the next entry before the body
runs. Predator verifies the whole program: cyclic list, <code>container_of</code> arithmetic and
all, for any number of devices.""",
            },
        ],
    },
]

C_KEYWORDS = {"struct", "int", "char", "void", "return", "while", "for", "if", "else", "static",
              "extern", "sizeof", "typeof", "size_t", "NULL"}
C_TOKEN = re.compile(r"""(?P<comment>/\*.*?\*/|//[^\n]*)|(?P<pre>^\s*#\s*\w+)|(?P<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?P<word>\b[A-Za-z_]\w*\b)""", re.M)


def highlight_c(line):
    out, pos = [], 0
    for m in C_TOKEN.finditer(line):
        out.append(html.escape(line[pos:m.start()]))
        text = html.escape(m.group())
        kind = m.lastgroup
        if kind == "comment":
            out.append(f'<span class="c">{text}</span>')
        elif kind == "pre":
            out.append(f'<span class="k">{text}</span>')
        elif kind == "string":
            out.append(f'<span class="s">{text}</span>')
        elif m.group() in C_KEYWORDS:
            out.append(f'<span class="k">{text}</span>')
        elif m.group() in ("malloc", "free", "memset", "abort") or m.group().startswith("__VERIFIER"):
            out.append(f'<span class="f">{text}</span>')
        else:
            out.append(text)
        pos = m.end()
    out.append(html.escape(line[pos:]))
    return "".join(out)


DIAG = re.compile(r"^(?P<file>[^:]+):(?P<line>\d+):(?P<col>\d+): (?P<kind>error|warning|note): (?P<msg>.*)$")


def diagnostics(output):
    """Returns {line: [(kind, message)]} for the source lines that Predator's report points at."""
    marks = {}
    for text in output:
        m = DIAG.match(text)
        if m:
            entry = (m["kind"], m["msg"])
            if entry not in marks.setdefault(int(m["line"]), []):
                marks[int(m["line"])].append(entry)
    return marks


def changed_lines(old, new):
    """1-based numbers of the lines of `new` that differ from `old`."""
    changed = set()
    matcher = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    for tag, _, _, j1, j2 in matcher.get_opcodes():
        if tag in ("replace", "insert"):
            changed.update(range(j1 + 1, j2 + 1))
    return changed


def render_code(lines, show, marks, changed):
    rows = []
    for i, (start, end) in enumerate(show):
        if i or start > 1:
            rows.append('<div class="ln gap"><span class="no">⋮</span><span class="tx"></span></div>')
        for no in range(start, min(end, len(lines)) + 1):
            kinds = [k for k, _ in marks.get(no, [])]
            cls = "ln"
            if "error" in kinds:
                cls += " err"
            elif "warning" in kinds:
                cls += " warn"
            elif "note" in kinds:
                cls += " noteline"
            if no in changed:
                cls += " add"
            rows.append(f'<div class="{cls}"><span class="no">{no}</span>'
                        f'<span class="tx">{highlight_c(lines[no - 1]) or " "}</span></div>')
            for kind, msg in marks.get(no, []):
                if kind in ("error", "warning"):
                    rows.append(f'<div class="callout {kind}"><span class="no"></span>'
                                f'<span class="tx">▲ {kind}: {html.escape(msg)}</span></div>')
        if end < len(lines) and i == len(show) - 1:
            rows.append('<div class="ln gap"><span class="no">⋮</span><span class="tx"></span></div>')
    return "".join(rows)


def render_output(output):
    if not output:
        return '<span class="quiet">(no diagnostics)</span>'
    out = []
    for text in output:
        m = DIAG.match(text)
        if m:
            out.append(f'<span class="loc">{html.escape(text[:m.start("kind")])}</span>'
                       f'<span class="{m["kind"]}">{m["kind"]}:</span> {html.escape(m["msg"])}')
        else:
            out.append(html.escape(text))
    return "\n".join(out)


def render_step(number, step, previous, results):
    path = ROOT / "cases" / f"{step['case']}.c"
    lines = path.read_text().splitlines()
    result = results[step["case"]]
    marks = diagnostics(result["output"])
    changed = changed_lines(previous, lines) if previous is not None else set()
    if result["verdict"] == "bug":
        counts = []
        if result["errors"]:
            counts.append(f"{result['errors']} error{'s' if result['errors'] > 1 else ''}")
        if result["warnings"]:
            counts.append(f"{result['warnings']} warning{'s' if result['warnings'] > 1 else ''}")
        badge = f'<span class="verdict bug">bug found · {", ".join(counts)}</span>'
    else:
        badge = '<span class="verdict safe">verified · no memory errors</span>'
    full = "\n".join(lines)
    return f"""
    <div class="step">
      <div class="step-head"><span class="num">{number}</span><h3>{html.escape(step['label'])}</h3>{badge}</div>
      <div class="pane">
        <div class="pane-label"><span>cases/{step['case']}.c</span>{'<span class="legend"><i class="add-key"></i>changed</span>' if changed else ''}</div>
        <div class="code">{render_code(lines, step['show'], marks, changed)}</div>
      </div>
      <div class="pane out">
        <div class="pane-label"><span>$ {html.escape(result['command'])}</span><span>{result['seconds']:.2f} s</span></div>
        <pre class="term">{render_output(result['output'])}</pre>
      </div>
      <p class="after">{step['after']}</p>
      <details>
        <summary>Whole program <span class="file">{len(lines)} lines</span></summary>
        <pre class="full"><code>{"".join(highlight_c(l) + chr(10) for l in lines)}</code></pre>
      </details>
    </div>"""


def main():
    results_file = json.loads((ROOT / "cases" / "results.json").read_text())
    results = results_file["cases"]
    toc, body = [], []
    for story in STORIES:
        toc.append(f'<li><a href="#{story["id"]}">{html.escape(story["title"])}</a> <span class="cwe">{story["tag"]}</span></li>')
        steps, previous = [], None
        for i, step in enumerate(story["steps"]):
            steps.append(render_step(i + 1, step, previous, results))
            previous = (ROOT / "cases" / f"{step['case']}.c").read_text().splitlines()
        body.append(f"""
  <section class="story" id="{story['id']}">
    <div class="story-head">
      <span class="cwe">{story['tag']}</span>
      <h2><a href="#{story['id']}">{html.escape(story['title'])}</a></h2>
    </div>
    <p class="intro">{story['intro']}</p>
    {"".join(steps)}
  </section>""")
    used = {s["case"] for story in STORIES for s in story["steps"]}
    missing = used - results.keys()
    if missing:
        raise SystemExit(f"no results for {sorted(missing)}; run scripts/run-cases.sh")
    shown = [results[c] for c in used]
    page = (ROOT / "template.html").read_text()
    for key, value in {
        "TOC": "\n".join(toc),
        "STORIES": "\n".join(body),
        "TOTAL": str(len(shown)),
        "FOUND": str(sum(1 for r in shown if r["verdict"] == "bug")),
        "PROVED": str(sum(1 for r in shown if r["verdict"] == "safe")),
        "SLOWEST": f"{max(r['seconds'] for r in shown):.2f}",
        "PREDATOR": html.escape(results_file["predator"]),
        "GCC": html.escape(results_file["gcc"]),
        "REPO": REPO,
    }.items():
        page = page.replace("{{" + key + "}}", value)
    (ROOT / "index.html").write_text(page)
    print(f"index.html: {len(STORIES)} stories, {len(shown)} programs")


if __name__ == "__main__":
    main()
