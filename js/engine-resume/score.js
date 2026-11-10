/* =========================================================
 * score.js — resume_engine/score.py 的 1:1 移植
 * ---------------------------------------------------------
 * 和"五维相加"最大的区别：**有天花板**。
 * 一份有 3 个致命问题的简历也能到 70 分 —— 那是假分。
 * 真实世界里，一个"投了就被刷"的硬伤会把整份简历的价值压到底。
 * 所以：维度分照算（保留可解释性），但致命问题 ≥1 就封顶。
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;
  var DIAG = global.RDiagnose;

  var CAP_BY_FATAL = { 0: 100, 1: 72, 2: 58, 3: 45 };
  var CAP_BY_FATAL_ABOVE = 40;

  /** Python 的 round() 是银行家舍入（.5 取偶），别用 Math.round */
  function pyRound(x) {
    var f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return (f % 2 === 0) ? f : f + 1;
  }

  function compute(r, s, p, m, d) {
    var sc = { total: 0, raw: 0, level: "C", advice: "", dimensions: [], cap: 100, capped: false };
    var nFatal = DIAG.fatal(d).length;

    // ---------- ① 关键词匹配 30 ----------
    var s1 = m.score;
    if (!m.hasJD) {
      var kws0 = D.industry_kw[p.industry] || [];
      var hits0 = kws0.filter(function (k) { return r.raw.indexOf(k) !== -1; }).length;
      s1 = kws0.length ? Math.min(30, 10 + hits0 * 4) : 15;
    }
    var i1 = [], f1 = [];
    if (m.hasJD) {
      if (m.missing.length) {
        i1.push("JD 命中 " + Math.floor(m.coverage * 100) + "%，缺 " + m.missing.length + " 个关键词");
        f1.push("补这些词（真做过才写）：" + m.missing.slice(0, 6).map(function (t) { return t.word; }).join("、"));
      } else {
        i1.push("关键词全覆盖");
      }
    } else {
      i1.push("没提供 JD，只能按行业通用标准估");
      f1.push("把目标岗位 JD 贴进来，这一项能准一倍");
    }
    sc.dimensions.push({ name: "关键词匹配", score: s1, max: 30, issues: i1, fixes: f1 });

    // ---------- ② 量化程度 25 ----------
    var q = s.quantRatio, res = s.resultRatio;
    var s2 = pyRound(Math.min(25, q * 40 + res * 15));
    if (s.nBullets && s.nBullets <= 3) s2 = Math.min(s2, 15);   // 条目太少，比率不可信
    var i2 = [], f2 = [];
    if (q === 0) {
      i2.push("没有任何一条带可核对的数量或变化");
      f2.push("先补最相关那一段，三条带数的就够翻一版");
    } else if (q < 0.4) {
      i2.push("只有 " + Math.floor(q * 100) + "% 的条目带数");
      f2.push("按「规模 → 频率 → 占比 → 耗时 → 改前改后」的顺序找数");
    } else {
      i2.push(Math.floor(q * 100) + "% 的条目带数，密度够了");
    }
    if (res < 0.3) {
      i2.push("写出「所以呢」的句子太少（有变化结果的不到三成）");
      f2.push("每条最后问一句「所以带来了什么变化」，答不上就说明还差一个结果");
    }
    sc.dimensions.push({ name: "量化程度", score: s2, max: 25, issues: i2, fixes: f2 });

    // ---------- ③ 结构清晰 20 ----------
    var s3 = 6;
    var secs = r.sections.filter(function (x) { return x.name !== "头部"; })
      .map(function (x) { return x.name; });
    var CORE = { "教育背景": 1, "工作经历": 1, "实习经历": 1, "项目经历": 1, "技能证书": 1 };
    s3 += Math.min(6, secs.filter(function (x) { return CORE[x]; }).length * 2);
    if (d.sixSecond.pass) s3 += 5;
    if (global.RParse.has(r, "求职意向")) s3 += 2;
    if (r.selfEval && r.selfEval.length > 100) s3 -= 3;
    s3 = Math.max(0, Math.min(20, s3));
    var i3 = [], f3 = [];
    if (!d.sixSecond.pass) {
      i3.push("前 6 秒抓不到「做什么 + 最强一件事」：" + d.sixSecond.missing.slice(0, 2).join("、"));
      f3.push("首屏只留：求职意向 + 最相关经历的第一条（带数）");
    }
    if (r.selfEval && r.selfEval.length > 80) {
      i3.push("自我评价 " + r.selfEval.length + " 字，占的位置太贵");
      f3.push("删掉，换成 3 条核心优势，每条挂一个证据");
    }
    if (!i3.length) i3.push("结构没有明显硬伤");
    sc.dimensions.push({ name: "结构清晰", score: s3, max: 20, issues: i3, fixes: f3 });

    // ---------- ④ 经历可信 15 ----------
    var s4 = 10;
    s4 -= pyRound(s.weakRatio * 5);
    s4 -= Math.min(3, s.nOverclaim);
    s4 -= Math.min(2, s.nFirstPerson);
    if (s.resultRatio >= 0.5) s4 += 3;
    s4 = Math.max(0, Math.min(15, s4));
    var i4 = [], f4 = [];
    if (s.weakRatio >= 0.5) {
      i4.push(Math.floor(s.weakRatio * 100) + "% 的句子是弱动词开头");
      f4.push("「负责/参与/协助」换掉，不改内容只改动词");
    }
    if (s.nOverclaim) {
      i4.push(s.nOverclaim + " 处过度表述（精通/各种/所有）");
      f4.push("改成可验证的：做过几次、多大量级、什么结果");
    }
    if (!i4.length) i4.push("没有明显的可信度问题");
    sc.dimensions.push({ name: "经历可信", score: s4, max: 15, issues: i4, fixes: f4 });

    // ---------- ⑤ 行业适配 10 ----------
    var kws = D.industry_kw[p.industry] || [];
    var hits = kws.length ? kws.filter(function (k) { return r.raw.indexOf(k) !== -1; }) : [];
    var s5 = kws.length ? Math.min(10, hits.length * 3) : 6;
    var i5 = [], f5 = [];
    if (kws.length && !hits.length) {
      i5.push("没有" + p.industry + "行业的特征词");
      f5.push("这个行业认：" + kws.slice(0, 5).join("、"));
    } else if (kws.length && hits.length < 3) {
      i5.push("只有 " + hits.length + " 个行业特征词，偏少");
      f5.push("可以补：" + kws.filter(function (k) { return hits.indexOf(k) === -1; }).slice(0, 4).join("、"));
    }
    if (D.industry_pitfall[p.industry]) {
      i5.push("这个行业常见坑：" + D.industry_pitfall[p.industry]);
    }
    if (!i5.length) i5.push(p.industry + "特征词齐全");
    sc.dimensions.push({ name: "行业适配", score: s5, max: 10, issues: i5, fixes: f5 });

    sc.raw = sc.dimensions.reduce(function (a, x) { return a + x.score; }, 0);
    var cap = CAP_BY_FATAL.hasOwnProperty(String(nFatal)) ? CAP_BY_FATAL[String(nFatal)] : CAP_BY_FATAL_ABOVE;
    sc.cap = cap;
    sc.capped = sc.raw > cap;
    sc.total = Math.min(sc.raw, cap);

    if (sc.total >= 80) {
      sc.level = "A"; sc.advice = "可以投了。剩下的是按岗微调，不是大改。";
    } else if (sc.total >= 65) {
      sc.level = "B"; sc.advice = "结构没问题，缺的是量化和关键词的精准度。";
    } else if (sc.total >= 45) {
      sc.level = "C"; sc.advice = "有明确硬伤。按下面前两条改一版，通过率能明显不同。";
    } else {
      sc.level = "D"; sc.advice = "不是修辞问题：现在这份里没有可被筛选的信息，需要重写。";
    }
    if (nFatal) sc.advice += "（" + nFatal + " 处致命问题已限制得分上限）";
    return sc;
  }

  global.RScore = { compute: compute, pyRound: pyRound, CAP_BY_FATAL: CAP_BY_FATAL };
})(typeof window !== "undefined" ? window : globalThis);