/* =========================================================
 * profile.js — resume_engine/profile.py 的 1:1 移植
 * ---------------------------------------------------------
 * 先认人，再开药：同样一句「负责日常运营」，
 * 在校招生身上是「没经验」，在五年老兵身上是「没成果」。
 * 认错客户类型的伤害，比不改简历更大。
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;
  var P = global.RParse;

  function levelOf(text) {
    var best = null;
    Object.keys(D.level_words).forEach(function (k) {
      var lv = Number(k);
      D.level_words[k].forEach(function (w) {
        if (text.indexOf(w) !== -1) best = (best === null) ? lv : Math.max(best, lv);
      });
    });
    return best;
  }

  function industryHitsViaKB(text) {
    var best = "通用", bestN = 0;
    Object.keys(D.kb || {}).forEach(function (ind) {
      var kws = (D.kb[ind] || {}).keywords || [];
      var n = kws.filter(function (w) { return w && text.indexOf(w) !== -1; }).length;
      if (n > bestN) { best = ind; bestN = n; }
    });
    return { industry: best, hits: bestN };
  }

  function detectIndustry(text, hint) {
    if (hint && hint !== "自动识别") return { industry: hint, hits: 99 };
    var best = "通用", bestN = 0;
    Object.keys(D.industry_kw).forEach(function (ind) {
      if (ind === "通用") return;
      var n = D.industry_kw[ind].filter(function (k) { return text.indexOf(k) !== -1; }).length;
      if (n > bestN) { best = ind; bestN = n; }
    });
    if (bestN < 2) {
      var kb = industryHitsViaKB(text);
      if (kb.hits > bestN) return kb;
    }
    return { industry: best, hits: bestN };
  }

  function detectFamily(text, jobTitle) {
    var best = "通用", bestN = 0;
    Object.keys(D.job_families).forEach(function (fam) {
      if (fam === "通用") return;
      var kws = D.job_families[fam].kw || [];
      var n = kws.filter(function (k) { return text.indexOf(k) !== -1; }).length;
      n += kws.filter(function (k) { return (jobTitle || "").indexOf(k) !== -1; }).length * 2;
      if (n > bestN) { best = fam; bestN = n; }
    });
    return { family: best, hits: bestN };
  }

  function graduationYear(text) {
    var re = /((?:19|20)\d{2})\s*[年.\-/]?\s*(?:届|毕业)/g;
    var ys = [], m;
    while ((m = re.exec(text)) !== null) ys.push(parseInt(m[1], 10));
    return ys.length ? Math.max.apply(null, ys) : null;
  }

  function build(r, industryHint, jobTitle) {
    var p = {
      kind: "通用", kindNote: "", industry: "通用", family: "通用", familyHits: 0,
      targetLevel: null, contentLevel: null, mismatch: null,
      expMonths: 0, nJobs: 0, gaps: [], avgTenure: 0, shortStints: 0,
      schoolTierHint: ""
    };

    var tl = P.timeline(r.entries);
    p.expMonths = tl.span_months;
    p.nJobs = tl.n_jobs;
    p.gaps = tl.gaps;
    p.avgTenure = tl.avg_tenure;
    p.shortStints = tl.short_stints;

    var text = r.raw;
    p.industry = detectIndustry(text, industryHint || "").industry;

    var intentSec = P.section(r, "求职意向");
    var intentTxt = intentSec ? intentSec.lines.map(function (x) { return x.t; }).join(" ") : "";
    var targetTxt = (intentTxt + " " + (jobTitle || "")).trim();
    p.targetLevel = targetTxt ? levelOf(targetTxt) : null;

    var famT = detectFamily(text, targetTxt);
    var famJ = detectFamily("", targetTxt);
    var famC = detectFamily(text, "");
    if (famJ.hits >= 1) {
      p.family = famJ.family;
      p.familyHits = Math.max(famJ.hits, famT.hits);
    } else if (famT.hits >= 2) {
      p.family = famT.family;
      p.familyHits = famT.hits;
    } else {
      p.family = famC.family;
      p.familyHits = famC.hits;
    }

    var jobTitles = r.entries
      .filter(function (e) { return e.section === "工作经历" || e.section === "实习经历"; })
      .map(function (e) { return e.title; }).join(" ");
    p.contentLevel = jobTitles.trim() ? levelOf(jobTitles) : null;

    if (targetTxt && famT.hits >= 1 && famC.hits >= 3 && famT.family !== famC.family) {
      p.mismatch = {
        target: famT.family,
        content: famC.family,
        note: "求职意向是「" + famT.family + "」，但简历里主要是「" + famC.family + "」的语言和证据"
      };
    }

    var hasFullTime = r.entries.some(function (e) {
      return e.section === "工作经历" && P.months(e) >= 3;
    });
    var gradYear = graduationYear(text);
    var isFresh = gradYear !== null && gradYear >= 2024;

    if (!hasFullTime || (isFresh && p.expMonths < 12)) {
      p.kind = "校招";
      p.kindNote = !hasFullTime ? "没有满 3 个月的全职经历，按校招看" : "毕业年份显示你是应届/准应届";
    } else if (p.expMonths < 36) {
      p.kind = "社招1-3";
      p.kindNote = "约 " + Math.floor(p.expMonths / 12) + " 年全职经验";
    } else if (p.expMonths < 96) {
      p.kind = "社招3+";
      p.kindNote = "约 " + Math.floor(p.expMonths / 12) + " 年全职经验";
    } else {
      p.kind = "社招3+";
      p.kindNote = "约 " + Math.floor(p.expMonths / 12) + " 年全职经验（资深）";
    }
    if ((p.contentLevel || 0) >= 3) {
      p.kind = "管理";
      p.kindNote = "职位名称含经理/总监，按管理岗看";
    }

    if (p.mismatch && p.expMonths >= 12) {
      p.kind = p.kind === "管理" ? p.kind : "转行";
      if (p.kind === "转行") {
        p.kindNote = "从「" + p.mismatch.content + "」转「" + p.mismatch.target + "」，需要一段翻译";
      }
    }

    return p;
  }

  function summary(p) {
    var bits = [p.kind, p.industry, p.family];
    if (p.expMonths) {
      bits.push("约 " + Math.floor(p.expMonths / 12) + " 年 " + (p.expMonths % 12) + " 个月");
    }
    return bits.join(" · ");
  }

  function flags(p) {
    var out = [];
    if (p.kind === "校招") {
      out.push({ k: "campus", note: "校招看的是可培养性：有没有把一件小事写清楚，而不是经历多少" });
    }
    if (p.kind === "转行") {
      out.push({ k: "career_change", note: "转行要一段翻译，不是删旧经历。旧行业是你的证据，换说法不换事实" });
    }
    if (p.kind === "管理") {
      out.push({ k: "manager", note: "管理岗看盘子和责任半径：管几个人、多大营收、定过什么标准" });
    }
    if (p.shortStints >= 2) {
      out.push({ k: "job_hopping", note: "有 " + p.shortStints + " 段不满一年的经历，稳定性会被追问" });
    }
    if (p.gaps.length) {
      out.push({ k: "gap", note: "时间线有 " + p.gaps.length + " 处空窗，需要一句体面的解释" });
    }
    if (p.mismatch) {
      out.push({ k: "mismatch", note: p.mismatch.note });
    }
    if (p.targetLevel !== null && p.contentLevel !== null) {
      if (p.targetLevel >= 3 && p.contentLevel <= 2) {
        out.push({ k: "level_gap", note: D.ipo_level_gap_tip.too_high });
      } else if (p.targetLevel <= 1 && p.contentLevel >= 3) {
        out.push({ k: "level_gap", note: D.ipo_level_gap_tip.too_low });
      }
    }
    return out;
  }

  global.RProfile = {
    build: build,
    flags: flags,
    summary: summary,
    detectIndustry: detectIndustry,
    detectFamily: detectFamily,
    levelOf: levelOf,
    industryHitsViaKB: industryHitsViaKB
  };
})(typeof window !== "undefined" ? window : globalThis);