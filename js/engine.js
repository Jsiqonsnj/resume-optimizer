/* =========================================================
 * engine.js — 全站唯一的分析引擎入口（阶段 0：假数据实现）
 * ---------------------------------------------------------
 * 为什么先做这一层：动画圈画层的定位、疑问气泡、追问清单、
 * 改写对照全部依赖 analyze() 的返回结构。阶段 0 先把契约钉死，
 * 后面 engine-rules.js（离线规则）与 engine-llm.js（模型）只要
 * 遵守同一签名，UI 一行都不用改。
 *
 * 契约（与需求文档第 0 条一致）：
 *   analyze(resumeText, jdText, industry) -> Promise<{
 *     issues: [{ lineIndex, excerpt, type, question, followUp:{hint,kind} }],
 *     score: 0..100,
 *     jdGaps: string[],
 *     suggestions: [{ original, rewritten, reason }]
 *   }>
 *   refine(issue, userInput) -> Promise<{ rewritten, advice }>
 *
 * 硬约束（validateResult 会逐条检查）：
 *   - lineIndex 是 0 起始，且必须落在 resumeText 的行范围内；
 *   - excerpt 必须与 resumeText 对应那一行逐字匹配（用于 SVG 圈画定位，
 *     同一片段多次出现时取第一个匹配处）；
 *   - type 只能是下面 5 种枚举之一。
 * ========================================================= */

