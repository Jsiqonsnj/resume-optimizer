/* =========================================================
 * report.js — resume_engine/report.py 的 1:1 移植
 * ---------------------------------------------------------
 * 三种出口：markdown（给人看/存文件）、text（终端）、card（一句话）
 * 前端用它做「导出报告」，格式与 Python 端逐字一致。
 * ========================================================= */

(function (global) {
  "use strict";

  var LAYER_ORDER = ["内容无效", "读不下去", "对岗不投", "面试会挨打"];
  var LEVEL_MARK = { "致命": "❗", "重要": "▲", "次要": "·" };

  function pct(x) { return Math.floor(x * 100); }

  function toMarkdown(r) {
    if (r.error) return "**无法分析**：" + r.error;
    var out = [];
    var a = function (s) { out.push(s); };

    a("# 简历审视报告");
    a("");
    a("**" + r.total + "/100**　" + r.level + " 档　｜　" + r.industry + " · " + r.family + " · " + r.kind);
    if (r.capped) a("> 原始分 " + r.raw_total + "，因 " + r.n_fatal + " 处致命问题，得分上限压到 " + r.cap);
    a("");
    a("**一句话**：" + r.advice);
    a("");

    var prof = r.profile || {};
    if (prof.summary) {
      a("## 你先是谁");
      a(prof.summary + "　（" + (r.kind_note || "") + "）");
      (prof.flags || []).forEach(function (f) { a("- " + f.note); });
      a("");
    }

    a("## 四层诊断");
    a("");
    var tops = r.tops || {};
    LAYER_ORDER.forEach(function (layer) {
      var f = tops[layer];
      if (!f) return;
      a("### " + layer + " · " + f.level);
      a("**" + f.title + "**");
      if (f.why) a("\n" + f.why);
      if (f.fix) a("\n> 怎么改：" + f.fix);
      (f.evidence || []).slice(0, 2).forEach(function (e) { a("\n- 原文：" + e); });
      a("");
    });

    if ((r.jd || {}).has_jd) {
      var jd = r.jd;
      a("## 对岗匹配");
      a("覆盖 **" + pct(jd.coverage) + "%**　结论：**" + jd.verdict + "**");
      if (jd.missing && jd.missing.length) a("- 缺：" + jd.missing.slice(0, 10).join("、"));
      if (jd.covered && jd.covered.length) a("- 已对上：" + jd.covered.slice(0, 10).join("、"));
      (jd.hard || []).forEach(function (h) {
        if (h.ok !== true) a("- " + (h.ok === false ? "⚠️" : "?") + " " + h.item + "　" + (h.note || ""));
      });
      a("");
    }

    var st = r.strengths || [];
    if (st.length) {
      a("## 你手上真有的东西");
      st.forEach(function (x) { a("- **" + x.point + "**　" + x.why); });
      a("");
    }

    var rw = r.rewrites || [];
    if (rw.length) {
      a("## 逐条改写（挑最值得改的几条）");
      a("");
      rw.forEach(function (x, i) {
        a("**" + (i + 1) + ". 原文**（#" + x.idx + "）：" + x.original);
        a("- 问题：" + x.problem);
        a("- 骨架：`" + x.skeleton + "`");
        a("- 照着写：" + x.example);
        a("- 先回答这三问：" + x.ask.join("；"));
        a("");
      });
    }

    var plan = r.restructure || [];
    if (plan.length) {
      a("## 整份怎么重排");
      plan.forEach(function (p) { a("- **" + p.do + "**\n  - 为什么：" + p.why); });
      a("");
    }

    var probes = r.probes || [];
    if (probes.length) {
      a("## 面试会被这么问（答案先想好）");
      a("");
      probes.forEach(function (p) {
        a("- **[" + p.kind + "] " + p.question + "**");
        a("  - 答法骨架：" + p.answer_skeleton);
        if (p.source) a("  - 对应：" + p.source);
      });
      a("");
    }

    if (r.self_intro) {
      a("## 60 秒自我介绍（填两个空就能用）");
      a("```");
      a(r.self_intro);
      a("```");
      a("");
    }

    a("---");
    a("下一步：" + (r.next_step || ""));
    return out.join("\n");
  }

  function toText(r) {
    if (r.error) return "无法分析：" + r.error;
    var out = [r.total + "/100  " + r.level + "  " + r.industry + " · " + r.family + " · " + r.kind,
      r.advice, ""];
    if (r.capped) out.splice(2, 0, "（原始 " + r.raw_total + "，因 " + r.n_fatal + " 处致命压到 " + r.cap + "）");
    LAYER_ORDER.forEach(function (layer) {
      var f = (r.tops || {})[layer];
      if (!f) return;
      out.push("[" + layer + "] " + (LEVEL_MARK[f.level] || "") + " " + f.title);
      if (f.fix) out.push("    → " + f.fix);
    });
    (r.dimensions || []).forEach(function (d) {
      out.push("  " + d.name + ": " + d.score + "/" + d.max);
    });
    return out.join("\n");
  }

  function toCard(r) {
    if (r.error) return r.error;
    var tops = r.tops || {};
    var first = tops["内容无效"] || tops["读不下去"] || {};
    return r.total + " 分（" + r.level + "）｜" + r.industry + "·" + r.kind + "｜" + (first.title || "");
  }

  global.RReport = { toMarkdown: toMarkdown, toText: toText, toCard: toCard, LAYER_ORDER: LAYER_ORDER };
})(typeof window !== "undefined" ? window : globalThis);