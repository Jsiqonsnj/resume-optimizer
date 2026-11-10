/* =========================================================
 * diagnose.js — resume_engine/diagnose.py 的 1:1 移植
 * ---------------------------------------------------------
 * 四层诊断，每层只出最狠的一条。一次给 20 条问题，客户只会
 * 觉得你在挑刺；先打一枪让他信，剩下的等他自己问。
 *
 *   ① 内容无效   有没有一件具体的事、一个数
 *   ② 读不下去   6 秒能不能抓住重点
 *   ③ 对岗不投   JD 覆盖、岗位错位
 *   ④ 面试会挨打 时间线、过度表述、团队成果
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;
  var P = global.RParse;
  var SG = global.RSignals;

  var LAYERS = ["内容无效", "读不下去", "对岗不投", "面试会挨打"];
  var LEVEL_RANK = { "致命": 0, "重要": 1, "次要": 2 };
  var CONTENT_SECTIONS = { "工作经历": 1, "实习经历": 1, "项目经历": 1, "校园经历": 1 };
  var CN_NUM = { "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };

  function finding(layer, level, title, why, fix, evidence, refs) {
    return {
      layer: layer, level: level, title: title, why: why || "", fix: fix || "",
      evidence: evidence || [], refs: refs || [], guard: ""
    };
  }

  function toDict(f) {
    return {
      layer: f.layer, level: f.level, title: f.title, why: f.why, fix: f.fix,
      evidence: f.evidence.slice(0, 4), refs: f.refs.slice(0, 6)
    };
  }

  function pct(x) { return Math.floor(x * 100); }
  function fmtG(x) { return String(Number(x)); }

  /* ---------------- 中文数字 → 数 ---------------- */
  function cn2int(str) {
    var s = String(str).trim();
    if (/^\d+$/.test(s)) return parseFloat(s);
    if (s === "十") return 10;
    if (s.length === 2 && s[0] === "十") return 10 + (CN_NUM[s[1]] || 0);
    if (s.length === 2 && s[1] === "十") return (CN_NUM[s[0]] || 0) * 10;
    if (s.length === 3 && s[1] === "十") return (CN_NUM[s[0]] || 0) * 10 + (CN_NUM[s[2]] || 0);
    if (s.length === 1) return CN_NUM[s] || 0;
    return null;
  }

  var CLAIM_RE1 = new RegExp("([一二两三四五六七八九十\\d]\\s*点?\\s*[一二三四五六七八九]?|十[一二三四五六七八九]?)\\s*年" +
    "(?:以上|多)?\\s*(?:的)?\\s*[\\u4e00-\\u9fa5]{0,6}?(?:经验|工作经历|从业)");
  var CLAIM_RE2 = /([一二两三四五六七八九十\d]{1,3})\s*年(?:以上)?(?:的)?(?:相关)?经验/;

  function claimedYears(text) {
    var m = text.match(CLAIM_RE1) || text.match(CLAIM_RE2);
    if (!m) return null;
    return cn2int(m[1]);
  }

  /* ---------------- 主入口 ---------------- */
  function run(r, s, p, m) {
    var d = {
      findings: [],
      tops: {},
      strengths: [],
      sixSecond: {}
    };
    d.findings = d.findings
      .concat(layerContent(r, s, p))
      .concat(layerRead(r, s, p))
      .concat(layerMatch(r, s, p, m))
      .concat(layerInterview(r, s, p));
    d.strengths = strengths(r, s, p);
    d.sixSecond = sixSecond(r, s, p);

    // 每层取最狠的：致命优先，其次 refs 多（说明是普遍问题）
    LAYERS.forEach(function (name) {
      var fs = d.findings.filter(function (f) { return f.layer === name && !f.guard; });
      if (!fs.length) return;
      fs.sort(function (a, b) {
        return (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]) || (b.refs.length - a.refs.length);
      });
      d.tops[name] = fs[0];
    });
    return d;
  }

  function ofLayer(d, name) {
    return d.findings.filter(function (f) { return f.layer === name; });
  }

  function fatal(d) {
    return d.findings.filter(function (f) { return f.level === "致命" && !f.guard; });
  }

  /* ---------------- ① 内容无效 ---------------- */
  function layerContent(r, s, p) {
    var out = [];
    var content = s.bullets.filter(function (b) { return CONTENT_SECTIONS[b.section]; });
    var n = Math.max(1, content.length);

    if (n >= 2 && s.quantRatio === 0) {
      var pool0 = s.emptyBullets.length ? s.emptyBullets : content;
      out.push(finding("内容无效", "致命",
        "整份简历没有一个能核对的结果",
        "筛选的人只能用两样东西判断你：你做过什么、做到了什么程度。" +
        "只有前者的时候，你和一个「写着差不多话的候选人」没有区别。",
        "每条经历补一个数，按这个顺序找最容易：规模（多少人/多少钱/多少条）→ " +
        "频率（每周几次）→ 占比排名 → 耗时 → 改前改后。",
        pool0.slice(0, 3).map(function (b) { return SG.excerpt(b, 34); }),
        pool0.slice(0, 6).map(function (b) { return b.idx; })));
    } else if (n >= 3 && s.quantRatio < 0.3) {
      out.push(finding("内容无效", "致命",
        "只有 " + pct(s.quantRatio) + "% 的条目带了数，其余还是描述",
        "HR 的停留时间是 6–15 秒，会先扫数字。没数字的行，等于没写。",
        "不用全都改。把最相关的那一段（投的这个岗最看重的那段）先补满三条带数的，其余先放着。",
        s.emptyBullets.slice(0, 3).map(function (b) { return SG.excerpt(b, 34); }),
        s.emptyBullets.slice(0, 6).map(function (b) { return b.idx; })));
    }

    if (s.weakRatio >= 0.5 && n >= 3) {
      out.push(finding("内容无效", "重要",
        pct(s.weakRatio) + "% 的句子是「负责/参与/协助」开头的",
        "这几个动词只说明你在这件事的现场，不说明你做了什么。" +
        "同一个项目，写「参与」和写「主导其中 X 部分」，可信度差一个量级。",
        "换动词，不用编内容：把「负责日常运营」改成「独立负责 XX 模块的 A 和 B 两部分」。",
        s.weakBullets.slice(0, 3).map(function (b) {
          return (b.verb || "开头无动词") + "：" + SG.excerpt(b, 34);
        }),
        s.weakBullets.slice(0, 6).map(function (b) { return b.idx; })));
    }

    if (s.nFakeNum >= 3 && s.quantRatio === 0) {
      out.push(finding("内容无效", "重要",
        "简历里有数字，但都是日期和时间，不是成果",
        "年份日期不构成说服力。真正被看的是「多少、多快、从几到几」。",
        "别把日期当量化。找那些「你处理过多少」的数，哪怕是个量级。",
        ["检出 " + s.nFakeNum + " 处日期/编号类数字"], []));
    }

    // 两年以上：全篇都在"参与/协助/负责部分"，看不出主导过什么
    if (p.expMonths >= 24 && s.weakRatio >= 0.4) {
      var senior = content.filter(function (b) { return b.verbTier >= 5; });
      if (!senior.length) {
        out.push(finding("内容无效", "致命",
          "工作两年以上，但看不出你主导过什么",
          "这个阶段招人，买的是「能独立扛一块」。全篇都是参与、协助、负责部分，" +
          "读下来像一直在给别人的项目打下手 —— 这是很多人的简历卡住的原因，" +
          "不是能力不够，是没把独立性的部分写出来。",
          "挑一件你实际拍过板的事：方案是你定的、还是你执行的？验收标准谁定的？" +
          "哪怕只是个小改动，只要决策是你做的，就用「主导/独立负责/推动」写。",
          s.weakBullets.slice(0, 2).map(function (b) { return SG.excerpt(b, 34); }),
          []));
      }
    }

    // 自述年限与时间线不自洽
    var claim = claimedYears(r.raw);
    if (claim && p.expMonths >= 6) {
      var spanY = p.expMonths / 12;
      if (Math.abs(spanY - claim) >= 1.5) {
        out.push(finding("内容无效", "重要",
          "年限口径不一致：自述「" + fmtG(claim) + " 年」，时间线算出来 " + spanY.toFixed(1) + " 年",
          "两个口径不一致，HR 会优先信时间线，然后怀疑你其他数字也是估的。",
          "统一成一个口径：要么改自述为「" + spanY.toFixed(0) + " 年」，要么把时间线补全（含实习）。",
          ["自述 " + fmtG(claim) + " 年 vs 时间线 " + spanY.toFixed(1) + " 年"], []));
      }
    }

    // 校招专用：课程列表占位
    var edu = P.section(r, "教育背景");
    if (edu && p.kind === "校招") {
      var blob = edu.lines.map(function (x) { return x.t; }).join(" ");
      var nCourse = (blob.match(/(?:课程|主修|修读)[:：]?/g) || []).length;
      var courseCnt = (blob.indexOf("课程") !== -1 && blob.length > 60)
        ? blob.split(/[、,，/]/).length : 0;
      if (nCourse && courseCnt >= 8) {
        out.push(finding("内容无效", "重要",
          "教育背景里堆了一长串课程名",
          "课程名不构成能力证据 —— 同专业的每个人都学过。它占的是首屏最贵的位置。",
          "删到 3 门以内，或者干脆不要；把省下的位置给一个你真做过的项目。",
          [blob.slice(0, 60) + "…"], []));
      }
    }

    // 项目只写技术栈/模块名
    var proj = s.bullets.filter(function (b) { return b.section === "项目经历"; });
    if (proj.length) {
      var TECH_ONLY_RE = /(使用|基于|采用|负责|完成).{0,20}(框架|技术|模块|接口|页面|数据库)/;
      var techOnly = proj.filter(function (b) {
        return !SG.hasQuant(b) && !b.hasResult && TECH_ONLY_RE.test(b.text);
      });
      if (techOnly.length >= 2) {
        out.push(finding("内容无效", "重要",
          "项目写成了「用了什么技术」，不是「解决了什么问题」",
          "技术栈是工具，不是成果。面试官默认你会用，他想知道的是" +
          "「这个东西原来有什么问题、你怎么解决的、效果怎么衡量」。",
          "每条项目改写成：问题 → 你的方案 → 结果（数据/上线/用户量/耗时）。",
          techOnly.slice(0, 3).map(function (b) { return SG.excerpt(b, 34); }),
          techOnly.slice(0, 6).map(function (b) { return b.idx; })));
      }
    }

    return out;
  }

  /* ---------------- ② 读不下去 ---------------- */
  function layerRead(r, s, p) {
    var out = [];
    var ss = sixSecond(r, s, p);

    if (!ss.pass) {
      out.push(finding("读不下去", "致命",
        "扫前 6 秒，看不出你是做什么的、最强的一件事是什么",
        "这不是内容问题，是排序问题。同一个人的同一批经历，换个顺序就能被看见。",
        "首屏只留三样：求职意向、你最相关的一段经历的第一条（带数）、一个能证明的证据。",
        ss.saw, []));
    }

    if (P.has(r, "自我评价")) {
      var se = r.selfEval;
      var vagueInSelf = D.vague_words.filter(function (w) { return se.indexOf(w) !== -1; });
      if (se.length > 80 && vagueInSelf.length >= 3) {
        out.push(finding("读不下去", "重要",
          "自我评价写了 " + se.length + " 字，其中 " + vagueInSelf.length + " 处是形容词",
          "自我评价是最贵的位置，也是最容易被判「空话」的位置。" +
          "「认真负责、沟通能力强」这种句子，换成任何一个求职者都成立。",
          "整段删掉，换成两行有证据的定位：我是谁（几年什么岗）+ 我最硬的证据 + 我要什么岗。",
          [se.slice(0, 70) + "…"], []));
      }
    }

    if (!P.has(r, "求职意向") && !P.has(r, "作品集")) {
      out.push(finding("读不下去", "重要",
        "没有求职意向",
        "没有目标岗，HR 只能猜。猜错一次，这份简历就进了「再看看」的堆。",
        "第一行写清：岗位名 + 一句话定位（例：3 年电商运营，独立带过 2 个天猫店）。", [], []));
    }

    var chars = r.nCharsNoSpace;
    if (p.kind === "校招" && chars > 1400) {
      out.push(finding("读不下去", "重要",
        "约 " + chars + " 字，校招简历一页就够",
        "篇幅超过一页，说明你在填位置，不是在挑重点。",
        "砍掉和目标岗无关的经历，把最相关的一段提到第一屏。", [], []));
    }
    if ((p.kind === "社招3+" || p.kind === "管理") && chars < 700) {
      out.push(finding("读不下去", "重要",
        "约 " + chars + " 字，对 " + p.kind + " 来说内容太薄",
        "这个阶段的人，HR 期待看到盘子和结果；太薄会被判断为「没东西可写」。",
        "补两段：一段是你负责的最大盘子（金额/人数/范围），一段是你解决过的最难的问题。", [], []));
    }

    // 版块顺序：社招三年以上，教育压在工作经历前面
    var names = r.sections.filter(function (x) { return x.name !== "头部"; })
      .map(function (x) { return x.name; });
    if ((p.kind === "社招3+" || p.kind === "管理") &&
        names.indexOf("教育背景") !== -1 && names.indexOf("工作经历") !== -1) {
      if (names.indexOf("教育背景") < names.indexOf("工作经历")) {
        out.push(finding("读不下去", "次要",
          "教育背景排在工作经历前面",
          "三年以上经验，HR 先看你现在在做什么，不是你在哪毕业。",
          "把工作经历提到教育背景之前。", [], []));
      }
    }

    // 信息密度
    var entries = r.entries.filter(function (e) {
      return (e.section === "工作经历" || e.section === "实习经历" || e.section === "项目经历")
        && e.bullets.length;
    });
    if (entries.length) {
      var avg = entries.reduce(function (a, e) { return a + e.bullets.length; }, 0) / entries.length;
      if (avg < 2) {
        out.push(finding("读不下去", "次要",
          "每段经历平均只有 " + avg.toFixed(1) + " 条内容，密度不够",
          "一段经历只写一行，读的人拿不到任何可判断的信息。",
          "每段经历至少 3 条：一条说职责范围，两条说具体动作和结果。", [], []));
      }
    }

    return out;
  }

  /* ---------------- ③ 对岗不投 ---------------- */
  function layerMatch(r, s, p, m) {
    var out = [];

    if (m.hasJD) {
      if (m.coverage < 0.4) {
        out.push(finding("对岗不投", "致命",
          "JD 关键词只对上 " + pct(m.coverage) + "%，这个岗改简历救不回来",
          m.advice,
          "先换岗，再改简历。选和你经历同族的岗，改动量小一半、命中率高得多。",
          ["缺失：" + m.missing.slice(0, 8).map(function (t) { return t.word; }).join("、")], []));
      } else if (m.coverage < 0.6) {
        out.push(finding("对岗不投", "重要",
          "JD 关键词对上 " + pct(m.coverage) + "%，还差一口气",
          "机筛按词命中排优先级，差几个词就排到后面去了。",
          "这些词如果真做过，用原词写进来：" +
          m.missing.slice(0, 8).map(function (t) { return t.word; }).join("、"), [], []));
      }
    } else {
      var kws = D.industry_kw[p.industry] || [];
      var hits = kws.filter(function (k) { return r.raw.indexOf(k) !== -1; });
      if (kws.length && hits.length < 2) {
        out.push(finding("对岗不投", "重要",
          "几乎没有" + p.industry + "行业的特征词",
          "HR 判断「这人是不是同行」靠的就是这些词。缺了会被当成跨行投递。",
          "你如果真的做过，这些词该出现：" + kws.slice(0, 6).join("、"), [], []));
      }
    }

    if (p.mismatch) {
      out.push(finding("对岗不投", "致命",
        p.mismatch.note,
        "内容语言和职位目标错位，HR 会认为你在乱投，或者没想清楚要做什么。",
        "不用删旧经历，要一段翻译。把旧行业的动作换成目标岗能听懂的词" +
        "（续费率→留存率、排课→资源调度、良率→质量管控），再补一句为什么转。", [], []));
    }

    m.hard.forEach(function (h) {
      if (h.ok === false) {
        out.push(finding("对岗不投", "致命",
          "硬门槛不满足：" + h.item,
          h.note || "硬性条件不满足，简历写得再好也过不了。",
          "换一个门槛够得着的岗；或者先补这个条件再投。", [], []));
      } else if (h.ok === null && h.item.indexOf("年限") !== -1) {
        out.push(finding("对岗不投", "次要",
          h.item, h.note, "在求职意向行写明年限。", [], []));
      }
    });

    if (p.targetLevel !== null && p.contentLevel !== null) {
      if (p.targetLevel >= 3 && p.contentLevel <= 2) {
        out.push(finding("对岗不投", "重要",
          "投的是管理岗，内容全是执行动作",
          D.ipo_level_gap_tip.too_high,
          "补三样：带几个人、定过什么标准、为哪个结果负责（金额/指标）。", [], []));
      } else if (p.targetLevel <= 1 && p.contentLevel >= 3) {
        out.push(finding("对岗不投", "次要",
          "投的是执行岗，内容却写了大量管理动作",
          D.ipo_level_gap_tip.too_low,
          "如果确实想降级求职，主动写一句原因，否则 HR 会怀疑你要价或待不住。", [], []));
      }
    }

    return out;
  }

  /* ---------------- ④ 面试会挨打 ---------------- */
  function layerInterview(r, s, p) {
    var out = [];

    if (p.gaps.length) {
      var g = p.gaps.slice().sort(function (a, b) { return b.months - a.months; })[0];
      out.push(finding("面试会挨打", g.months >= 6 ? "致命" : "重要",
        "时间线有 " + g.months + " 个月空窗（" + g.after + " → " + g.before + "），简历里没有解释",
        "空窗本身不是问题，不解释才是。HR 会自己脑补一个最差的原因。",
        "写成一行：这几个月做了什么 + 学到什么 + 现在能干什么。不要写「因个人原因」。",
        [g.after + " → " + g.before + "，间隔 " + g.months + " 个月"], []));
    }

    if (p.shortStints >= 2) {
      out.push(finding("面试会挨打", "重要",
        "有 " + p.shortStints + " 段不满一年的经历",
        "会被读成「待不住」。这个判断一旦形成，后面的内容就不看了。",
        "给一条主线解释（比如都在同一个方向深耕），并把短的那段合并成" +
        "「项目制」或「短期」，不要并列成两条正式履历。", [], []));
    }

    if (s.nOverclaim) {
      var ev = [];
      s.bullets.forEach(function (b) {
        if (b.overclaim.length) ev.push(b.overclaim[0] + "：" + SG.excerpt(b, 34));
      });
      out.push(finding("面试会挨打", "重要",
        "有 " + s.nOverclaim + " 处「精通/各种/所有」这类表述",
        "写得越满，面试越会被追着验。一句「你精通到什么程度」就能把节奏拿走。",
        "改成可验证的：独立完成过几次、处理过多大数据量、拿到过什么结果。",
        ev.slice(0, 3), []));
    }

    if (s.nFirstPerson) {
      out.push(finding("面试会挨打", "次要",
        "出现了第一人称/口语化表达",
        "简历用名词短句，出现「我负责」「老板让我」会显得不专业。",
        "删掉主语，动词开头。", [], []));
    }

    // 团队 vs 个人
    var teamRefs = r.raw.match(/(?:我们|团队|小组)\s*(?:一起|共同|协作)?/g) || [];
    if (teamRefs.length >= 2 && !/(?:我负责|独立负责|主导|牵头|由我)/.test(r.raw)) {
      out.push(finding("面试会挨打", "重要",
        "成果全写成团队的，看不出你个人做了哪一块",
        "面试第一问就是「这里面你负责什么」。答不上来，前面写的都作废。",
        "每条团队成果后面补一句：我负责其中 X 部分，做成了 Y。", [], []));
    }

    return out;
  }

  /* ---------------- 亮点（必须给） ---------------- */
  function strengths(r, s, p) {
    var out = [];
    var content = s.bullets.filter(function (b) { return CONTENT_SECTIONS[b.section]; });
    var best = content.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
    best.forEach(function (b) {
      if (b.score < 55) return;
      var why = [];
      if (b.quant.length) why.push("带了" + b.quant.slice(0, 2).join("/") + "级的数");
      if (b.hasResult) why.push("写出了变化");
      if (b.verbTier >= 4) why.push("用了「" + b.verb + "」这种有所有权的动词");
      out.push({ point: SG.excerpt(b, 60), why: why.join("、") || "信息密度够" });
    });

    if (p.nJobs >= 2 && p.avgTenure >= 24) {
      out.push({
        point: p.nJobs + " 段经历，平均 " + p.avgTenure.toFixed(0) + " 个月",
        why: "稳定性是加分项，很多岗的第一道隐性筛就是这个"
      });
    }
    if (P.has(r, "作品集")) {
      out.push({ point: "有作品集/主页", why: "设计、内容、技术岗有这个，可信度直接上一档" });
    }

    // 兜底：一条都不给，客户只感到被否定。但也不许夸，
    // 只指出「你手上信息量最大的一条」—— 这是事实，不是鼓励。
    if (!out.length && content.length) {
      var bMax = content.slice().sort(function (a, b) { return b.score - a.score; })[0];
      out.push({
        point: SG.excerpt(bMax, 50),
        why: "这是现在信息量最大的一条，改的时候从它开始，性价比最高"
      });
    }
    return out.slice(0, 4);
  }

  /* ---------------- 六秒测试 ---------------- */
  function sixSecond(r, s, p) {
    var head = r.raw.slice(0, 420);
    var saw = [], missing = [];

    if (/(求职意向|目标岗位|应聘)/.test(head)) saw.push("有求职意向");
    else missing.push("求职意向");

    var firstQuant = null;
    for (var i = 0; i < Math.min(6, s.bullets.length); i++) {
      if (SG.hasQuant(s.bullets[i])) { firstQuant = s.bullets[i]; break; }
    }
    if (firstQuant) saw.push("首屏有数：" + SG.excerpt(firstQuant, 24));
    else missing.push("首屏没有可核对的结果");

    if (/(工作经历|实习经历|项目经历)/.test(head)) saw.push("首屏就有经历版块");
    else missing.push("首屏被教育/自评/个人信息占掉");

    if (P.has(r, "自我评价") && r.selfEval && head.indexOf(r.selfEval.slice(0, 60)) !== -1) {
      missing.push("首屏放的是自我评价");
    }

    return { pass: missing.length <= 1, saw: saw, missing: missing };
  }

  global.RDiagnose = {
    LAYERS: LAYERS,
    run: run,
    ofLayer: ofLayer,
    fatal: fatal,
    sixSecond: sixSecond,
    strengths: strengths,
    toDict: toDict,
    claimedYears: claimedYears,
    cn2int: cn2int
  };
})(typeof window !== "undefined" ? window : globalThis);