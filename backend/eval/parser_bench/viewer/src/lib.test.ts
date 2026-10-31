import { describe, expect, it } from "vitest";
import type { Checks, Cost, Estimate, Job, Method } from "./api";
import { KEY_CHOICE, axis, checkChips, confirmMatches, costLine, dash, estimateLine, htmlToMarkdown, jobLabel, methodState, minutesLeft, newSession, pct, splitFooter, usd } from "./lib";

const CLEAN: Checks = {
  page: 3, footer_leaks: 0, footer_leaked: false, footer_token_share: 0, title_first: true, wrong_symbols: 0,
  lonely_bullets: 0, broken_line_pct: null, line_breaks: 0, broken_lines: 0, headings: 1, list_items: 2,
  max_depth: 1, tables: 0, math_spans: 0, dropped_words_pct: 0, invented_words_pct: 0, chars: 90,
};

describe("keys", () => {
  it("map 1–4 to the four answers", () => {
    expect(KEY_CHOICE).toEqual({ "1": "left", "2": "right", "3": "same", "4": "both_bad" });
  });
});

describe("dash", () => {
  it("shows a dash for what was not measured", () => {
    expect(dash(null)).toBe("—");
    expect(dash(undefined)).toBe("—");
    expect(dash(0)).toBe("0");
    expect(dash(52.66, 1)).toBe("52.7");
  });
});

describe("splitFooter", () => {
  it("cuts the output around the footer lines the server named", () => {
    const md = "# Title\nbody\nLecturer Softwaretechnik 3\n3\nmore";
    expect(splitFooter(md, [2, 3])).toEqual([
      { kind: "md", text: "# Title\nbody" },
      { kind: "footer", text: "Lecturer Softwaretechnik 3\n3" },
      { kind: "md", text: "more" },
    ]);
  });
  it("counts lines like Python's splitlines", () => {
    expect(splitFooter("a\r\nb" + String.fromCharCode(0x2028) + "c", [1])).toEqual([
      { kind: "md", text: "a" },
      { kind: "footer", text: "b" },
      { kind: "md", text: "c" },
    ]);
  });
  it("leaves output without footer lines whole", () => {
    expect(splitFooter("a\n\nb", [])).toEqual([{ kind: "md", text: "a\n\nb" }]);
  });
});

describe("checkChips", () => {
  it("says what is clean and gives no share when there was no break to judge", () => {
    const labels = checkChips(CLEAN).map((c) => c.label);
    expect(labels).toContain("no footer");
    expect(labels).toContain("no line breaks to judge");
    expect(labels).toContain("1 headings · 2 list items");
  });
  it("marks leaks and wrong symbols as bad", () => {
    const chips = checkChips({ ...CLEAN, footer_leaks: 3, footer_leaked: true, wrong_symbols: 2, title_first: false });
    expect(chips.filter((c) => c.tone === "bad").map((c) => c.label)).toEqual([
      "footer leaked ×3",
      "title not first",
      "wrong symbols ×2",
    ]);
  });
  it("skips title first where it does not apply", () => {
    expect(checkChips({ ...CLEAN, title_first: null }).some((c) => c.label.startsWith("title"))).toBe(false);
  });
});

describe("sessions and pace", () => {
  it("makes a session id the server accepts", () => {
    expect(newSession()).toMatch(/^s-[0-9a-f]{16}$/);
  });
  it("estimates the minutes left at the median pace", () => {
    expect(minutesLeft(30, [])).toBe(6);
    expect(minutesLeft(30, [4, 4, 100])).toBe(2);
  });
});

describe("interval chart", () => {
  it("always shows the 1000 line and clamps", () => {
    const scale = axis([{ lo: 1040, hi: 1200 }]);
    expect(scale[0]).toBeLessThan(1000);
    expect(pct(1000, scale)).toBeGreaterThan(0);
    expect(pct(5000, scale)).toBe(100);
  });
});

describe("jobs", () => {
  const job: Job = { job_id: "job-1", kind: "run", tool: "current", sha256: null, file_name: null, purpose: "explore",
    state: "running", stage: "timed", run_id: null, error: null };
  it("names the stage of a running job", () => {
    expect(jobLabel(job)).toBe("running");
    expect(jobLabel({ ...job, stage: "waiting" })).toBe("waiting for the running method");
    expect(jobLabel({ ...job, state: "failed", error: "current was cancelled" })).toBe("failed: current was cancelled");
  });
});

