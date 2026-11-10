/* =========================================================
 * parity-js.js — 用 Python 的黄金结果校验 JS 移植版
 * ---------------------------------------------------------
 * 做法：把 tools/golden/cases.json 里每份靶子的 Python 输出
 * （完整 dict + markdown 报告）与 JS 引擎的输出逐字段比对。
 *
 * 规则：
 *   - Python 结构为真：JS 必须包含同名同值字段（JS 可多带字段，如 line）
 *   - 数字容差 1e-6；JD 的 missing/covered 顺序允许不同（Python 走 set 迭代）
 *   - 报告 markdown 允许顿号列表内部顺序不同，其余必须逐字一致
 *
 *   node tools/parity-js.js             # 全量比对
 *   node tools/parity-js.js --verbose   # 打印每个不一致点
 * ========================================================= */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const GOLDEN = path.join(ROOT, "tools", "golden", "cases.json");
const FILES = [
  "lexicon.data.js", "parse.js", "signals.js", "profile.js", "jd-match.js",
  "diagnose.js", "rewrite.js", "interview.js", "score.js", "report.js", "review.js"
];

const VERBOSE = process.argv.includes("--verbose");

function loadEngine() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of FILES) {
    const p = path.join(ROOT, "js", "engine-resume", f);
    vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: p });
  }
  return sandbox;
}

/* ---------------- 比对 ---------------- */
const VOLATILE_ORDER = /(^|\.)(jd\.(missing|covered)|missing|covered)$/;

function sortDunhao(s) {
  return String(s).split("、").sort().join("、");
}

function isNum(v) { return typeof v === "number" && isFinite(v); }

function compare(expect, actual, at, diffs) {
  if (expect === null || expect === undefined) {
    if (!(actual === null || actual === undefined)) {
      diffs.push(`${at}: 期望 null，实际 ${JSON.stringify(actual)}`);
    }
    return;
  }
  if (typeof expect === "string") {
    if (typeof actual !== "string") {
      diffs.push(`${at}: 期望字符串，实际 ${JSON.stringify(actual)}`);
      return;
    }
    if (expect !== actual && sortDunhao(expect) !== sortDunhao(actual)) {
      diffs.push(`${at}:\n     py=${JSON.stringify(expect)}\n     js=${JSON.stringify(actual)}`);
    }
    return;
  }
  if (typeof expect === "number") {
    if (!isNum(actual)) { diffs.push(`${at}: 期望数字 ${expect}，实际 ${JSON.stringify(actual)}`); return; }
    if (Math.abs(expect - actual) > 1e-6) diffs.push(`${at}: py=${expect} js=${actual}`);
    return;
  }
  if (typeof expect === "boolean") {
    if (actual !== expect) diffs.push(`${at}: py=${expect} js=${JSON.stringify(actual)}`);
    return;
  }
  if (Array.isArray(expect)) {
    if (!Array.isArray(actual)) { diffs.push(`${at}: 期望数组，实际 ${JSON.stringify(actual)}`); return; }
    if (expect.length !== actual.length) {
      diffs.push(`${at}: 长度 py=${expect.length} js=${actual.length}`);
    }
    let e = expect, a = actual;
    if (VOLATILE_ORDER.test(at)) {
      e = expect.slice().sort();
      a = actual.slice().sort();
    }
    const n = Math.min(e.length, a.length);
    for (let i = 0; i < n; i++) compare(e[i], a[i], `${at}[${i}]`, diffs);
    return;
  }
  if (typeof expect === "object") {
    if (!actual || typeof actual !== "object") {
      diffs.push(`${at}: 期望对象，实际 ${JSON.stringify(actual)}`);
      return;
    }
    for (const k of Object.keys(expect)) {
      compare(expect[k], actual[k], at ? `${at}.${k}` : k, diffs);
    }
  }
}

/* ---------------- 主流程 ---------------- */
function main() {
  const engine = loadEngine();
  const RE = engine.ResumeEngine;
  if (!RE) {
    console.error("❌ engine-resume 没加载起来（ResumeEngine 未定义）");
    return 1;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  let bad = 0;
  const rows = [];

  for (const c of golden.cases) {
    const out = RE.review(c.text, { jd: c.jd, industry: c.industry, jobTitle: c.jobTitle });
    const diffs = [];

    if (c.expect.error) {
      if (!(out && out.error)) diffs.push("：期望 error，实际正常返回");
    } else {
      if (!out || out.error) {
        diffs.push("：JS 返回 error " + JSON.stringify(out && out.error));
      } else {
        compare(c.expect, out, "", diffs);
        // 报告正文也要一致
        const md = RE.toMarkdown(out);
        if (sortDunhao(md) !== sortDunhao(c.expect_markdown)) {
          const a = md.split("\n"), b = c.expect_markdown.split("\n");
          for (let i = 0; i < Math.max(a.length, b.length); i++) {
            if ((a[i] || "") !== (b[i] || "")) {
              diffs.push(`markdown 第 ${i + 1} 行不同：\n     py=${JSON.stringify(b[i])}\n     js=${JSON.stringify(a[i])}`);
              break;
            }
          }
        }
      }
    }

    rows.push({ name: c.name, score: out && out.total, level: out && out.level, diffs });
    if (diffs.length) {
      bad += 1;
      console.log(`\n❌ ${c.name}（${diffs.length} 处不一致）`);
      diffs.slice(0, VERBOSE ? 200 : 6).forEach(d => console.log("   " + d));
    } else {
      console.log(`✅ ${c.name.padEnd(24)} ${String(out.total).padStart(3)} /100  ${out.level}  ${out.kind}/${out.family}`);
    }
  }

  const total = golden.cases.length;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${bad === 0 ? "✅ 移植一致" : `❌ ${bad}/${total} 份与 Python 引擎不一致`}` +
    `（比对字段含四层诊断 / 五维分 / 改写 / 追问 / 自我介绍 / markdown 报告）`);
  return bad === 0 ? 0 : 1;
}

process.exit(main());