(function (global) {
  "use strict";

  /** 疑问类型枚举 —— 与 CSS 颜色变量、图例、圈画样式一一对应 */
  var ISSUE_TYPE_META = {
    "vague": {
      label: "模糊表述",
      color: "#8A9099",
      cssVar: "--c-vague",
      desc: "没有信息量的动词与措辞"
    },
    "data-doubt": {
      label: "数据可疑",
      color: "#D64545",
      cssVar: "--c-data-doubt",
      desc: "缺基线、口径、测量方式的数据"
    },
    "timeline-conflict": {
      label: "时间线冲突",
      color: "#E0823D",
      cssVar: "--c-timeline",
      desc: "经历重叠、空窗未解释"
    },
    "jd-mismatch": {
      label: "JD 不匹配",
      color: "#3B6FD4",
      cssVar: "--c-jd",
      desc: "JD 关键词缺失或表述不一致"
    },
    "empty-desc": {
      label: "表述空泛",
      color: "#D9A62E",
      cssVar: "--c-empty",
      desc: "只有形容词，没有动作与结果"
    }
  };

  var ISSUE_TYPES = Object.keys(ISSUE_TYPE_META);

  /* ---------------------------------------------------------
   * 契约自检用的素材
   * 用 js/demo-resume.js 那份示例（由 tools/fixtures/demo.json 生成），
   * 它故意留了 8~10 处真实毛病，所以 5 种 type 都能被覆盖到。
   * --------------------------------------------------------- */
  var DEMO = (typeof global.DEMO_RESUME === "object" && global.DEMO_RESUME) || {};

  var FAKE_SAMPLE_RESUME = DEMO.text || [
    "张三 | 后端开发工程师",
    "电话 138-0000-0000 | 邮箱 zhangsan@example.com | 北京",
    "教育背景",
    "2016.09 - 2020.06  某某大学  计算机科学与技术  本科",
    "2020.07 - 2021.06  A 公司  后端开发工程师",
    "负责相关工作，参与业务系统的日常开发与维护。",
    "2021.06 - 2022.03  B 公司  高级后端开发工程师",
    "主导订单服务重构，接口平均响应从 800ms 降到 120ms。",
    "2022.03 - 2023.09  C 公司  技术专家",
    "搭建公司级消息队列平台，支撑日均 2 亿条消息。",
    "2021.03 - 2023.06  某创业项目  技术合伙人",
    "主导开发 SaaS 后台，性能提升 300%，用户满意度大幅提升。",
    "技能",
    "熟练掌握 Java、MySQL、Redis、Kafka。",
    "精通分布式与高并发架构。",
    "工作认真负责，具备良好的团队协作能力。"
  ].join("\n");

  var FAKE_SAMPLE_JD = DEMO.jd || [
    "岗位：高级后端工程师（云原生方向）",
    "职责：负责核心交易链路的服务设计与稳定性治理；",
    "参与 Go 微服务改造与 K8s 容器化落地；",
    "带领 3-5 人小组完成季度迭代。",
    "要求：5 年以上后端经验；精通 Go 或 Java；",
    "有高并发、分布式事务、消息队列实战经验；",
    "熟悉云原生与 K8s；有团队管理经验。"
  ].join("\n");

  /* 假数据的「埋点表」：excerpt 必须在 RESUM 里逐字出现，
     找不到时下面会退化成「取第一个非空行的前 10 个字」。 */
  var FAKE_SPOTS = [
    {
      excerpt: "负责相关工作",
      type: "vague",
      question: "「负责相关工作」具体是哪些工作？你独立负责了哪一块？",
      followUp: { hint: "补充职责边界：负责的模块、独立决策的部分", kind: "detail" }
    },
    {
      excerpt: "2021.03 - 2023.06",
      type: "timeline-conflict",
      question: "这段创业经历和 B、C 两段全职时间重叠了，是全职还是兼职？",
      followUp: { hint: "说明投入方式与时间分配，避免被判定为简历注水", kind: "evidence" }
    },
    {
      excerpt: "性能提升 300%",
      type: "data-doubt",
      question: "这个 300% 是怎么测的？基线是多少、用什么工具压的？",
      followUp: { hint: "补充基线数值、压测方法与观测口径", kind: "detail" }
    },
    {
      excerpt: "Java、MySQL、Redis、Kafka",
      type: "jd-mismatch",
      question: "JD 要求 Go 与云原生，你的技术栈里没有体现，这块怎么补？",
      followUp: { hint: "补充 Go / K8s 的实际使用场景或迁移计划", kind: "detail" }
    },
    {
      excerpt: "工作认真负责，具备良好的团队协作能力",
      type: "empty-desc",
      question: "这句话放在谁身上都成立，有没有一件具体的事能证明？",
      followUp: { hint: "换成一件可验证的协作事件与结果", kind: "detail" }
    }
  ];

  function splitLines(text) {
    return String(text == null ? "" : text).split(/\r\n|\r|\n/);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /** 按文档约定：同片段多次出现时取第一个匹配处 */
  function locate(lines, excerpt) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(excerpt) !== -1) return i;
    }
    return -1;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* ---------------------------------------------------------
   * analyze —— 阶段 0 假数据实现
   * 结构完全真实，内容为固定埋点；这样阶段 2 的动画可以先跑起来。
   * --------------------------------------------------------- */
  async function analyzeFake(resumeText, jdText, industry) {
    await delay(140); // 模拟一次异步调用（LLM 版这里是网络请求）

    var lines = splitLines(resumeText);
    var issues = [];

    for (var i = 0; i < FAKE_SPOTS.length; i++) {
      var spot = FAKE_SPOTS[i];
      var lineIndex = locate(lines, spot.excerpt);

      // 没找到埋点：退化到第一段有效内容，保证结果始终可定位
      if (lineIndex < 0) {
        var fallback = findFirstContentLine(lines);
        if (fallback < 0) continue;
        var text = lines[fallback].trim();
        lineIndex = fallback;
        issues.push({
          lineIndex: lineIndex,
          excerpt: text.slice(0, Math.min(10, text.length)),
          type: spot.type,
          question: spot.question,
          followUp: spot.followUp
        });
        continue;
      }

      issues.push({
        lineIndex: lineIndex,
        excerpt: spot.excerpt,
        type: spot.type,
        question: spot.question,
        followUp: spot.followUp
      });
    }

    // 找一个真实存在的「原文 → 改写」样例；原文必须能定位
    var suggestion = buildFakeSuggestion(lines);

    return {
      issues: issues,
      // 假分数：可解释的粗糙口径，仅用于打通 UI
      score: clamp(92 - issues.length * 6, 35, 92),
      jdGaps: [
        "缺少「Go」语言相关经历",
        "缺少「云原生 / K8s」落地案例",
        "JD 要求带团队，简历没有写团队规模与协作方式"
      ],
      suggestions: [suggestion],
      _meta: {
        engine: "fake",
        industry: industry || "未选择",
        jdChars: String(jdText || "").length,
        lineCount: lines.length,
        generatedAt: new Date().toISOString()
      }
    };
  }

  function findFirstContentLine(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) return i;
    }
    return -1;
  }

  function buildFakeSuggestion(lines) {
    var idx = locate(lines, "负责相关工作");
    if (idx < 0) idx = findFirstContentLine(lines);

    if (idx < 0) {
      return {
        original: "(空简历)",
        rewritten: "先补一段有动作、有结果的项目描述。",
        reason: "没有内容时无法生成对照改写，请先载入示例简历或粘贴文本。"
      };
    }

    return {
      original: lines[idx].trim(),
      rewritten: "主导 3 个核心接口的重构，独立负责订单查询链路，QPS 从 800 提升到 2400（压测工具 wrk，P99 由 320ms 降至 90ms）。",
      reason: "把「负责相关工作」换成「主导 + 具体模块 + 可验证指标」，补上动作、范围与测量方式，符合 STAR 里的 A 与 R。"
    };
  }

  /* ---------------------------------------------------------
   * refine —— 某条 issue + 用户补充的细化内容 / 证明材料
   * 规则版（阶段 0 为模板拼装）：返回 { rewritten, advice }
   * --------------------------------------------------------- */
  /* ---------------------------------------------------------
   * 调度：resume_engine 优先 → engine-rules.js → 内置假数据
   * 三个实现都满足同一 schema，UI 不感知差异。
   * --------------------------------------------------------- */
  function hasPro() {
    return global.ResumeEngine && typeof global.ResumeEngine.reviewWithContext === "function";
  }

  function hasRules() {
    return global.RuleEngine && typeof global.RuleEngine.analyze === "function";
  }

  /* 站点行业（26 大类 / 80 方向）→ 引擎行业（10 个）。
     映射不到就传空串，让引擎自己按简历正文识别 —— 猜比硬塞准。 */
  var INDUSTRY_MAP = {
    "互联网": "互联网技术",
    "人工智能": "互联网技术",
    "金融": "财会金融",
    "快消": "销售运营",
    "零售/电商": "销售运营",
    "制造业": "机械制造",
    "汽车/新能源": "新能源制造",
    "国企央企": "通用",
    "政府/事业单位": "通用",
    "教育": "教育培训",
    "医疗": "医疗健康",
    "生物医药": "医疗健康",
    "法律": "通用",
    "财务/会计": "财会金融",
    "人力资源": "通用",
    "咨询": "通用",
    "传媒/内容": "",
    "设计/创意": "",
    "建筑/地产": "建筑工程",
    "物流/供应链": "通用",
    "能源/电力": "新能源制造",
    "通信": "互联网技术",
    "半导体": "机械制造",
    "游戏": "互联网技术",
    "文旅/酒店": "",
    "农业/食品": ""
  };

  function mapIndustry(label) {
    var s = String(label || "");
    if (!s) return "";
    var cat = s.split("-")[0];
    if (Object.prototype.hasOwnProperty.call(INDUSTRY_MAP, cat)) return INDUSTRY_MAP[cat];
    return "";
  }

  function mapJobTitle(label) {
    var s = String(label || "");
    var i = s.indexOf("-");
    return i === -1 ? "" : s.slice(i + 1);
  }

  /** 走 resume_engine：返回契约结构 + professional 扩展数据 */
  function analyzePro(resumeText, jdText, industry, context) {
    var ind = mapIndustry(industry);
    var ctx = global.ResumeEngine.reviewWithContext(resumeText, {
      jd: jdText || "",
      industry: ind,
      jobTitle: mapJobTitle(industry)
    });

    if (ctx.error) {
      return {
        issues: [], score: 0, jdGaps: [], suggestions: [], professional: null,
        _meta: { engine: "resume-engine", note: ctx.error, industry: ind }
      };
    }

    var res = global.ResumeEngine.buildContract(ctx, resumeText);

    // 格式批注仍然来自文档结构信号（引擎本身不看排版）
    if (context && hasRules() && typeof global.RuleEngine.formatIssues === "function") {
      try {
        res.formatIssues = global.RuleEngine.formatIssues(resumeText, context) || [];
      } catch (err) {
        console.warn("[engine] 格式检查异常", err);
      }
    }

    res._meta = {
      engine: "resume-engine",
      engineVersion: global.ResumeEngine.VERSION,
      industry: ind,
      industryLabel: industry || "",
      kind: ctx.out.kind,
      family: ctx.out.family,
      capped: ctx.out.capped,
      cap: ctx.out.cap,
      nFatal: ctx.out.n_fatal,
      fallback: false
    };
    return res;
  }

  async function analyze(resumeText, jdText, industry, context) {
    if (hasPro()) {
      try {
        return analyzePro(resumeText, jdText, industry, context);
      } catch (err) {
        console.warn("[engine] resume_engine 异常，回落到规则引擎", err);
      }
    }
    if (hasRules()) {
      try {
        var res = await global.RuleEngine.analyze(resumeText, jdText, industry, context);
        res._meta = res._meta || {};
        res._meta.engine = "rules";
        res._meta.fallback = true;
        return res;
      } catch (err2) {
        console.warn("[engine] 规则引擎异常，回落到内置样例", err2);
      }
    }
    var fake = await analyzeFake(resumeText, jdText, industry);
    fake._meta.engine = "fake";
    fake._meta.fallback = true;
    return fake;
  }

  async function refine(issue, userInput) {
    // resume_engine 出的疑问自带改写骨架（_rw），优先用它
    if (issue && issue._rw && hasPro() && typeof global.ResumeEngine.refine === "function") {
      try {
        return global.ResumeEngine.refine(issue, userInput);
      } catch (err) {
        console.warn("[engine] resume_engine refine 异常，回落", err);
      }
    }
    if (hasRules() && typeof global.RuleEngine.refine === "function") {
      try {
        return await global.RuleEngine.refine(issue, userInput);
      } catch (err) {
        console.warn("[engine] refine 规则版异常，回落模板", err);
      }
    }
    return refineFake(issue, userInput);
  }

  async function refineFake(issue, userInput) {
    await delay(120);

    var input = userInput && typeof userInput === "object" ? userInput : {};
    var detail = firstText(input.detail, input.background, input.action, input.result, input.text);
    var proof = firstText(input.proof, input.evidence);
    var excerpt = (issue && issue.excerpt) || "这一段经历";

    var rewritten;
    if (detail) {
      var action = trimTail(detail).replace(/^我/, "");
      rewritten = "围绕「" + excerpt + "」，我" + action + "，" +
        (proof
          ? "结果用可核对的口径说明（" + trimTail(proof) + "）。"
          : "并补上一句可量化的结果（如处理量、耗时、错误率）。");
    } else {
      rewritten = "把「" + excerpt + "」改写为「主导 / 负责 + 具体模块 + 动作 + 指标」的句式，" +
        "并在括号里补上基线与测量方式。";
    }

    var advice = proof
      ? "面试时先给结论，再给证据链：打开「" + trimTail(proof) + "」→ 说明数据口径 → 对比基线。遇到追问不要绕回形容词，直接给数字。"
      : "面试时按「背景一句、动作两句、结果一句」讲，结果必须带数字；被追问口径时说明测试条件，不要临场编造。";

    return { rewritten: rewritten, advice: advice };
  }

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

  /* ---------------------------------------------------------
   * 契约校验 —— UI 与自检共用，两个引擎实现都必须过
   * --------------------------------------------------------- */
  function validateResult(result, resumeText) {
    var errors = [];
    var lines = splitLines(resumeText);

    if (!result || typeof result !== "object") {
      return { ok: false, errors: ["返回值不是对象"] };
    }

    if (!Array.isArray(result.issues)) {
      errors.push("issues 不是数组");
    } else {
      if (!result.issues.length) errors.push("issues 为空（演示至少要圈出疑问点）");

      result.issues.forEach(function (issue, i) {
        var at = "issues[" + i + "]";
        if (!issue || typeof issue !== "object") {
          errors.push(at + " 不是对象");
          return;
        }
        if (!Number.isInteger(issue.lineIndex) || issue.lineIndex < 0 || issue.lineIndex >= lines.length) {
          errors.push(at + ".lineIndex 越界或非整数（行数 " + lines.length + "）");
        }
        if (typeof issue.excerpt !== "string" || !issue.excerpt) {
          errors.push(at + ".excerpt 为空");
        } else if (Number.isInteger(issue.lineIndex) && issue.lineIndex >= 0 && issue.lineIndex < lines.length) {
          if (lines[issue.lineIndex].indexOf(issue.excerpt) === -1) {
            errors.push(at + ".excerpt 与该行原文不匹配（" + JSON.stringify(issue.excerpt) + "）");
          }
        }
        if (ISSUE_TYPES.indexOf(issue.type) === -1) {
          errors.push(at + ".type 不在枚举内：" + issue.type);
        }
        if (typeof issue.question !== "string" || !issue.question.trim()) {
          errors.push(at + ".question 为空");
        }
        if (!issue.followUp || typeof issue.followUp !== "object") {
          errors.push(at + ".followUp 缺失");
        } else {
          if (typeof issue.followUp.hint !== "string" || !issue.followUp.hint.trim()) {
            errors.push(at + ".followUp.hint 为空");
          }
          if (["detail", "evidence"].indexOf(issue.followUp.kind) === -1) {
            errors.push(at + ".followUp.kind 必须是 detail | evidence");
          }
        }
      });
    }

    if (result.formatIssues !== undefined) {
      if (!Array.isArray(result.formatIssues)) {
        errors.push("formatIssues 必须是数组");
      } else {
        result.formatIssues.forEach(function (f, i) {
          var at = "formatIssues[" + i + "]";
          if (!f || typeof f !== "object") { errors.push(at + " 不是对象"); return; }
          if (typeof f.label !== "string" || !f.label) errors.push(at + ".label 为空");
          if (typeof f.thought !== "string" || !f.thought) errors.push(at + ".thought 为空");
          if (f.level !== undefined && ["warn", "info"].indexOf(f.level) === -1) {
            errors.push(at + ".level 必须是 warn | info");
          }
        });
      }
    }

    if (typeof result.score !== "number" || result.score < 0 || result.score > 100) {
      errors.push("score 必须是 0~100 的数字");
    }

    if (!Array.isArray(result.jdGaps) || result.jdGaps.some(function (g) { return typeof g !== "string"; })) {
      errors.push("jdGaps 必须是字符串数组");
    }

    if (!Array.isArray(result.suggestions)) {
      errors.push("suggestions 不是数组");
    } else {
      result.suggestions.forEach(function (s, i) {
        var at = "suggestions[" + i + "]";
        if (!s || typeof s !== "object") { errors.push(at + " 不是对象"); return; }
        if (typeof s.original !== "string" || !s.original) errors.push(at + ".original 为空");
        if (typeof s.rewritten !== "string" || !s.rewritten) errors.push(at + ".rewritten 为空");
        if (typeof s.reason !== "string" || !s.reason) errors.push(at + ".reason 为空");
      });
    }

    // 提示性检查：不阻断，仅提示定位风险
    var warnings = [];
    var seen = {};
    (result.issues || []).forEach(function (issue) {
      if (!issue) return;
      var key = issue.lineIndex + "::" + issue.excerpt;
      if (seen[key]) warnings.push("同一行同一片段出现重复疑问：" + key);
      seen[key] = true;
    });

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  function validateRefine(result) {
    var errors = [];
    if (!result || typeof result !== "object") {
      return { ok: false, errors: ["refine 返回值不是对象"] };
    }
    if (typeof result.rewritten !== "string" || !result.rewritten.trim()) {
      errors.push("rewritten 为空");
    }
    if (typeof result.advice !== "string" || !result.advice.trim()) {
      errors.push("advice 为空");
    }
    return { ok: errors.length === 0, errors: errors, warnings: [] };
  }

  /* ---------------------------------------------------------
   * selfTest —— 控制台 / 审阅页按钮共用的一条自检链
   * --------------------------------------------------------- */
  async function selfTest(options) {
    var opts = options || {};
    var resume = opts.resume || FAKE_SAMPLE_RESUME;
    var jd = opts.jd || FAKE_SAMPLE_JD;
    var industry = opts.industry || "互联网-后端";

    var result = await analyze(resume, jd, industry, opts.context || null);
    var check = validateResult(result, resume);

    var first = (result.issues || [])[0];
    var refineInput = {
      detail: "负责订单查询链路的日常开发，独立做了 3 个接口的重构",
      proof: "wrk 压测报告（P99 从 320ms 降到 90ms），GitHub 有脱敏的性能测试脚本"
    };
    var refined = await refine(first, refineInput);
    var refineCheck = validateRefine(refined);

    var report = {
      ok: check.ok && refineCheck.ok,
      resultCheck: check,
      refineCheck: refineCheck,
      result: result,
      refined: refined,
      input: { resume: resume, jd: jd, industry: industry, refineInput: refineInput }
    };

    // 控制台一眼能看懂的摘要
    if (global.console && console.groupCollapsed) {
      console.groupCollapsed("%c[engine] 契约自检 " + (report.ok ? "通过" : "未通过"),
        "color:" + (report.ok ? "#2F6B4F" : "#D64545") + ";font-weight:600");
      console.log("问题数:", (result.issues || []).length, " 分数:", result.score);
      console.table((result.issues || []).map(function (it) {
        return { line: it.lineIndex + 1, type: it.type, excerpt: it.excerpt };
      }));
      if (!report.ok) {
        console.warn("校验错误:", check.errors.concat(refineCheck.errors));
      }
      console.log("refine:", refined);
      console.groupEnd();
    }

    return report;
  }

  /* ---------------------------------------------------------
   * 导出
   * --------------------------------------------------------- */
  var Engine = {
    VERSION: "2.0-resume-engine",
    MODE: "auto",
    ISSUE_TYPES: ISSUE_TYPES,
    ISSUE_TYPE_META: ISSUE_TYPE_META,
    FAKE_SAMPLE_RESUME: FAKE_SAMPLE_RESUME,
    FAKE_SAMPLE_JD: FAKE_SAMPLE_JD,
    analyze: analyze,
    refine: refine,
    mapIndustry: mapIndustry,
    mapJobTitle: mapJobTitle,
    validateResult: validateResult,
    validateRefine: validateRefine,
    selfTest: selfTest,
    helpers: { splitLines: splitLines, locate: locate }
  };

  global.Engine = Engine;
  // 文档约定的裸函数入口，阶段 2/3 的 UI 直接调这两个
  global.analyze = analyze;
  global.refine = refine;

})(window);