describe("paid methods", () => {
  it("show dollars to the cent", () => {
    expect([usd(0.0634), usd(0.004), usd(0), usd(1.005)]).toEqual(["$0.06", "<$0.01", "$0.00", "$1.00"]);
  });

  it("round a ceiling up, never down (as paid.usd does)", () => {
    expect([usd(0.6541, true), usd(0.65, true), usd(0.0001, true)]).toEqual(["$0.66", "$0.65", "$0.01"]);
  });

  it("say what is sent where before the cost OK", () => {
    const e: Estimate = { tool: "ai_vision", label: "AI vision", model: "gpt-4.1-mini", pages: 24, usd: 0.0634, max_usd: 0.6541 };
    expect(estimateLine(e)).toBe("AI vision: 24 page images to OpenAI (gpt-4.1-mini), about $0.06, at most $0.66");
    expect(estimateLine({ ...e, pages: 1 })).toContain("1 page image to");
  });

  it("say what a run spent", () => {
    const c: Cost = {
      requests: 6, prompt_tokens: 15600, completion_tokens: 2100, cached_tokens: 0, reasoning_tokens: 0, usd: 0.0096,
      price: { model: "gpt-4.1-mini", input_per_m: 0.4, output_per_m: 1.6, checked_on: "2026-10-31", source: "https://x" },
    };
    expect(costLine(c)).toBe("6 requests · 15,600 input + 2,100 output tokens · $0.01 at the price of 2026-10-31");
  });

  it("say at least when pages were billed without usage, and unknown when the usage is lost", () => {
    const c: Cost = {
      requests: 5, prompt_tokens: 13000, completion_tokens: 1800, cached_tokens: 0, reasoning_tokens: 0, usd: 0.0081,
      usd_is_lower_bound: true, pages_billed_without_usage: 1,
    };
    expect(costLine(c)).toBe("5 requests · 13,000 input + 1,800 output tokens · at least $0.01 (1 page billed without usage)");
    expect(costLine({ usd: null, usage_lost: true, basis: "check the OpenAI usage page" })).toBe(
      "usage unknown — check the OpenAI usage page",
    );
  });

  it("keep a cost OK for exactly the file, mode and methods it was shown for", () => {
    const shown = { sha256: "a".repeat(64), purpose: "explore", tools: ["ai_vision", "current"] };
    expect(confirmMatches(shown, { ...shown, tools: ["current", "ai_vision"] })).toBe(true);
    expect(confirmMatches(shown, { ...shown, sha256: "b".repeat(64) })).toBe(false);
    expect(confirmMatches(shown, { ...shown, purpose: "benchmark" })).toBe(false);
    expect(confirmMatches(shown, { ...shown, tools: ["ai_vision"] })).toBe(false);
    expect(confirmMatches(shown, null)).toBe(false);
    expect(confirmMatches(null, shown)).toBe(false);
  });

  it("name what a method still needs", () => {
    const m: Method = {
      id: "ai_vision", label: "AI vision", group: "paid", description: "", ready: false, missing: ["key file missing (~/x)"],
      size_mb: 60, needs_install: false, paid: true, model: "gpt-4.1-mini", key_missing: true,
    };
    expect(methodState(m)).toBe("key");
    expect(methodState({ ...m, needs_install: true })).toBe("install");
    expect(methodState({ ...m, ready: true })).toBe("ready");
    expect(methodState({ ...m, key_missing: false })).toBe("missing");
  });
});

