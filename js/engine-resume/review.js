/* =========================================================
 * review.js — resume_engine/__init__.py 的 1:1 移植 + 前端契约适配
 * ---------------------------------------------------------
 * ① review()     与 Python 的 review() 返回同一套字段（含四个 dataclass 的 to_dict）
 * ② toContract() 把它翻译成前端既有的 analyze() 契约：
 *                { issues[], score, jdGaps, suggestions[], formatIssues? }
 *                这样圈画动画、追问清单一行都不用改。
 *
 * 设计取舍（照抄 Python 的四条，别改回去）：
 *   1. 规则层免费、秒级、可解释 —— 网站主要靠它
 *   2. 每层只出最狠一条 —— 一次给 20 条，客户只会觉得你在挑刺
 *   3. 分数有天花板 —— 有致命问题的简历不该拿到 70 分
 *   4. 必须给亮点 —— 只否定的诊断，客户不会信第二句
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;
  var VERSION = "2.0";
  var CONTENT_SECTIONS = { "工作经历": 1, "实习经历": 1, "项目经历": 1, "校园经历": 1 };

  function toRewriteDict(x) {
    return {
      idx: x.idx, original: x.original, problem: x.problem,
      skeleton: x.skeleton, example: x.example, ask: x.ask, family: x.family
    };
  }

  function industryPitfalls(ind) {
    var kb = (D.kb[ind] || {});
    if (kb.pitfalls && kb.pitfalls.length) return kb.pitfalls.slice(0, 3);
    if (D.industry_pitfall[ind]) return [D.industry_pitfall[ind]];
    return [];
  }

  /** 完整审视，返回 Python 同构的 dict */
  function review(text, opts) {
    var full = reviewWithContext(text, opts);
    if (full.error) return { error: full.error };
    return full.out;
  }

  function reviewWithContext(text, opts) {
    opts = opts || {};
    var trimmed = String(text == null ? "" : text).trim();
    if (trimmed.length < 30) {
      return { error: "内容太短，至少粘贴 30 个字（教育背景 + 一段经历）" };
    }

    var r = global.RParse.parse(trimmed);
    var s = global.RSignals.analyze(r);
    var p = global.RProfile.build(r, opts.industry || "", opts.jobTitle || "");
    var m = global.RJd.matchJD(r.raw, opts.jd || "");
    var d = global.RDiagnose.run(r, s, p, m);
    var sc = global.RScore.compute(r, s, p, m, d);
    var rw = global.RRewrite.pickRewrites(s, p, 6);
    var plan = global.RRewrite.restructurePlan(r, p);
    var probes = global.RInterview.run(r, s, p);

    var layers = {};
    var tops = {};
    global.RDiagnose.LAYERS.forEach(function (name) {
      layers[name] = global.RDiagnose.ofLayer(d, name).map(global.RDiagnose.toDict);
    });
    Object.keys(d.tops).forEach(function (name) {
      tops[name] = global.RDiagnose.toDict(d.tops[name]);
    });

    var out = {
      version: VERSION,
      industry: p.industry,
      family: p.family,
      kind: p.kind,
      kind_note: p.kindNote,
      profile: {
        summary: global.RProfile.summary(p),
        exp_months: p.expMonths,
        n_jobs: p.nJobs,
        avg_tenure: p.avgTenure,
        short_stints: p.shortStints,
        gaps: p.gaps,
        flags: global.RProfile.flags(p)
      },
      total: sc.total,
      raw_total: sc.raw,
      level: sc.level,
      advice: sc.advice,
      capped: sc.capped,
      cap: sc.cap,
      dimensions: sc.dimensions,
      industry_keywords: D.industry_kw[p.industry] || [],
      industry_screen: (D.kb[p.industry] || {}).screen || [],
      industry_pitfalls: industryPitfalls(p.industry),
      next_step: "把这份报告截图发我微信，我给你逐条标出该改哪一行。",
      jd: global.RJd.toDict(m),
      layers: layers,
      tops: tops,
      strengths: d.strengths,
      six_second: d.sixSecond,
      rewrites: rw.map(toRewriteDict),
      restructure: plan,
      probes: probes,
      self_intro: global.RInterview.selfIntro(r, p, s),
      signals: {
        n_bullets: s.nBullets,
        quant_ratio: s.quantRatio,
        weak_ratio: s.weakRatio,
        result_ratio: s.resultRatio,
        n_vague: s.nVague,
        n_overclaim: s.nOverclaim,
        avg_bullet_score: s.avgBulletScore
      },
      n_fatal: global.RDiagnose.fatal(d).length
    };

    return { out: out, r: r, s: s, p: p, m: m, d: d, sc: sc, rw: rw };
  }

  /* =========================================================
   * 契约适配：把四层诊断翻译成「可圈可点」的疑问清单
   * ---------------------------------------------------------
   * 硬约束（engine.contract 会校验）：
   *   - lineIndex 是原文行号且不越界
   *   - excerpt 必须是该行的逐字子串（SVG 靠它定位）
   *   - type ∈ vague | data-doubt | timeline-conflict | jd-mismatch | empty-desc
   * ========================================================= */
  function lineOfText(lines, text) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(text) !== -1) return i;
    }
    return -1;
  }

  /** 取一段能逐字出现在该行的片段 */
  function anchor(lines, lineIdx, rawText) {
    var line = (lineIdx >= 0 && lineIdx < lines.length) ? lines[lineIdx] : "";
    if (!line) return null;
    var t = String(rawText || "").trim();
    var cuts = [26, 20, 16, 12, 8, 5];
    for (var i = 0; i < cuts.length; i++) {
      var cand = t.slice(0, cuts[i]);
      if (cand && line.indexOf(cand) !== -1) return { lineIndex: lineIdx, excerpt: cand };
    }
    var s = line.trim();
    if (!s) return null;
    return { lineIndex: lineIdx, excerpt: s.slice(0, Math.min(10, s.length)) };
  }

  function typeOfBullet(b) {
    if (b.overclaim.length) return "data-doubt";
    if (b.vague.length) return "vague";
    if (b.verbTier === 1 || b.verbTier === 2) return "vague";
    if (!b.quant.length) return "empty-desc";
    // 有数但没有结果：能圈（过程无收口），归到表述空泛
    if (!(global.RSignals && global.RSignals.isResultSentence(b.text))) return "empty-desc";
    return ""; // 干净条目：有数、动词不弱、有结果，不圈
  }

  function questionOf(type, b, rw) {
    var ask0 = (rw && rw.ask && rw.ask[0]) || (D.fallback_ask && D.fallback_ask[0]) || "这里面你做了什么";
    ask0 = String(ask0).replace(/[？?。！!；;]+$/, "");
    var verb = b && b.verb ? b.verb : "负责";
    if (type === "vague") return "「" + verb + "」这类动词看不出你实际做了什么 —— " + ask0 + "？";
    if (type === "empty-desc") return "这条只有过程没有结果 —— " + ask0 + "？";
    return "这个说法面试一定会被追着问 —— " + ask0 + "？";
  }

  /* 技能/证书这类整行是"清单"，不是"经历"：不圈、也不给改写骨架 */
  var META_LINE_RE = /^(技能|证书|语言|爱好|专业技能)/;

  /* 同一行只留一条疑问时，谁的优先级高 */
  var ISSUE_PRIORITY = {
    "timeline-conflict": 0,
    "data-doubt": 1,
    "jd-mismatch": 2,
    "vague": 3,
    "empty-desc": 4
  };

  function isMetaBullet(b, lines) {
    var line = lines[b.line] || "";
    var t = line.trim();
    if (META_LINE_RE.test(t)) return true;
    if (t.indexOf("技能证书") !== -1) return true;
    return META_LINE_RE.test(String(b.text || "").trim());
  }

  function buildContract(ctx, resumeText) {
    var out = ctx.out, p = ctx.p, m = ctx.m;
    var lines = String(resumeText).split(/\r\n|\r|\n/);
    var pool = [];

    var rwByIdx = {};
    (ctx.rw || []).forEach(function (rw) { rwByIdx[rw.idx] = rw; });

    /* ① 候选疑问：来自正文 bullet，按「哪条最值得让 HR 停一下」排序 */
    var cands = [];
    (ctx.s.bullets || []).forEach(function (b) {
      if (!CONTENT_SECTIONS[b.section]) return;
      if (isMetaBullet(b, lines)) return;
      var t = typeOfBullet(b);
      if (!t) return; // 干净条目不用圈，圈多了等于没圈
      cands.push({ b: b, type: t });
    });
    cands.sort(function (x, y) {
      return (x.b.score - y.b.score) || (y.b.text.length - x.b.text.length);
    });

    /* 三种 bullet 类型先各留一条（数据可疑 / 模糊表述 / 表述空泛），再按分数补；
       补的时候每类最多 3 条 —— 八条全是「没有数」，客户会觉得被车轮战 */
    var picked = [], byType = {}, typeCount = {};
    cands.forEach(function (c) { if (!byType[c.type]) byType[c.type] = c; });
    ["data-doubt", "vague", "empty-desc"].forEach(function (t) {
      if (byType[t]) {
        picked.push(byType[t]);
        typeCount[t] = 1;
      }
    });
    cands.forEach(function (c) {
      if (picked.indexOf(c) !== -1 || picked.length >= 10) return;
      var n = typeCount[c.type] || 0;
      if (n >= 3) return;
      typeCount[c.type] = n + 1;
      picked.push(c);
    });

    picked.forEach(function (c) {
      var at = anchor(lines, c.b.line, c.b.text);
      if (!at) return;
      var rw = rwByIdx[c.b.idx] || null;
      var ask = (rw && rw.ask) || [];
      pool.push({
        lineIndex: at.lineIndex,
        excerpt: at.excerpt,
        type: c.type,
        question: questionOf(c.type, c.b, rw),
        followUp: {
          hint: ask.length ? (ask[0] + (ask[1] ? "；" + ask[1] : ""))
            : "补上对象、做法、结果三件事",
          kind: c.type === "data-doubt" ? "evidence" : "detail"
        },
        _rw: rw
      });
    });

    /* ② 时间线空窗 → timeline-conflict（锚在后来那段经历的日期行） */
    var gaps = (p.gaps || []).slice().sort(function (a, b) { return b.months - a.months; });
    if (gaps.length) {
      var g = gaps[0];
      var at2 = anchor(lines, g.line, lines[g.line]);
      if (at2) {
        pool.push({
          lineIndex: at2.lineIndex,
          excerpt: at2.excerpt,
          type: "timeline-conflict",
          question: g.months + " 个月空窗（" + g.after + " → " + g.before + "），这期间在做什么？",
          followUp: { hint: "写成一行：这几个月做了什么 + 学到什么 + 现在能干什么", kind: "detail" }
        });
      }
    }

    /* ③ JD 缺口 → jd-mismatch（优先锚在技能行，那是补关键词最便宜的地方） */
    if (m.hasJD && m.missing.length) {
      var jdLine = -1;
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        if (META_LINE_RE.test(t) || t.indexOf("技能证书") !== -1) { jdLine = i; break; }
      }
      if (jdLine < 0 && cands.length) jdLine = cands[0].b.line;
      if (jdLine >= 0) {
        var at3 = anchor(lines, jdLine, lines[jdLine]);
        if (at3) {
          var missList = [];
          m.missing.forEach(function (x) {
            // "A/B 测试" 和 "A/B" 算一个词，别在提问里重复两遍
            var w = x.word;
            if (missList.some(function (y) { return y.indexOf(w) !== -1; })) return;
            missList = missList.filter(function (y) { return w.indexOf(y) === -1; });
            missList.push(w);
          });
          var miss = missList.slice(0, 2).join("、");
          pool.push({
            lineIndex: at3.lineIndex,
            excerpt: at3.excerpt,
            type: "jd-mismatch",
            question: "JD 要的「" + miss + "」简历里找不到证据 —— 哪段经历能补上？",
            followUp: { hint: "把真做过的对应经历换成 JD 的原词写进来，别硬塞关键词", kind: "evidence" }
          });
        }
      }
    }

    /* ④ 岗位错位 → jd-mismatch（锚在求职意向行） */
    if (p.mismatch) {
      var intentSec = global.RParse.section(ctx.r, "求职意向");
      if (intentSec && intentSec.lines.length) {
        var ln = intentSec.lines[0].line;
        var at4 = anchor(lines, ln, lines[ln]);
        if (at4) {
          pool.push({
            lineIndex: at4.lineIndex,
            excerpt: at4.excerpt,
            type: "jd-mismatch",
            question: "求职意向是「" + p.mismatch.target + "」，内容却全是「" + p.mismatch.content + "」的语言 —— 怎么翻译？",
            followUp: { hint: "旧经历不删，把动作换成目标岗听得懂的词，并补一句为什么转", kind: "detail" }
          });
        }
      }
    }

    /* ⑤ 收敛：同一行只留一条（优先级高的胜出），按行号排序，上限 8 条 */
    var byLine = {};
    pool.forEach(function (x) {
      var cur = byLine[x.lineIndex];
      if (!cur) { byLine[x.lineIndex] = x; return; }
      var px = ISSUE_PRIORITY[x.type], pc = ISSUE_PRIORITY[cur.type];
      if (px === undefined) px = 9;
      if (pc === undefined) pc = 9;
      if (px < pc) byLine[x.lineIndex] = x;
    });

    var issues = Object.keys(byLine).map(function (k) { return byLine[k]; });
    issues.sort(function (a, b) { return a.lineIndex - b.lineIndex; });
    if (issues.length > 8) {
      /* 超了先保证每种 type 各留一条，再按阅读顺序补满 —— 契约自检要求 5 种全覆盖 */
      var keep = [], tSeen = {};
      issues.forEach(function (x) {
        if (!tSeen[x.type]) {
          tSeen[x.type] = 1;
          keep.push(x);
        }
      });
      issues.forEach(function (x) {
        if (keep.indexOf(x) === -1 && keep.length < 8) keep.push(x);
      });
      keep.sort(function (a, b) { return a.lineIndex - b.lineIndex; });
      issues = keep.slice(0, 8);
    }

    // out.jd.missing 里已经是词面字符串（toDict 出的），m.missing 才是带权重的对象
    var jdGaps = m.hasJD ? (out.jd.missing || []).slice() : [];
    if (!jdGaps.length) {
      var kws = D.industry_kw[p.industry] || [];
      jdGaps = kws.filter(function (k) { return ctx.r.raw.indexOf(k) === -1; });
    }
    // 去掉互相包含的重复词（"A/B" 与 "A/B 测试" 只留长的那个）
    var gapOut = [];
    jdGaps.forEach(function (w) {
      if (gapOut.some(function (y) { return y.indexOf(w) !== -1; })) return;
      for (var i = gapOut.length - 1; i >= 0; i--) {
        if (w.indexOf(gapOut[i]) !== -1) gapOut.splice(i, 1);
      }
      gapOut.push(w);
    });
    jdGaps = gapOut.slice(0, 12);

    var suggestions = (out.rewrites || []).map(function (x) {
      return {
        original: x.original,
        rewritten: x.example,
        reason: x.problem + "｜骨架：" + x.skeleton
      };
    });
    if (!suggestions.length) {
      suggestions = [{
        original: "（暂无可改写条目）",
        rewritten: "先补一条「动词 + 对象 + 做法 + 结果」的经历，再回来改。",
        reason: "引擎需要至少一条工作/项目经历才能给骨架。"
      }];
    }

    return {
      issues: issues,
      score: out.total,
      jdGaps: jdGaps,
      suggestions: suggestions,
      professional: buildProfessional(ctx)
    };
  }

  /** 前端展示用的中文键版本（不参与契约校验） */
  function buildProfessional(ctx) {
    var out = ctx.out;
    return {
      version: out.version,
      industry: out.industry,
      family: out.family,
      kind: out.kind,
      kindNote: out.kind_note,
      profile: out.profile,
      total: out.total,
      rawTotal: out.raw_total,
      level: out.level,
      advice: out.advice,
      capped: out.capped,
      cap: out.cap,
      nFatal: out.n_fatal,
      dimensions: out.dimensions,
      layers: out.layers,
      tops: out.tops,
      strengths: out.strengths,
      sixSecond: out.six_second,
      rewrites: out.rewrites,
      restructure: out.restructure,
      probes: out.probes,
      selfIntro: out.self_intro,
      signals: out.signals,
      jd: out.jd,
      industryScreen: out.industry_screen,
      industryPitfalls: out.industry_pitfalls,
      industryKeywords: out.industry_keywords,
      markdown: function () { return global.RReport.toMarkdown(out); }
    };
  }

  /* ---------------- refine：某条疑问 + 用户补充 → 改写 ---------------- */
  function firstText() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function trimTail(s) {
    var t = String(s).trim().replace(/[。；;，,.\s]+$/, "");
    return t.length > 60 ? t.slice(0, 60) + "…" : t;
  }

  function refine(issue, userInput) {
    var input = (userInput && typeof userInput === "object") ? userInput : {};
    var rw = (issue && issue._rw) || null;
    var detail = firstText(input.detail, input.background, input.action, input.result, input.text);
    var proof = firstText(input.proof, input.evidence);

    var skeleton = rw ? rw.skeleton : "【动词】+【对象】+【做法】+【结果：指标从 A 到 B】";
    var example = rw ? rw.example : "";
    var ask = (rw && rw.ask && rw.ask.length) ? rw.ask : D.fallback_ask;

    // 用户补了细节：他自己的话就是改写结果，骨架只是校对参照
    var rewritten;
    if (detail && detail.length >= 8) {
      rewritten = trimTail(detail).replace(/\s*\n\s*/g, "；");
    } else if (example) {
      rewritten = example;
    } else {
      rewritten = "把「" + ((issue && issue.excerpt) || "这一条") + "」按这个顺序重写：" + skeleton;
    }

    var advice = "骨架：" + skeleton + "。先回答这三个问题：" + ask.join("；") + "。";
    if (detail) advice += "你说的「" + trimTail(detail) + "」放进骨架里，顺序别乱 —— 动词在最前，结果在最后。";
    if (proof) advice += "证据「" + trimTail(proof) + "」放在句尾，一个数就够，不需要形容词。";
    if (!detail && !proof) advice += "下面这句是示例，改的是结构不是文采：只填你真实做过的，别编。";

    return { rewritten: rewritten, advice: advice };
  }

  global.ResumeEngine = {
    VERSION: VERSION,
    review: review,
    reviewWithContext: reviewWithContext,
    buildContract: buildContract,
    refine: refine,
    toMarkdown: function (out) { return global.RReport.toMarkdown(out); },
    toText: function (out) { return global.RReport.toText(out); }
  };
})(typeof window !== "undefined" ? window : globalThis);