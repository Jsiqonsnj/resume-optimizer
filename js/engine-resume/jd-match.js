/* =========================================================
 * jd-match.js — resume_engine/jd_match.py 的 1:1 移植
 * ---------------------------------------------------------
 * 判断分三块：
 *   ① 术语覆盖 —— 机筛看的就是这个（要原词，不是同义词）
 *   ② 硬门槛   —— 学历/年限/证书，不满足就别浪费一次投递
 *   ③ 结论     —— 该投 / 勉强 / 别投（<40% 覆盖直接劝换岗）
 *
 * 中文没分词器，用「词表命中 + 剩余 n-gram」两层，
 * 比按 2-6 字硬切准得多（硬切会把「良好的沟通能力」切成六个关键词）。
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;

  var STOP = {};
  D.jd_stopwords.forEach(function (w) { STOP[w] = 1; });

  var ENG_RE = /[A-Za-z][A-Za-z+#./ ]{1,18}[A-Za-z+#]|[A-Za-z]{2,12}/g;
  var CN_RE = /[\u4e00-\u9fa5]{2,8}/g;

  var EDU_RANK = D.edu_rank;
  var HARD_CERTS = ["CPA", "CMA", "ACCA", "CFA", "PMP", "一级建造师", "二级建造师",
    "教师资格证", "执业医师", "执业药师", "护士执业证", "驾照"];

  function cleanJD(jd) {
    return String(jd).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function hasLetter(s) { return /[A-Za-z]/.test(s); }

  /** Python round() 是银行家舍入 */
  function pyRound(x) {
    var base = Math.floor(x), d = x - base;
    if (d > 0.5) return base + 1;
    if (d < 0.5) return base;
    return (base % 2 === 0) ? base : base + 1;
  }

  /** 从 JD 抽术语，权重按「是不是硬技能」给 */
  function extractTerms(jd) {
    var text = cleanJD(jd);
    var terms = new Map();          // key = 小写，插入顺序即优先级顺序

    // ① 词表命中（最可靠）
    D.jd_dict.forEach(function (w) {
      if (text.indexOf(w) === -1) return;
      var wl = w.toLowerCase();
      if (STOP[wl]) return;
      var kind = hasLetter(w) ? "工具" : "术语";
      terms.set(wl, { word: w, weight: 3, kind: kind, hit: false, via: "" });
    });

    // ② 英文/技术词
    var engs = text.match(ENG_RE) || [];
    engs.forEach(function (raw) {
      var w = raw.trim();
      if (w.length < 2) return;
      var wl = w.toLowerCase();
      if (terms.has(wl) || STOP[wl]) return;
      terms.set(wl, { word: w, weight: 3, kind: "英文", hit: false, via: "" });
    });

    // ③ 中文 n-gram 补充（只留"像术语"的：2-5 字，不带虚词头尾）
    var gramHits = new Map();
    (text.match(CN_RE) || []).forEach(function (cn) {
      [2, 3, 4].forEach(function (n) {
        for (var i = 0; i + n <= cn.length; i++) {
          var g = cn.slice(i, i + n);
          if (STOP[g]) continue;
          if ("的了和与及或等".indexOf(g[0]) !== -1) continue;
          if ("的了和与及或等".indexOf(g[g.length - 1]) !== -1) continue;
          gramHits.set(g, (gramHits.get(g) || 0) + 1);
        }
      });
    });

    // 去掉被更长术语包含的短 gram
    var known = Array.from(terms.keys());
    var ranked = Array.from(gramHits.entries())
      .map(function (e, i) { return { g: e[0], c: e[1], i: i }; })
      .sort(function (a, b) { return (b.c - a.c) || (a.i - b.i); })
      .slice(0, 60);

    ranked.forEach(function (row) {
      var gl = row.g.toLowerCase();
      if (terms.has(gl)) return;
      for (var i = 0; i < known.length; i++) {
        if (gl.indexOf(known[i]) !== -1 || known[i].indexOf(gl) !== -1) return;
      }
      known.push(gl);
      terms.set(gl, { word: row.g, weight: row.c >= 2 ? 2 : 1, kind: "术语", hit: false, via: "" });
    });

    var out = Array.from(terms.values()).filter(function (t) { return t.weight >= 2; });
    // 第三键 word 与 Python 端一致：DICT 是 set，迭代序不稳定，
    // 不加词名兜底时「缺哪 8 个词」会随机器变化
    out.sort(function (a, b) {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (b.word.length !== a.word.length) return b.word.length - a.word.length;
      return a.word < b.word ? -1 : (a.word > b.word ? 1 : 0);
    });
    return out.slice(0, 60);
  }

  function synVariants(word) {
    var vs = [word];
    Object.keys(D.jd_synonyms).forEach(function (k) {
      var lst = D.jd_synonyms[k];
      if (word === k || lst.indexOf(word) !== -1) {
        lst.forEach(function (v) { vs.push(v); });
        vs.push(k);
      }
    });
    var seen = {}, out = [];
    vs.forEach(function (v) {
      if (seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
    return out;
  }

  function matchJD(resumeText, jd) {
    var m = {
      hasJD: false, coverage: 0, covered: [], missing: [], hard: [],
      verdict: "", advice: "", score: 0
    };
    if (!(jd && jd.trim())) {
      m.hasJD = false;
      m.verdict = "未提供 JD";
      m.advice = "把目标岗位 JD 复制三条过来，对照着改 —— 这是最划算的一步";
      m.score = 15;
      return m;
    }

    m.hasJD = true;
    var terms = extractTerms(jd);
    if (!terms.length) {
      m.verdict = "JD 太短";
      m.advice = "JD 内容不足，换一段完整的岗位描述";
      m.score = 15;
      return m;
    }

    var resumeLower = String(resumeText).toLowerCase();
    var totW = 0, totHitW = 0;
    terms.forEach(function (t) {
      totW += t.weight;
      var found = "";
      var vs = synVariants(t.word);
      for (var i = 0; i < vs.length; i++) {
        if (resumeLower.indexOf(vs[i].toLowerCase()) !== -1) { found = vs[i]; break; }
      }
      if (found) {
        t.hit = true;
        t.via = found;
        m.covered.push(t);
        totHitW += t.weight;
        if (found !== t.word) t.kind = "同义命中";
      } else {
        m.missing.push(t);
      }
    });

    m.coverage = totHitW / Math.max(1, totW);
    m.hard = hardRequirements(jd, resumeText);
    m.score = Math.max(0, Math.min(30, pyRound(m.coverage / 0.6 * 30)));

    if (m.coverage >= 0.6) {
      m.verdict = "该投";
      m.advice = "关键词覆盖够了，机筛这一关问题不大，精力放在把经历写得更实";
    } else if (m.coverage >= 0.4) {
      m.verdict = "勉强";
      m.advice = "缺 " + m.missing.length + " 个关键词，把你在别的场景真做过的对应的事，换成 JD 的原词写进来";
    } else {
      m.verdict = "别投这个岗";
      m.advice = "这份简历的内容和这个岗对不上，改简历解决不了 —— " +
        "不是写得不好，是证据不在这个方向。换一个和你经历同族的岗，改起来才有效";
    }
    return m;
  }

  function hardRequirements(jd, resumeText) {
    var out = [];

    // 学历
    var reqEdu = null;
    Object.keys(EDU_RANK).forEach(function (word) {
      if (reqEdu) return;
      if (new RegExp(word + "(?:及以上|以上|学历)").test(jd)) {
        reqEdu = { word: word, rank: EDU_RANK[word] };
      }
    });
    if (reqEdu) {
      var have = Object.keys(EDU_RANK)
        .filter(function (w) { return resumeText.indexOf(w) !== -1; })
        .map(function (w) { return EDU_RANK[w]; });
      var maxHave = have.length ? Math.max.apply(null, have) : null;
      var ok = maxHave !== null && maxHave >= reqEdu.rank;
      out.push({
        item: "学历要求 " + reqEdu.word + "及以上", ok: ok,
        note: ok ? "" : "简历里看不到对应学历，可能第一关就被筛掉"
      });
    }

    // 年限
    var m = jd.match(/(\d+)\s*年(?:以上|及以上)?/);
    if (m && parseInt(m[1], 10) >= 2) {
      var need = parseInt(m[1], 10);
      var ys = [];
      var re2 = /(\d+)\s*年(?:工作)?经验/g, mm;
      while ((mm = re2.exec(resumeText)) !== null) ys.push(parseInt(mm[1], 10));
      if (!ys.length) {
        out.push({
          item: "要求 " + need + " 年经验", ok: null,
          note: "简历里没写年限，HR 会自己算你的时间线，算出来不够就直接过"
        });
      } else {
        var okY = Math.max.apply(null, ys) >= need;
        out.push({
          item: "要求 " + need + " 年经验", ok: okY,
          note: okY ? "" : "简历写 " + Math.max.apply(null, ys) + " 年，差 " + (need - Math.max.apply(null, ys)) + " 年"
        });
      }
    }

    // 证书 / 工具
    HARD_CERTS.forEach(function (cert) {
      if (jd.indexOf(cert) === -1) return;
      var okC = resumeText.indexOf(cert) !== -1;
      out.push({
        item: "证书 " + cert, ok: okC,
        note: okC ? "" : "硬门槛，没有就别投这一岗"
      });
    });

    // 六级 / 四级
    var langs = ["六级", "CET-6", "四级", "CET-4"];
    for (var i = 0; i < langs.length; i++) {
      var lv = langs[i];
      if (jd.indexOf(lv) === -1) continue;
      var want6 = lv.indexOf("六级") !== -1 || lv.indexOf("6") !== -1;
      var pool = want6 ? ["六级", "CET-6", "CET6"] : ["四级", "CET-4", "CET4"];
      var okL = pool.some(function (x) { return resumeText.indexOf(x) !== -1; });
      out.push({
        item: "语言 " + lv, ok: okL,
        note: okL ? "" : "简历没写，如果过了就补上，这是最便宜的一分"
      });
      break;
    }

    return out;
  }

  function toDict(m) {
    return {
      has_jd: m.hasJD,
      coverage: pyRound(m.coverage * 1000) / 1000,
      covered: m.covered.slice(0, 20).map(function (t) { return t.word; }),
      missing: m.missing.slice(0, 12).map(function (t) { return t.word; }),
      hard: m.hard,
      verdict: m.verdict,
      advice: m.advice,
      score: m.score
    };
  }

  global.RJd = {
    matchJD: matchJD,
    extractTerms: extractTerms,
    hardRequirements: hardRequirements,
    synVariants: synVariants,
    toDict: toDict
  };
})(typeof window !== "undefined" ? window : globalThis);