describe("htmlToMarkdown", () => {
  const table2x2 = "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";

  it("turns a table with a head into exact GFM, set off by blank lines", () => {
    expect(htmlToMarkdown(table2x2)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(htmlToMarkdown(`before ${table2x2} after`)).toBe("before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter");
  });

  it("takes the first row as the header when there is no thead", () => {
    expect(htmlToMarkdown("<table><tr><td>x</td><td>y</td></tr><tr><td>1</td><td>2</td></tr></table>")).toBe(
      "| x | y |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("spreads colspan into empty cells and rowspan into the rows below, and pads short rows", () => {
    const html =
      '<table><tr><th colspan="2">Head</th><th>C</th></tr>' +
      '<tr><td rowspan="2">a</td><td>b</td><td>c</td></tr>' +
      "<tr><td>d</td></tr>" +
      "<tr><td>e</td></tr></table>";
    expect(htmlToMarkdown(html)).toBe(
      ["| Head |  | C |", "| --- | --- | --- |", "| a | b | c |", "|  | d |  |", "| e |  |  |"].join("\n"),
    );
  });

  it("collapses a cell's whitespace, escapes | and turns <br> into a space", () => {
    expect(htmlToMarkdown("<table><tr><td>a | b<br>c\n   d</td><td>x<br/>y</td></tr></table>")).toBe(
      "| a \\| b c d | x y |\n| --- | --- |",
    );
  });

  it("keeps formatting inside a cell and decodes its entities", () => {
    expect(htmlToMarkdown("<table><tr><td>H<sub>2</sub>O &amp; <b>x</b></td></tr></table>")).toBe("| H_2O & **x** |\n| --- |");
  });

  it("turns <br> outside tables into a newline", () => {
    expect(htmlToMarkdown("a<br>b")).toBe("a\nb");
    expect(htmlToMarkdown("a<br/>b<br />c")).toBe("a\nb\nc");
  });

  it("writes sub- and superscripts the way the plain-text methods do", () => {
    expect(htmlToMarkdown("H<sub>2</sub>O")).toBe("H_2O");
    expect(htmlToMarkdown("x<sup>2</sup>")).toBe("x^2");
  });

  it("makes wrappers separate paragraphs, ignoring attributes", () => {
    expect(htmlToMarkdown('<div style="text-align:center"><b>T</b></div>')).toBe("**T**");
    expect(htmlToMarkdown("one<p>two</p>three")).toBe("one\n\ntwo\n\nthree");
    expect(htmlToMarkdown("<center>mid</center>\n\nrest")).toBe("mid\n\nrest");
  });

  it("turns bold, italic and code into Markdown, with the spaces outside the marks", () => {
    expect(htmlToMarkdown("<strong>a</strong> <em>b</em> <i>c</i> <code>d</code>")).toBe("**a** *b* *c* `d`");
    expect(htmlToMarkdown("<b> T </b>x")).toBe(" **T** x");
    expect(htmlToMarkdown("<code>a&lt;b</code>")).toBe("`a<b`");
  });

  it("replaces a stray <img> with [figure] and drops other known tags, keeping their text", () => {
    expect(htmlToMarkdown('x <img src="a.png" alt="q"> y')).toBe("x [figure] y");
    expect(htmlToMarkdown('<span class="k">kept</span> <u>text</u>')).toBe("kept text");
  });

  it("decodes entities, named and numeric", () => {
    expect(htmlToMarkdown("a &amp; b")).toBe("a & b");
    expect(htmlToMarkdown("1&nbsp;&lt;&nbsp;2 &#8212; &#x41;")).toBe("1\u00a0<\u00a02 \u2014 A");
    expect(htmlToMarkdown("&unknownthing; &#99999999;")).toBe("&unknownthing; &#99999999;");
  });

  it("does not eat prose that merely contains < and >", () => {
    expect(htmlToMarkdown("if x<y and y>z then <https://a.b/c>")).toBe("if x<y and y>z then <https://a.b/c>");
  });

  it("leaves fenced code, inline code and math untouched", () => {
    const fenced = "```html\n<table><tr><td>x</td></tr></table>\n<br>\n```";
    expect(htmlToMarkdown(fenced)).toBe(fenced);
    expect(htmlToMarkdown("~~~\n<b>x</b>\n~~~\n")).toBe("~~~\n<b>x</b>\n~~~\n");
    expect(htmlToMarkdown("use `<br>` and ``<b>`x`</b>`` here")).toBe("use `<br>` and ``<b>`x`</b>`` here");
    expect(htmlToMarkdown("$a<b>c$ and $$\nx<sup>2</sup>\n$$")).toBe("$a<b>c$ and $$\nx<sup>2</sup>\n$$");
    expect(htmlToMarkdown(`${fenced}\n\na<br>b`)).toBe(`${fenced}\n\na\nb`);
  });

  it("returns plain Markdown byte for byte", () => {
    const md = [
      "# Title",
      "",
      "Some *text* with $x_1$ and a [link](http://a.b).",
      "",
      "- one",
      "- two",
      "  - nested",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```",
      "a <br> b",
      "```",
      "",
      "cost $5 and $6, if x<y.  ",
      "",
    ].join("\n");
    expect(htmlToMarkdown(md)).toBe(md);
  });

  it("never changes plain text that only looks a little like HTML", () => {
    const probes = [
      "if p<q>0 then",
      "for a<b, c>d",
      "when i<s and j>t",
      "P(A<B|C>D)",
      "Find $x$ where a<b and b>c",
      "a<p and b>c",
      "x <b> y and <i> z",
      "a<u>b",
      "R&D costs 5 & 6 < 7 > 3",
    ];
    for (const probe of probes) expect(htmlToMarkdown(probe)).toBe(probe);
    const crlf = "if p<q>0 then\r\nnext line\r\n";
    expect(htmlToMarkdown(crlf)).toBe(crlf);
  });

  it("converts a pair that is really there, even with attributes", () => {
    expect(htmlToMarkdown('x <b class="k" data-x=1>y</b> z')).toBe("x **y** z");
    expect(htmlToMarkdown("a<b>c</b>d, but p<q>0")).toBe("a**c**d, but p<q>0");
  });

  it("keeps a <br> inside a Markdown pipe-table row from splitting the row", () => {
    expect(htmlToMarkdown("| a | b<br>c |\n|---|---|\n| 1 | 2 |")).toBe("| a | b c |\n|---|---|\n| 1 | 2 |");
    expect(htmlToMarkdown("text<br>more\n| a | b<br/>c |")).toBe("text\nmore\n| a | b c |");
  });

  it("removes HTML comments, and an unclosed one to the end of its line, but not inside code", () => {
    expect(htmlToMarkdown("a<!-- note -->b")).toBe("ab");
    expect(htmlToMarkdown("a<!--\nmulti\nline-->b")).toBe("ab");
    expect(htmlToMarkdown("keep<!-- open\nnext line")).toBe("keep\nnext line");
    expect(htmlToMarkdown("`<!-- x -->` and ```\n<!-- y -->\n```".replace("```\n", "\n```\n"))).toBe(
      "`<!-- x -->` and \n```\n<!-- y -->\n```",
    );
    expect(htmlToMarkdown("&lt;!-- shown --&gt;")).toBe("\\<!-- shown -->");
  });

  it("turns lists, rules, quotes and headings into Markdown blocks", () => {
    expect(htmlToMarkdown("<ul><li>one</li><li>two <b>x</b></li></ul>")).toBe("- one\n- two **x**");
    expect(htmlToMarkdown("intro<ol>\n<li>a\n<li>b</ol>after")).toBe("intro\n\n- a\n- b\n\nafter");
    expect(htmlToMarkdown("a<hr>b")).toBe("a\n\nb");
    expect(htmlToMarkdown("<blockquote>quoted</blockquote>tail")).toBe("quoted\n\ntail");
    expect(htmlToMarkdown("<h1>Title</h1>text<h3> Sub  part </h3>more")).toBe("# Title\n\ntext\n\n### Sub part\n\nmore");
    expect(htmlToMarkdown("<h2><i>x</i></h2>")).toBe("## *x*");
  });

  it("reads CRLF text as LF once it has HTML in it", () => {
    expect(htmlToMarkdown("a<br>b\r\nc")).toBe("a\nb\nc");
  });

  it("is idempotent", () => {
    const samples = [
      table2x2,
      "a<br>b H<sub>2</sub>O x<sup>2</sup> <div><b>T</b></div> &amp;lt;br&amp;gt; &lt;b&gt;x&lt;/b&gt; &amp;amp;",
      '<table><tr><th colspan="2">H</th></tr><tr><td rowspan="2">a</td><td>b|c</td></tr><tr><td><code>x|y</code></td></tr></table>tail',
      "```\n<br>\n```\n<p>x</p>\n`<br>` <code>q&lt;r</code> <i>e</i>",
      "<center>mid</center>\n\nrest <unclosed> <b>never closed",
    ];
    for (const s of samples) {
      const once = htmlToMarkdown(s);
      expect(htmlToMarkdown(once)).toBe(once);
    }
    expect(htmlToMarkdown("&lt;b&gt;x&lt;/b&gt;")).toBe("\\<b>x\\</b>");
    expect(htmlToMarkdown("&amp;lt;")).toBe("\\&lt;");
  });
});
