/* =========================================================
 * parse.js — resume_engine/parse.py 的 1:1 移植（含行号追踪）
 * ---------------------------------------------------------
 * 目标不是完美解析，而是稳定拿到三样：
 *   ① 版块（教育/经历/项目/技能/自评）—— 决定结构分
 *   ② 条目（时间 + 公司 + 职位 + 若干 bullet）—— 决定内容分
 *   ③ 时间线（起止、月数、空窗）—— 决定稳定性判断
 *
 * 与 Python 唯一的差别：每条 bullet / 每个版块行都带 `line`（0 起始行号），
 * 因为前端要在原文上圈出位置。行号只是附注，不参与任何判断。
 * 解析失败不抛错，退化成整段文本。
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;

  var DATE_RE = /((?:19|20)\d{2})\s*[.\-/年]?\s*(1[0-2]|0?[1-9])?/g;
  var DATE_HEAD_RE = /^[\s•·*\-—]*((?:19|20)\d{2})/;
  var CURRENT_RE = /(至今|现在|目前|present|Present|PRESENT|now|NOW)/;
  var BULLET_RE = /^([•·*\-—–▪●○◆◇]|\d+[.、)])\s*/;
  var SPLIT_RE = /(?<=[。；;!？?])\s*/;
  var NOISE_RE = new RegExp(D.noise_line, "i");
  var SPLIT_ORG_RE = /[|｜·•,，\t]| {2,}/;

  /* ---------------- 工具 ---------------- */
  function nowYM() {
    var n = new Date();
    return [n.getFullYear(), n.getMonth() + 1];
  }

  function cmpYM(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return (a[0] - b[0]) || (a[1] - b[1]);
  }

  function ymMonths(from, to) {
    return (to[0] - from[0]) * 12 + (to[1] - from[1]);
  }

  /** Python round(x, 1) 是银行家舍入，别用 Math.round */
  function pyRound1(x) {
    var v = x * 10, base = Math.floor(v), d = v - base;
    var r = d > 0.5 ? base + 1 : (d < 0.5 ? base : ((base % 2 === 0) ? base : base + 1));
    return r / 10;
  }

  function titleScore(t) {
    var lvKeys = Object.keys(D.level_words).map(Number).sort(function (a, b) { return a - b; });
    var n = 0;
    lvKeys.forEach(function (lv) {
      D.level_words[String(lv)].forEach(function (w) {
        if (t.indexOf(w) !== -1) n += lv >= 1 ? 2 : 1;
      });
    });
    Object.keys(D.job_families).forEach(function (fam) {
      var kws = D.job_families[fam].kw || [];
      for (var i = 0; i < kws.length; i++) {
        if (t.indexOf(kws[i]) !== -1) { n += 1; break; }
      }
    });
    if (t.length <= 10) n += 1;
    return n;
  }

  /** 'XX公司 | 运营专员' → {org, title}，判断依据：哪半边像职位 */
  function splitOrgTitle(text) {
    var parts = String(text).split(SPLIT_ORG_RE).map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
    if (!parts.length) return { org: "", title: "" };
    if (parts.length === 1) {
      var t0 = parts[0];
      if (titleScore(t0) >= 2) return { org: "", title: t0 };
      return { org: t0, title: "" };
    }
    var a = parts[0], b = parts[1];
    if (titleScore(b) > titleScore(a)) return { org: a, title: b };
    if (titleScore(a) > titleScore(b)) return { org: b, title: a };
    return { org: a, title: b };
  }

  function looksLikeDateHead(line) {
    var head = line.trim().slice(0, 12);
    return DATE_HEAD_RE.test(head);
  }

  function eachDate(s) {
    var out = [];
    DATE_RE.lastIndex = 0;
    var m;
    while ((m = DATE_RE.exec(s)) !== null) {
      out.push([m[1], m[2] || ""]);
      if (m[0] === "") DATE_RE.lastIndex++;
    }
    return out;
  }

  function parseRange(line) {
    var s = String(line).trim();
    var dates = eachDate(s);
    if (!dates.length) return { start: null, end: null, isCurrent: false };

    function mk(d) {
      return [parseInt(d[0], 10), d[1] ? parseInt(d[1], 10) : 1];
    }

    var start = mk(dates[0]);
    var current = CURRENT_RE.test(s);
    var end = null;
    if (dates.length >= 2) {
      end = mk(dates[1]);
    } else if (!current) {
      // 只有一个日期且没有「至今」→ 可能是单点（"2024.06 毕业"），不当区间
      return { start: null, end: null, isCurrent: false };
    }
    return { start: start, end: end, isCurrent: current };
  }

  function stripFirstDates(s, count) {
    var n = 0;
    return s.replace(DATE_RE, function (m) {
      if (n < count) { n++; return " "; }
      return m;
    });
  }

  function isNoise(line) {
    var s = String(line).trim();
    if (!s) return true;
    return NOISE_RE.test(s);
  }

  /** 把条目正文行拆成 bullet：有项目符号按符号拆，没有按句号拆 */
  function splitBullets(bodyLines) {
    var out = [];
    var buf = [];

    function pushText(t, line) {
      if (t && t.length >= 2) out.push({ t: t, line: line });
    }

    bodyLines.forEach(function (ln) {
      var s = ln.t.trim();
      if (!s) return;
      if (BULLET_RE.test(s)) {
        if (buf.length) {
          pushText(buf.map(function (x) { return x.t; }).join(" "), buf[0].line);
          buf = [];
        }
        pushText(s.replace(BULLET_RE, "").trim(), ln.line);
      } else {
        buf.push(ln);
      }
    });
    if (buf.length) pushText(buf.map(function (x) { return x.t; }).join(" "), buf[0].line);

    // 没有项目符号的一大段 → 按句末标点切
    var final = [];
    out.forEach(function (b) {
      if (b.t.length > 90) {
        SPLIT_RE.test("");           // 触发 lookbehind 的能力检测（失败会抛，外面兜）
        b.t.split(SPLIT_RE).forEach(function (c) {
          var t = c.trim();
          if (t && t.length >= 2) final.push({ t: t, line: b.line });
        });
      } else {
        final.push(b);
      }
    });
    return final;
  }

  /* ---------------- 主解析 ---------------- */
  function parse(text) {
    var raw = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var lines = raw.split("\n");
    var r = {
      raw: raw,
      sections: [],
      entries: [],
      header: [],
      selfEval: "",
      bullets: [],
      nChars: raw.length,
      nCharsNoSpace: raw.replace(/\s/g, "").length,
      nLines: lines.filter(function (x) { return x.trim(); }).length
    };

    // ① 切版块（一行只有标题且 ≤16 字，才当版块标题）
    var cur = { name: "头部", lines: [] };
    r.sections.push(cur);
    lines.forEach(function (ln, i) {
      if (isNoise(ln)) return;
      var s = ln.trim();
      var matched = false;
      if (s.length <= 16) {
        for (var k = 0; k < D.section_patterns.length; k++) {
          var name = D.section_patterns[k][0];
          var pat = new RegExp(D.section_patterns[k][1]);
          if (pat.test(s) && !/\d{4}/.test(s)) {
            cur = { name: name, lines: [] };
            r.sections.push(cur);
            matched = true;
            break;
          }
        }
      }
      if (!matched) cur.lines.push({ t: s, line: i });
    });

    var head = section(r, "头部");
    r.header = head ? head.lines : [];

    // ② 自我评价单独拎出来（常常是一整段，不当 bullet 算）
    var se = section(r, "自我评价");
    if (se) r.selfEval = se.lines.map(function (x) { return x.t; }).join(" ");

    // ③ 条目化
    var skipSections = { "技能证书": 1, "荣誉奖项": 1, "自我评价": 1, "求职意向": 1, "作品集": 1 };
    r.sections.forEach(function (sec) {
      if (skipSections[sec.name]) return;
      if (sec.name === "头部") {
        entriesFrom(sec).forEach(function (e) {
          if (e.start) {
            e.section = "工作经历";    // 无标题时按工作经历算，比丢掉强
            r.entries.push(e);
          }
        });
      } else {
        entriesFrom(sec).forEach(function (e) { r.entries.push(e); });
      }
    });

    // ④ 全文 bullet（带全局序号）
    var gid = 0;
    r.entries.forEach(function (e) {
      e.bullets.forEach(function (b) {
        gid += 1;
        b.idx = gid;
        b.section = e.section;
        r.bullets.push(b);
      });
    });

    // 技能/自评没有条目，也要能进分析（虚拟条目）
    r.sections.forEach(function (sec) {
      if (sec.name === "技能证书" || sec.name === "荣誉奖项") {
        gid += 1;
        r.bullets.push({
          text: sec.lines.map(function (x) { return x.t; }).join(" "),
          idx: gid,
          section: sec.name,
          line: sec.lines.length ? sec.lines[0].line : 0
        });
      }
    });

    return r;
  }

  function entriesFrom(sec) {
    var entries = [];
    var cur = null;
    var body = [];

    function flush() {
      if (!cur) return;
      splitBullets(body).forEach(function (bt) {
        cur.bullets.push({ text: bt.t, line: bt.line });
      });
      entries.push(cur);
      cur = null;
      body = [];
    }

    sec.lines.forEach(function (ln) {
      var s = ln.t.trim();
      if (looksLikeDateHead(s)) {
        flush();
        var rg = parseRange(s);
        var rest = s.replace(/^[\s•·*\-—]*/, "");
        rest = stripFirstDates(rest, 2);
        rest = rest.replace(/(至今|现在|目前|present|Present|NOW|now)/g, " ");
        rest = rest.replace(/[.\-/~至到\s]{2,}/g, " ")
          .replace(/^[ \-–—|·]+|[ \-–—|·]+$/g, "");
        var ot = splitOrgTitle(rest);
        cur = {
          section: sec.name, head: s, start: rg.start, end: rg.end,
          isCurrent: rg.isCurrent, org: ot.org, title: ot.title,
          bullets: [], line: ln.line
        };
      } else if (cur === null) {
        // 版块开头没有日期 → 也起一个条目，把日期留空
        var ot2 = splitOrgTitle(s);
        cur = {
          section: sec.name, head: s, start: null, end: null,
          isCurrent: false, org: ot2.org, title: ot2.title,
          bullets: [], line: ln.line
        };
      } else {
        body.push(ln);
      }
    });
    flush();
    return entries;
  }

  /* ---------------- 结构访问 ---------------- */
  function section(r, name) {
    for (var i = 0; i < r.sections.length; i++) {
      if (r.sections[i].name === name) return r.sections[i];
    }
    return null;
  }

  function has(r, name) {
    return !!section(r, name);
  }

  function months(e) {
    if (!e.start) return 0;
    var end = e.end || nowYM();
    return Math.max(0, ymMonths(e.start, end));
  }

  function label(e) {
    var t = (e.title || e.org || e.head || "").trim().slice(0, 30);
    return t || "（未命名条目）";
  }

  /* ---------------- 时间线 ---------------- */
  function timeline(entries) {
    var es = entries.filter(function (e) {
      return e.start && (e.section === "工作经历" || e.section === "实习经历");
    });
    es.sort(function (a, b) { return cmpYM(a.start, b.start); });
    if (!es.length) {
      return { span_months: 0, n_jobs: 0, gaps: [], avg_tenure: 0, short_stints: 0, n_entries: 0 };
    }

    var gaps = [];
    for (var i = 0; i + 1 < es.length; i++) {
      var a = es[i], b = es[i + 1];
      var aEnd = a.end || nowYM();
      if (!b.start) continue;
      var gap = ymMonths(aEnd, b.start);
      if (gap >= 3) gaps.push({ after: label(a), before: label(b), months: gap, line: b.line });
    }

    var tenures = es.map(months).filter(function (t) { return t > 0; });
    var first = es[0].start;
    var lastEnd = es[0].end || nowYM();
    es.forEach(function (e) {
      var end = e.end || nowYM();
      if (cmpYM(end, lastEnd) > 0) lastEnd = end;
    });
    var span = ymMonths(first, lastEnd);

    var sum = tenures.reduce(function (a, b) { return a + b; }, 0);
    var avg = tenures.length ? pyRound1(sum / tenures.length) : 0;
    return {
      span_months: Math.max(0, span),
      n_jobs: es.length,
      gaps: gaps,
      avg_tenure: avg,
      short_stints: tenures.filter(function (t) { return t < 12; }).length,
      n_entries: es.length
    };
  }

  global.RParse = {
    parse: parse,
    section: section,
    has: has,
    months: months,
    label: label,
    timeline: timeline,
    nowYM: nowYM,
    cmpYM: cmpYM,
    helpers: { titleScore: titleScore, splitOrgTitle: splitOrgTitle, parseRange: parseRange, isNoise: isNoise }
  };
})(typeof window !== "undefined" ? window : globalThis);