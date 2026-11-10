/* =========================================================
 * engine-rules.js — 离线规则引擎（无需网络 / 无需 Key）
 * ---------------------------------------------------------
 * 与 engine.js 同一契约，提供 analyze() 与 refine()。
 * engine.js 负责调度：优先走本文件的规则实现，异常时回落到假数据。
 *
 * 另外提供 formatIssues：文档格式层面的「HR 心理活动」，
 * 由 upload.js 在解析时采集的 docFormat（字号 / 字体 / 页数 / 空段落）驱动。
 * ========================================================= */

(function (global) {
  "use strict";

  var TYPE = {
    vague: { label: "模糊表述" },
    "data-doubt": { label: "数据可疑" },
    "timeline-conflict": { label: "时间线冲突" },
    "jd-mismatch": { label: "JD 不匹配" },
    "empty-desc": { label: "表述空泛" }
  };

  /* ------------------------------ 词表 ------------------------------ */

  var VAGUE_WORDS = [
    "负责相关工作", "负责日常工作", "负责日常事务", "参与相关工作", "参与日常工作",
    "协助相关工作", "相关业务", "相关工作", "各类事务", "日常事务", "等日常",
    "配合相关部门", "负责日常"
  ];

  var EMPTY_WORDS = [
    "认真负责", "团队协作能力", "沟通能力强", "沟通协调能力", "学习能力强", "抗压能力强",
    "抗压能力", "有责任心", "积极主动", "吃苦耐劳", "性格开朗", "富有激情", "热爱工作",
    "热爱行业", "具备良好的", "较强的沟通"
  ];

  var DATA_RE = /(提升|增长|提高|降低|下降|节省|减少|压缩|翻倍)[^，。；;、\n]{0,12}?(\d+(?:\.\d+)?)\s*(%|％|倍|个百分点)/g;

  var DATE_RANGE_RE = /(19|20)\d{2}\s*[.\-\/年]\s*\d{0,2}\s*月?\s*(?:-|–|—|~|至|到)\s*(?:(19|20)\d{2}\s*[.\-\/年]?\s*\d{0,2}\s*月?|至今|今)/g;

  var SECTION_WORDS = ["教育", "工作经历", "项目", "技能", "实习", "证书", "自我评价"];

  var STOP = ["以及", "相关", "工作", "能力", "经验", "负责", "参与", "熟练", "熟悉", "优先", "要求", "岗位", "职责", "以上", "具备", "良好", "完成", "进行", "能够", "我们", "公司", "团队"];

  /* ------------------------------ 工具 ------------------------------ */

  function splitLines(text) {
    return String(text == null ? "" : text).split(/\r\n|\r|\n/);
  }

  function trim(s) { return String(s == null ? "" : s).trim(); }

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

  function includesAny(line, list) {
    for (var i = 0; i < list.length; i++) {
      if (line.indexOf(list[i]) !== -1) return list[i];
    }
    return "";
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function excerptOf(line, token) {
    var idx = line.indexOf(token);
    if (idx === -1) return "";
    return token;
  }

  /* ------------------------------ 时间线 ------------------------------ */

  function parseDateRanges(line) {
    var out = [];
    DATE_RANGE_RE.lastIndex = 0;
    var m;
    while ((m = DATE_RANGE_RE.exec(line)) !== null) {
      var raw = m[0];
      var startYear = parseInt((raw.match(/^(19|20)\d{2}/) || [])[0], 10);
      if (!startYear) continue;
      var rest = raw.slice(String(startYear).length);
      var startMonthM = rest.match(/^\s*[.\-\/年]?\s*(\d{1,2})/);
      var startMonth = startMonthM ? parseInt(startMonthM[1], 10) : 1;
      if (startMonth < 1 || startMonth > 12) startMonth = 1;

      var tail = raw.slice(-4);
      var endYear, endMonth;
      if (raw.indexOf("至今") !== -1 || raw.indexOf("今") !== -1) {
        var now = new Date();
        endYear = now.getFullYear();
        endMonth = now.getMonth() + 1;
      } else {
        var years = raw.match(/(19|20)\d{2}/g) || [];
        endYear = parseInt(years[years.length - 1], 10);
        var endPart = raw.split(/[-–—~至到]/).pop() || "";
        var endMonthM = tail !== String(endYear) ? endPart.match(/(\d{1,2})\s*月?\s*$/) : null;
        endMonth = endMonthM ? parseInt(endMonthM[1], 10) : 12;
        if (endMonth < 1 || endMonth > 12) endMonth = 12;
      }

      out.push({
        raw: raw,
        start: startYear * 12 + startMonth,
        end: endYear * 12 + endMonth
      });
    }
    return out;
  }

  function findTimelineConflicts(lines) {
    var intervals = [];
    lines.forEach(function (line, i) {
      parseDateRanges(line).forEach(function (r) {
        intervals.push({ lineIndex: i, start: r.start, end: r.end, raw: r.raw });
      });
    });

    var conflicts = [];
    for (var i = 0; i < intervals.length; i++) {
      for (var j = i + 1; j < intervals.length; j++) {
        var a = intervals[i], b = intervals[j];
        if (a.lineIndex === b.lineIndex) continue;
        var overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
        if (overlap >= 2) {
          // 圈在后开始的那一段上
          var later = a.start >= b.start ? a : b;
          conflicts.push({
            lineIndex: later.lineIndex,
            excerpt: later.raw.trim(),
            months: overlap
          });
        }
      }
    }
    return conflicts;
  }

  /* ------------------------------ 关键词 ------------------------------ */

  function industryKeywords(industry) {
    var db = global.INDUSTRY_DB || {};
    var entry = db[industry] || null;
    return entry && entry.keywords ? entry.keywords.slice() : [];
  }

  function jdTokens(jdText) {
    var tokens = String(jdText || "").split(/[\s,，、;；:：/|()（）【】\[\]<>《》"“”'‘’]+/);
    var out = [];
    tokens.forEach(function (t) {
      var s = trim(t).replace(/[.。!！?？]+$/, "");
      if (s.length >= 2 && s.length <= 12 && STOP.indexOf(s) === -1 && !/^(要求|熟悉|精通|掌握|具备|拥有|具有|优先|相关)/.test(s)) out.push(s);
    });
    return out;
  }

  function findMissingKeywords(resumeText, jdText, industry) {
    var lower = resumeText.toLowerCase();
    var pool = [];
    industryKeywords(industry).forEach(function (k) { if (pool.indexOf(k) === -1) pool.push(k); });
    jdTokens(jdText).forEach(function (k) { if (pool.indexOf(k) === -1) pool.push(k); });

    var missing = pool.filter(function (k) {
      return lower.indexOf(String(k).toLowerCase()) === -1;
    });
    return { pool: pool, missing: missing };
  }

  /* ------------------------------ 逐行分析 ------------------------------ */

  function issue(type, lineIndex, excerpt, question, hint, kind) {
    return {
      lineIndex: lineIndex,
      excerpt: excerpt,
      type: type,
      question: question,
      followUp: { hint: hint, kind: kind }
    };
  }

  function analyzeLines(lines, jdText, industry, context) {
    var issues = [];
    var usedLines = {};

    // 1) 时间线冲突优先（位置明确）
    findTimelineConflicts(lines).forEach(function (c) {
      if (usedLines[c.lineIndex]) return;
      usedLines[c.lineIndex] = true;
      issues.push(issue(
        "timeline-conflict", c.lineIndex, c.excerpt,
        "这段和另一段经历重叠了 " + c.months + " 个月，当时是全职还是兼职？",
        "说明两段的时间关系与投入方式（全职 / 兼职 / 创业）", "evidence"
      ));
    });

    // 2) 数据可疑 / 模糊表述 / 空泛描述（一行只圈一处）
    lines.forEach(function (line, i) {
      if (usedLines[i] || !trim(line)) return;

      DATA_RE.lastIndex = 0;
      var dm = DATA_RE.exec(line);
      if (dm) {
        var dataExcerpt = dm[0];
        if (line.indexOf(dataExcerpt) === -1) return; // 理论上不会发生，保底跳过
        usedLines[i] = true;
        issues.push(issue(
          "data-doubt", i, dataExcerpt,
          "这个「" + dataExcerpt + "」是怎么算出来的？基线是多少、用什么方法测的？",
          "补充基线数值、统计口径与测量方法", "detail"
        ));
        return;
      }

      var vague = includesAny(line, VAGUE_WORDS);
      if (vague) {
        usedLines[i] = true;
        issues.push(issue(
          "vague", i, excerptOf(line, vague),
          "「" + vague + "」具体是哪些事？你独立负责的是哪一块？",
          "把职责拆成「模块 + 动作 + 结果」，写清独立决策的部分", "detail"
        ));
        return;
      }

      var empty = includesAny(line, EMPTY_WORDS);
      if (empty) {
        usedLines[i] = true;
        issues.push(issue(
          "empty-desc", i, excerptOf(line, empty),
          "「" + empty + "」放在谁身上都成立，有没有一件具体的事能证明？",
          "换成一件可验证的事件：做了什么、和谁协作、结果如何", "detail"
        ));
      }
    });

    // 3) JD / 行业关键词缺口，挂到技能行
    var kw = findMissingKeywords(lines.join("\n"), jdText, industry);
    if (kw.missing.length) {
      var anchor = -1;
      for (var i = 0; i < lines.length; i++) {
        if (/技能|熟练掌握|熟悉|精通|技术栈|专业能力/.test(lines[i]) && !usedLines[i] && trim(lines[i]).length >= 8) { anchor = i; break; }
      }
      if (anchor === -1) {
        for (var j = 0; j < lines.length; j++) {
          if (trim(lines[j]).length >= 8 && !usedLines[j]) { anchor = j; break; }
        }
        if (anchor === -1) {
          for (var k = 0; k < lines.length; k++) {
            if (trim(lines[k]) && !usedLines[k]) { anchor = k; break; }
          }
        }
      }
      if (anchor !== -1) {
        var line = trim(lines[anchor]);
        var excerpt = line.length > 26 ? line.slice(0, 26) : line;
        usedLines[anchor] = true;
        issues.push(issue(
          "jd-mismatch", anchor, excerpt,
          "JD 里的「" + kw.missing.slice(0, 2).join("」「") + "」在简历里没看到，这块怎么补？",
          "补充这些关键词对应的真实经历，或说明迁移路径", "detail"
        ));
      }
    }

    issues.sort(function (a, b) { return a.lineIndex - b.lineIndex; });
    return { issues: issues, keywords: kw };
  }

  /* ------------------------------ 改写建议 ------------------------------ */

  function buildSuggestions(lines, issues) {
    var out = [];
    issues.slice(0, 4).forEach(function (it) {
      var original = trim(lines[it.lineIndex] || it.excerpt);
      if (original.length > 46) original = original.slice(0, 46) + "…";
      var rewritten, reason;

      if (it.type === "data-doubt") {
        rewritten = "把「" + it.excerpt + "」补成「基线 → 动作 → 结果」：改造前基线 800ms，重构后 120ms（-85%），口径为 wrk 压测 P99。";
        reason = "HR 不信没有来源的数字。补基线与测量方法，比继续加数字更有说服力。";
      } else if (it.type === "vague") {
        rewritten = "主导 / 独立负责 + 具体模块 + 动作 + 可量化结果（如：主导订单查询链路重构，独立负责 3 个核心接口）。";
        reason = "「负责相关工作」没有信息量；STAR 里缺 A（Action），HR 无法判断你的实际作用。";
      } else if (it.type === "empty-desc") {
        rewritten = "用一件具体的事替换形容词：在一次线上故障中牵头排查，40 分钟恢复，事后补了 3 条监控规则。";
        reason = "形容词人人能写，事件与结果才能被追问、被验证。";
      } else if (it.type === "timeline-conflict") {
        rewritten = "把重叠写成并列关系并标注投入：2021.03 - 2023.06 兼职创业项目（每周 10 小时），与全职经历并行。";
        reason = "时间重叠本身不是问题，不解释才是问题；标注投入方式能消除注水嫌疑。";
      } else {
        rewritten = "补上 JD 关键词对应的真实场景：如「用 Go 重写核心网关，QPS 从 800 提升到 2400」。";
        reason = "关键词匹配是初筛硬门槛，但必须挂在真实经历上，否则面试一问就穿。";
      }
      out.push({ original: original, rewritten: rewritten, reason: reason });
    });
    return out;
  }

  /* ------------------------------ 格式心理活动 ------------------------------ */

  var DECOR_FONTS = ["华文彩云", "华文琥珀", "华文行楷", "隶书", "幼圆", "方正舒体", "方正姚体", "Comic Sans MS", "Papyrus", "Bradley Hand"];

  function formatIssues(text, context) {
    var out = [];
    var ctx = context || {};
    var lines = splitLines(text);
    var nonEmpty = lines.filter(function (l) { return trim(l); });
    var blank = lines.length - nonEmpty.length;
    var blankRatio = lines.length ? blank / lines.length : 0;

    var pages = ctx.pages || ctx.estimatedPages || 0;
    if (pages >= 3) {
      out.push({
        id: "pages", label: "页数偏多", level: "warn",
        thought: "这都 " + pages + " 页了…HR 一份简历只给十几秒，第三页我基本不会翻。"
      });
    }

    if (ctx.paragraphs && ctx.emptyParagraphs && ctx.emptyParagraphs / ctx.paragraphs > 0.3) {
      out.push({
        id: "blank-lines", label: "空行过多", level: "info",
        thought: "段落之间空这么多行，是想凑页数吗？整页看下来节奏是散的。"
      });
    } else if (!ctx.paragraphs && blankRatio > 0.22) {
      out.push({
        id: "blank-lines", label: "空行过多", level: "info",
        thought: "空行占了快三分之一，内容不够用留白凑，读起来很跳跃。"
      });
    }

    var sizes = (ctx.fontSizes || []).filter(function (s) { return s > 0; });
    if (sizes.length) {
      var uniq = [];
      sizes.forEach(function (s) { if (uniq.indexOf(s) === -1) uniq.push(s); });
      var max = Math.max.apply(null, uniq);
      var min = Math.min.apply(null, uniq);
      if (uniq.length > 4 || max - min >= 8) {
        out.push({
          id: "font-size", label: "字号层级混乱", level: "warn",
          thought: "字号从 " + min + "pt 到 " + max + "pt 有 " + uniq.length +
            " 种，标题和正文分不清，第一眼就觉得没排版。"
        });
      }
      if (max && min && max / min > 2.6) {
        out.push({
          id: "font-contrast", label: "字号反差过大", level: "info",
          thought: "标题字号是正文的两倍多，像海报不像简历，重点反而散了。"
        });
      }
    }

    var fonts = ctx.fonts || [];
    var decor = fonts.filter(function (f) {
      return DECOR_FONTS.some(function (d) { return String(f).indexOf(d) !== -1; });
    });
    if (decor.length) {
      out.push({
        id: "font-decor", label: "字体花哨", level: "warn",
        thought: "用了「" + decor.slice(0, 2).join("、") + "」…这是简历不是请柬，花体字我读得慢。"
      });
    }

    // 日期格式不统一
    var styles = {};
    nonEmpty.forEach(function (l) {
      var m = l.match(/\b(19|20)\d{2}\s*([.\-\/年])\s*\d{1,2}/);
      if (m) styles[m[2]] = (styles[m[2]] || 0) + 1;
    });
    var styleKeys = Object.keys(styles);
    if (styleKeys.length >= 2) {
      out.push({
        id: "date-format", label: "日期格式不统一", level: "info",
        thought: "日期一会儿用「" + styleKeys[0] + "」一会儿用「" + styleKeys[1] + "」，细节上就不够严谨。"
      });
    }

    var phone = /1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/.test(text);
    var mail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(text);
    if (!phone || !mail) {
      out.push({
        id: "contact", label: "联系方式不全", level: "warn",
        thought: !phone && !mail
          ? "电话和邮箱都没有，我连约面试都约不到，这份简历直接进回收站。"
          : (!phone ? "只有邮箱没有电话，急着招人时我会先打给有电话的。" : "邮箱没写，作品和材料我发给谁？")
      });
    }

    var missingSections = ["教育", "工作经历", "项目", "技能"].filter(function (w) {
      return text.indexOf(w) === -1;
    });
    if (missingSections.length >= 2) {
      out.push({
        id: "sections", label: "分区不清晰", level: "warn",
        thought: "没有「" + missingSections.slice(0, 2).join("」「") + "」这些分区，我得自己从段落里猜结构，太费劲了。"
      });
    }

    if (ctx.kind === "pptx") {
      out.push({
        id: "pptx", label: "用 PPT 投简历", level: "info",
        thought: "简历是 PPT 做的，每页信息量太少，还要我点下一页，不如一页纸清楚。"
      });
    }

    if (ctx.kind === "pdf" && !ctx.textLayer) {
      out.push({
        id: "scanned-pdf", label: "疑似扫描件", level: "warn",
        thought: "这份 PDF 像是扫描的，我复制不了关键词，系统也搜不到你。"
      });
    }

    return out;
  }

  /* ------------------------------ 对外接口 ------------------------------ */

  async function analyze(resumeText, jdText, industry, context) {
    var lines = splitLines(resumeText);
    if (!lines.some(function (l) { return trim(l); })) {
      return {
        issues: [], score: 0, jdGaps: [], suggestions: [],
        formatIssues: [], _meta: { engine: "rules", empty: true }
      };
    }

    var result = analyzeLines(lines, jdText, industry, context);
    var issues = result.issues;
    var suggestions = buildSuggestions(lines, issues);
    var fmt = formatIssues(resumeText, context);

    var score = 92;
    issues.forEach(function (it) {
      if (it.type === "data-doubt") score -= 8;
      else if (it.type === "timeline-conflict") score -= 9;
      else if (it.type === "jd-mismatch") score -= 6;
      else if (it.type === "vague") score -= 4;
      else score -= 3;
    });
    score = clamp(score - fmt.filter(function (f) { return f.level === "warn"; }).length * 3, 28, 96);

    return {
      issues: issues,
      score: score,
      jdGaps: result.keywords.missing.slice(0, 8).map(function (k) {
        return "简历中没有出现「" + k + "」";
      }),
      suggestions: suggestions,
      formatIssues: fmt,
      _meta: {
        engine: "rules",
        industry: industry || "",
        lineCount: lines.length,
        keywordPool: result.keywords.pool.length,
        formatCount: fmt.length
      }
    };
  }

  async function refine(issue, userInput) {
    var input = userInput && typeof userInput === "object" ? userInput : {};
    var detail = trim(input.detail || input.background || input.action || input.result || input.text || "");
    var proof = trim(input.proof || input.evidence || "");
    var excerpt = (issue && issue.excerpt) || "这段经历";
    var line = trim(input.original || "");

    var rewritten;
    if (detail) {
      var action = detail.replace(/^我/, "");
      rewritten = "围绕「" + excerpt + "」，我" + action +
        (proof ? "；结果用可核对的口径说明（" + proof + "）。" : "；并补一句可量化的结果（处理量 / 耗时 / 错误率）。");
    } else {
      rewritten = "把「" + excerpt + "」改成「主导 / 负责 + 具体模块 + 动作 + 指标」的句式，并在括号里补基线与测量方式。";
    }

    var advice = proof
      ? "面试时先给结论，再给证据链：打开「" + proof + "」→ 说明口径 → 对比基线。被追问不要绕回形容词，直接给数字。"
      : "面试时按「背景一句、动作两句、结果一句」讲；结果必须带数字，被问口径就说明测试条件，不要临场编造。";

    if (line && input.kind === "proof") {
      advice += " 如果数据涉密，准备一版脱敏说明（去掉客户名与金额），只说量级与口径。";
    }

    return { rewritten: rewritten, advice: advice };
  }

  global.RuleEngine = {
    analyze: analyze,
    refine: refine,
    formatIssues: formatIssues,
    TYPE: TYPE,
    // 供调试
    _internal: {
      parseDateRanges: parseDateRanges,
      findMissingKeywords: findMissingKeywords
    }
  };
})(window);