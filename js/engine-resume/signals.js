/* =========================================================
 * signals.js — resume_engine/signals.py 的 1:1 移植
 * ---------------------------------------------------------
 * 每一条判断都要能指向一行原文：不产出「整体感觉不好」，
 * 只产出「第 7 行这句是弱动词 + 没有数」。
 *
 * 两个显式处理：
 *   1. 把「2021.09」当成量化 → 派生 maskFakeNumbers 先遮掉假数字
 *   2. 「协助开发定位问题」里的"定位"不算结果 → 动词档位与结果标志分开算
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;

  var QUANT_RANK = { "规模": 5, "频率": 4, "占比": 3, "时间": 2, "对比": 1 };
  var QUANT_SCORE = { "规模": 25, "频率": 22, "占比": 20, "时间": 18, "对比": 15 };
  var TIER_SCORE = { 5: 30, 4: 26, 3: 18, 2: 8, 1: 2, 0: 6 };

  var FAKE_RE = D.fake_num.map(function (p) { return new RegExp(p); });
  var QUANT_RE = {};
  Object.keys(D.quant_patterns).forEach(function (lv) {
    QUANT_RE[lv] = D.quant_patterns[lv].map(function (p) { return new RegExp(p); });
  });

  function maskFakeNumbers(text) {
    var t = String(text);
    FAKE_RE.forEach(function (re) { t = t.replace(new RegExp(re.source, "g"), "·"); });
    return t;
  }

  function findQuant(text) {
    var clean = maskFakeNumbers(text);
    var hit = [];
    Object.keys(QUANT_RE).forEach(function (lv) {
      var pats = QUANT_RE[lv];
      for (var i = 0; i < pats.length; i++) {
        if (pats[i].test(clean)) { hit.push(lv); break; }
      }
    });
    hit.sort(function (a, b) { return QUANT_RANK[b] - QUANT_RANK[a]; });
    return hit;
  }

  function countFakeNumbers(text) {
    var n = 0;
    FAKE_RE.forEach(function (re) {
      var m = String(text).match(new RegExp(re.source, "g"));
      if (m) n += m.length;
    });
    return n;
  }

  function verbTier(sentence) {
    for (var i = 0; i < D.verb_lookup.length; i++) {
      var v = D.verb_lookup[i][0];
      if (sentence.indexOf(v) !== -1) return { tier: D.verb_lookup[i][1], verb: v };
    }
    return { tier: 0, verb: "" };
  }

  function analyzeBullet(b) {
    var t = b.text || "";
    var s = {
      idx: b.idx, text: b.text, section: b.section, line: b.line,
      length: t.length, verbTier: 0, verb: "",
      hasResult: false, resultWords: [], quant: [], vague: [],
      overclaim: [], firstPerson: [], score: 0, issues: []
    };

    var vt = verbTier(t);
    s.verbTier = vt.tier;
    s.verb = vt.verb;

    s.resultWords = D.result_markers.filter(function (w) { return t.indexOf(w) !== -1; });
    s.hasResult = s.resultWords.length > 0;
    s.quant = findQuant(t);
    s.vague = D.vague_words.filter(function (w) { return t.indexOf(w) !== -1; });
    s.overclaim = D.overclaim_words.filter(function (w) { return t.indexOf(w) !== -1; });
    s.firstPerson = D.first_person.filter(function (w) { return t.indexOf(w) !== -1; });

    var sc = TIER_SCORE[s.verbTier];
    if (s.quant.length) {
      sc += QUANT_SCORE[s.quant[0]];
      if (s.quant.length >= 2) sc += 5;
    }
    if (s.hasResult) sc += 20;
    sc -= 15 * s.vague.length;
    sc -= 10 * s.overclaim.length;
    sc -= 8 * s.firstPerson.length;
    if (s.length > 120) sc -= 5;
    if (s.length < 8) sc -= 5;

    var isContent = s.section === "工作经历" || s.section === "实习经历" || s.section === "项目经历";
    if ((s.verbTier === 1 || s.verbTier === 2) && !s.quant.length) {
      s.issues.push("「" + s.verb + "」只说明你在这件事里，没说明你做了什么");
    }
    if (!s.quant.length && isContent) {
      s.issues.push("这句没有任何可核对的数量或变化");
    }
    if (!s.hasResult && isContent) {
      s.issues.push("全是过程，没有结果（所以呢？）");
    }
    if (s.vague.length) {
      s.issues.push("空话：" + s.vague.slice(0, 3).join("、"));
    }

    s.score = Math.max(0, Math.min(100, sc));
    return s;
  }

  function isWeak(b) { return b.verbTier === 1 || b.verbTier === 2; }
  function hasQuant(b) { return b.quant.length > 0; }
  function isResultSentence(b) { return b.hasResult && b.quant.length > 0; }

  /** Python 的 round() 是银行家舍入（.5 取偶），JS 的 toFixed/Math.round 不是 */
  function pyRound(x, digits) {
    var f = Math.pow(10, digits);
    var v = x * f;
    var base = Math.floor(v);
    var d = v - base;
    var r;
    if (d > 0.5) r = base + 1;
    else if (d < 0.5) r = base;
    else r = (base % 2 === 0) ? base : base + 1;
    return r / f;
  }

  function excerpt(b, n) {
    n = n || 34;
    var t = String(b.text || "").trim();
    return t.length <= n ? t : t.slice(0, n) + "…";
  }

  function analyze(r) {
    var sig = {
      bullets: [],
      nVague: 0, nOverclaim: 0, nFirstPerson: 0, nFakeNum: 0,
      quantRatio: 0, weakRatio: 0, resultRatio: 0, avgBulletScore: 0,
      weakBullets: [], emptyBullets: []
    };
    r.bullets.forEach(function (b) { sig.bullets.push(analyzeBullet(b)); });

    var contentSections = { "工作经历": 1, "实习经历": 1, "项目经历": 1, "校园经历": 1 };
    var content = sig.bullets.filter(function (b) { return contentSections[b.section]; });
    var base = content.length ? content : sig.bullets;

    sig.nVague = sig.bullets.reduce(function (a, b) { return a + b.vague.length; }, 0);
    sig.nOverclaim = sig.bullets.reduce(function (a, b) { return a + b.overclaim.length; }, 0);
    sig.nFirstPerson = sig.bullets.reduce(function (a, b) { return a + b.firstPerson.length; }, 0);
    sig.nFakeNum = countFakeNumbers(r.raw);

    if (base.length) {
      sig.quantRatio = pyRound(base.filter(hasQuant).length / base.length, 2);
      sig.weakRatio = pyRound(base.filter(isWeak).length / base.length, 2);
      sig.resultRatio = pyRound(base.filter(isResultSentence).length / base.length, 2);
      var sum = base.reduce(function (a, b) { return a + b.score; }, 0);
      sig.avgBulletScore = pyRound(sum / base.length, 1);
      sig.weakBullets = base.filter(function (b) { return isWeak(b) && !hasQuant(b); })
        .sort(function (a, b) { return b.text.length - a.text.length; });
      sig.emptyBullets = base.filter(function (b) { return !hasQuant(b) && !b.hasResult; });
    }

    // n_bullets：不算技能/荣誉
    sig.nBullets = sig.bullets.filter(function (b) {
      return b.section !== "技能证书" && b.section !== "荣誉奖项";
    }).length;

    return sig;
  }

  global.RSignals = {
    analyze: analyze,
    pyRound: pyRound,
    analyzeBullet: analyzeBullet,
    verbTier: verbTier,
    findQuant: findQuant,
    maskFakeNumbers: maskFakeNumbers,
    countFakeNumbers: countFakeNumbers,
    excerpt: excerpt,
    isWeak: isWeak,
    hasQuant: hasQuant,
    isResultSentence: isResultSentence,
    QUANT_RANK: QUANT_RANK
  };
})(typeof window !== "undefined" ? window : globalThis);