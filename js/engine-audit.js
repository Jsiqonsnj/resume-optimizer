/* =========================================================
 * engine-audit.js — 七项深审引擎（AuditEngine）
 * ---------------------------------------------------------
 * 和 resume_engine 的分工：
 *   resume_engine 负责「这份简历整体值多少分」，一次只挑最狠的 4 条；
 *   AuditEngine   负责「逐行过堂」，每一行都要回答七件事：
 *     ① 会被问什么（含答法骨架、风险等级）
 *     ② 写得够不够细（对象/动作/方法/规模/结果 五件）
 *     ③ 真不真实（口径、极端词、职级错位、团队成果个人化）
 *     ④ 缺什么（该补但没写的内容）
 *     ⑤ 该删什么（减分项、废话、隐私、重复）
 *     ⑥ 语言清不清晰（行话、形容词、软素质、AI 句式）
 *     ⑦ 逻辑通不通（倒序、重叠、空窗、技能与经历打架）
 *
 * 设计约束（改代码前先读）：
 *   1. 全离线、零依赖、零网络：判断全靠词表 + 结构信号，可解释、可复现；
 *   2. 每条结论都要能指回一行原文，不产出「整体感觉不好」；
 *   3. 只重排事实，不替用户编事实 —— 给的是骨架和要补的要素，不是成稿；
 *   4. 结论按「风险 × 能不能立刻改」排序，不按词表顺序。
 * ========================================================= */

(function (global) {
  "use strict";

  var VERSION = "1.0";
  var D = global.RLData || {};
  var P = global.RParse || null;
  var SG = global.RSignals || null;

  /* =========================================================
   * 0. 小工具
   * ========================================================= */

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function has(t, w) { return String(t).indexOf(w) !== -1; }

  function hitsOf(t, list) {
    var out = [];
    (list || []).forEach(function (w) {
      if (w && String(t).indexOf(w) !== -1) out.push(w);
    });
    return out;
  }

  function uniqArr(a) {
    var seen = {}, out = [];
    a.forEach(function (x) {
      var k = typeof x === "string" ? x : JSON.stringify(x);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(x);
    });
    return out;
  }

  function countNumbers(t) {
    var m = String(t).match(/\d+(?:\.\d+)?/g);
    return m ? m.length : 0;
  }

  function reTest(t, re) { re.lastIndex = 0; return re.test(String(t)); }

  function reCount(t, re) {
    var r = new RegExp(re.source, "g");
    var m = String(t).match(r);
    return m ? m.length : 0;
  }

  function cut(t, n) {
    var s = String(t == null ? "" : t).trim();
    return s.length <= n ? s : s.slice(0, n) + "…";
  }

  function pyRound(x, d) {
    var f = Math.pow(10, d), v = x * f, base = Math.floor(v), diff = v - base, r;
    if (diff > 0.5) r = base + 1;
    else if (diff < 0.5) r = base;
    else r = (base % 2 === 0) ? base : base + 1;
    return r / f;
  }

  /* =========================================================
   * 1. 词表：语言（去 AI 味）与真实性
   * ========================================================= */

  /* 每一条都带「为什么」和「怎么改」，因为只标红不教改等于骂人 */
  var TONE_GROUPS = [
    {
      key: "jargon", name: "行话", weight: 12,
      fix: "行话不是证据。换成：你动了哪个环节、用什么动作、结果数字多少",
      words: ["赋能", "抓手", "闭环", "底层逻辑", "组合拳", "生态位", "拉通", "对齐", "沉淀",
        "中台", "颗粒度", "打法", "心智", "势能", "护城河", "全链路", "端到端", "一站式",
        "体系化", "平台化", "精细化", "数字化", "智能化", "全域", "全场景", "顶层设计",
        "方法论", "价值闭环", "业务闭环", "发力", "聚力", "护航", "加持", "全方位",
        "立体化", "战略性", "前瞻性", "降本增效", "提质增效", "价值最大化", "深度赋能",
        "矩阵化", "生态化", "破局", "升维", "卡位", "业务赋能", "链路", "复用", "串联"]
    },
    {
      key: "praise", name: "自夸形容词", weight: 10,
      fix: "形容词删掉，句子还站得住吗？站不住就补一件具体的事；站得住就说明它本来多余",
      words: ["优秀的", "出色的", "卓越的", "极强的", "丰富的", "扎实的", "良好的", "较强的",
        "优异的", "突出", "显著", "大幅", "完美", "高质量", "一流", "领先", "顶尖",
        "高度重视", "大力", "独当一面", "全面发展", "卓有成效"]
    },
    {
      key: "soft", name: "软素质声明", weight: 12,
      fix: "软素质只能被证明，不能被声明。换成一件别人能复述的事：谁、什么场合、你怎么做的",
      words: ["沟通能力强", "团队协作能力", "抗压能力", "学习能力强", "责任心强", "执行力强",
        "适应能力强", "善于沟通", "吃苦耐劳", "团队精神", "为人正直", "性格开朗",
        "服从安排", "有较强的", "能够承受", "认真负责", "勤奋"]
    },
    {
      key: "filler", name: "填充词", weight: 6,
      fix: "删掉不影响意思的词就别留。简历每一行都要付出阅读成本",
      words: ["相关的", "各类", "各项", "一些", "一定的", "比较", "非常", "十分", "主要是",
        "基本上", "大概", "左右", "以及", "并且", "同时", "进行", "开展", "做好",
        "搞好", "进一步", "不断", "持续", "有效", "全面", "深入", "系统性地"]
    },
    {
      key: "chinglish", name: "中英夹杂", weight: 6,
      fix: "中文里夹英文不显得专业，除非它是行业固定术语（KPI/ROI/OKR 这类可以留）",
      words: ["owner", "align", "leverage", "sync 一下", "follow up", "push", "deck",
        "loop", "落地 owner", "drive", "call 一下"]
    },
    {
      key: "gm", name: "AI 高频套话", weight: 8,
      fix: "这些是模型写简历时最喜欢塞的词，真人一般不会这么说。删掉后句子的信息量不变",
      words: ["多维度", "全维度", "长效机制", "能力建设", "生态构建",
        "高质量发展", "充分发挥", "深度参与", "精细化运营", "常态化", "规模化",
        "数据驱动", "深度分析", "全面赋能", "闭环管理", "日益", "日趋"]
    }
  ];

  /* AI 腔的句式指纹：不是词，是结构 */
  var TONE_PATTERNS = [
    { re: /不仅[^。；]{0,24}(而且|还|也)/, name: "不仅…而且…", weight: 8,
      fix: "『不仅…而且』是模板腔。直接说第二件事，那件才是重点" },
    { re: /通过[^。；]{0,20}(实现|达到|完成|提升|降低|优化)/, name: "通过…实现…", weight: 8,
      fix: "把因和果都写虚了。换成具体工具/动作 + 一个数字" },
    { re: /在[^。；]{0,16}过程中/, name: "在…过程中", weight: 6,
      fix: "纯填充，删掉后句子更硬" },
    { re: /围绕[^。；]{0,16}(展开|进行|推进)/, name: "围绕…展开", weight: 6,
      fix: "直接说你做了什么动作" },
    { re: /以[^。；]{0,12}为核心/, name: "以…为核心", weight: 6,
      fix: "『核心』是谁定的？删掉，写清你实际负责的模块" },
    { re: /致力于|旨在|力求|着眼于/, name: "口号式动词", weight: 8,
      fix: "『致力于』是公司口号，不是你的动作。换成搭建/上线/交付/谈成" },
    { re: /打造|助力|驱动|重塑|引领|构筑|焕新|牵引/, name: "动词虚化", weight: 8,
      fix: "虚动词换成实动词：搭了什么、上线了什么、谈成了什么" },
    { re: /为[^。；]{0,12}创造价值|创造[^。；]{0,6}价值/, name: "价值口号", weight: 8,
      fix: "『创造价值』不是结果。结果要有数或有一件可核对的事" },
    { re: /(提升|增强|改善)了[^。；]{0,10}(能力|水平|意识)/, name: "能力化收尾", weight: 8,
      fix: "『提升了…能力』看不出结果，换成业务指标或交付物" },
    { re: /对[^。；]{0,12}进行了[^。；]{0,10}(优化|升级|改进|梳理|调整)/, name: "对…进行了…", weight: 8,
      fix: "动作被藏进名词里。改成：改了什么 → 改前多少 → 改后多少" },
    { re: /实现了[^。；]{0,12}的(提升|增长|转变|突破)/, name: "实现了…的提升", weight: 8,
      fix: "同上：谁测的、从多少到多少" },
    { re: /是[^。；]{0,10}的重要(一环|组成部分|环节)/, name: "重要性宣称", weight: 8,
      fix: "这句在说岗位重要，不是在说你做成了什么" },
    { re: /(极大|有效|显著|充分)地/, name: "副词修饰结果", weight: 6,
      fix: "『极大地』后面通常跟着一个没有数字的结果" }
  ];

  /* 三连同构：「高效、稳定、可靠」这类并列是 AI 写作的指纹 */
  var TRIPLE_RE = /([\u4e00-\u9fa5A-Za-z0-9]{2,6})[、,，]\s*([\u4e00-\u9fa5A-Za-z0-9]{2,6})[、,，]\s*([\u4e00-\u9fa5A-Za-z0-9]{2,6})/;

  var EMOJI_RE = /[\uD83C-\uD83E][\uDC00-\uDFFF]/;
  var LOUD_RE = /[！]{1,}|[!]{2,}/;
  var PUNCT_NOISE_RE = /[～~★☆✔✅●◆▪※]/;

  /* =========================================================
   * 2. 真实性风险表
   * ========================================================= */

  var TRUTH_RULES = [
    {
      id: "pct-no-base", level: 3, name: "百分比没有基线",
      re: /(提升|提高|增长|降低|下降|优化|减少|缩短|节省)[^。；，]{0,8}?\d{1,4}(?:\.\d+)?\s*%/,
      notRe: /(从|由)\s*\d/,
      why: "只给了终点没给起点。面试官第一句一定是「从多少到多少」",
      fix: "写成「从 A 到 B（周期、口径）」，A/B 都要是真实测过的数"
    },
    {
      id: "round-percent", level: 2, name: "整数太整",
      re: /(提升|提高|增长|降低|下降|优化|减少)\s*(100|200|300|500)\s*%/,
      why: "整百的百分比最像是估出来的，中小项目上尤其可疑",
      fix: "换成绝对值（省了多少工时/多少钱/多少单），或者写出真实的两位小数"
    },
    {
      id: "times", level: 2, name: "倍数说法",
      re: /\d+\s*倍/,
      why: "「3 倍」必须能说出分母、口径、测量方式，否则就是形容词",
      fix: "换成分子分母都写清楚的比值，或改成绝对值"
    },
    {
      id: "absolute", level: 3, name: "极端词",
      re: /100\s*%|零失误|零故障|零投诉|毫无差错|全部达成|全部完成|无一例外|首次|唯一|行业第一|国内领先|世界级|史无前例|空前|顶尖水平/,
      why: "绝对化表述把举证责任全揽到自己身上，答不上来就是撒谎",
      fix: "留 80% 的余地：「覆盖 3 个业务线中的 2 个」比「全部」更可信"
    },
    {
      id: "zero2one", level: 2, name: "从 0 到 1 / 独立完成",
      re: /从\s*0\s*到\s*1|从零到一|独立完成|一手搭建|全权负责|一个人完成/,
      why: "这类词最容易在追问里塌：谁给的需求、谁配合、现在还在跑吗",
      fix: "改成可核对的版本：「从需求提出到上线共 6 周，前端由 1 名同事配合」"
    },
    {
      id: "master", level: 2, name: "精通",
      re: /精通|专家级|大师|出神入化/,
      why: "『精通』是面试官最爱拆的词，通常会被要求现场讲实现细节",
      fix: "降级成「能用 X 做 Y」并给一个场景，比『精通』有力得多"
    },
    {
      id: "level", level: 3, name: "职级与年限不匹配",
      re: /总监|首席|合伙人|创始人|副总裁|VP|CEO|CTO/,
      why: "职级口径会被背调核对，写高了是硬伤，不是加分",
      fix: "按真实 title 写；如果确实负责了管理，写「带 N 人小组」而不是自封职级"
    },
    {
      id: "team-claim", level: 2, name: "团队成果个人化",
      re: /(我们|团队|协同|配合|参与)[^。；]{0,12}(主导|统筹|全权|独立|牵头)|(主导|统筹|全权|独立|牵头)[^。；]{0,12}(我们|团队)/,
      why: "同一句里既说团队又说我主导，口径必须切开，否则面试一问就露",
      fix: "一句话切分：我独立做 A、B，C 是对接；结果数字归谁写清楚"
    },
    {
      id: "skill-flat", level: 1, name: "技能罗列无分层",
      re: /(熟练|精通|掌握|了解|熟悉)[^。；]{0,40}(、|，)[^。；]{0,20}(、|，)/,
      why: "一串并列等于没有重点，HR 记不住你到底会什么",
      fix: "分三层各写一句场景：能独立交付的 / 用过的 / 只了解的"
    },
    {
      id: "award", level: 1, name: "奖项无出处",
      re: /荣获|获得[^。；]{0,10}(奖|称号|荣誉)/,
      why: "奖项不给评选范围和年份，等于没说",
      fix: "补：颁发方 + 年份 + 范围（如「XX 协会 2023 年，全省 40 人」）"
    },
    {
      id: "vanity-metric", level: 1, name: "不可验证的软指标",
      re: /满意度|好评率|认可度|口碑|评价很高/,
      why: "这类指标没有样本量和调查方式，问了就答不上",
      fix: "补样本（N 份问卷）+ 调查方式 + 时间，或换成可核对的行为指标"
    },
    {
      id: "shortcut", level: 1, name: "时间与成果不匹配",
      re: /仅用\s*\d|只花了\s*\d|一个月内/,
      why: "时间压得越短，结果越会被反复核；要么真有本事，要么会被当成虚的",
      fix: "把周期和投入写实：几个人、多少工时、砍掉了哪些环节"
    }
  ];

  /* =========================================================
   * 3. 要素词表（判断「写得够不够细」）
   * ========================================================= */

  var OBJ_WORDS = ["系统", "模块", "页面", "活动", "项目", "客户", "门店", "社群", "店铺",
    "产品", "功能", "接口", "流程", "报表", "账号", "选题", "课件", "设备", "合同",
    "工地", "病房", "订单", "库存", "渠道", "供应商", "招聘", "预算", "方案", "接口",
    "小程序", "后台", "看板", "模型", "课程", "视频", "海报", "文案", "标书", "明细账"];

  var METHOD_WORDS = ["通过", "使用", "采用", "基于", "用", "搭建", "设计", "脚本", "自动化",
    "神策", "埋点", "A/B", "灰度", "压测", "看板", "SOP", "模板", "复盘会", "工作流",
    "爬虫", "BI", "Figma", "Axure", "PS", "PR", "ERP", "CRM", "OA", "钉钉", "飞书",
    "周会", "清单", "漏斗", "归因", "分层", "标签", "话术", "培训", "巡店", "拜访",
    "谈判", "投标", "招标", "问卷", "访谈", "竞品", "拆解", "排期", "甘特图", "对账",
    "抽检", "校准", "实验", "Excel", "SQL", "Python", "Tableau", "PowerBI", "Power Query",
    "透视表", "函数", "VLOOKUP", "透视", "Word", "PPT"];

  /* 具名工具/系统才能问「为什么用它」；「用」「通过」这种虚词问了是废话 */
  var TOOL_WORDS = ["Excel", "SQL", "Python", "R", "Tableau", "PowerBI", "Power Query",
    "神策", "GA", "GA4", "埋点", "A/B", "Kibana", "Grafana", "Figma", "Axure", "Sketch",
    "PS", "PR", "AI", "Canva", "剪映", "ERP", "CRM", "OA", "钉钉", "飞书", "企业微信",
    "SOP", "看板", "爬虫", "BI", "Power BI", "Jira", "Confluence", "Git", "Postman"];

  var RESULT_WORDS = ["上线", "交付", "发布", "验收", "通过", "达成", "完成", "覆盖",
    "结转", "落库", "签约", "成交", "回款", "复购", "留存", "转介绍", "转正", "晋升",
    "评优", "获奖", "结项", "投产", "试产", "量产", "出报告"];

  var SCALE_RE = /\d+(?:\.\d+)?\s*(?:%|万|亿|人|个|条|次|家|单|天|小时|元|倍|台|套|份|篇|场|名|位)/;

  var HARD_TEAM_RE = /(\d+)\s*(?:人|名|位)(?:团队|小组|下属|组员)?|带\s*\d+|管理\s*\d+|汇报给/;

  /* 「该删」的通用规则：整份文档级 */
  var CUT_DOC_RULES = [
    {
      id: "privacy", name: "隐私与减分项",
      re: /(身份证|婚育|已婚|未婚|政治面貌|党员|团员|籍贯|身高|体重|民族|出生日期|血型|户口)/,
      why: "这些信息对应聘没有帮助，只在少数场景（国企/事业单位）里才需要，且会增加信息泄露面",
      fix: "删掉；岗位明确要求时再单独提供"
    },
    {
      id: "salary", name: "薪资与离职原因",
      re: /(期望薪资|薪资要求|目前薪资|离职原因|最低薪资)/,
      why: "写进简历等于把谈判筹码先交出去，也容易被 HR 直接按上限筛掉",
      fix: "删掉，留到面试最后一轮口头谈"
    },
    {
      id: "selfpraise", name: "自我评价整段",
      re: /(自我评价|个人评价|自我描述)[:：]?/,
      why: "自我评价九成是同义词堆叠，删掉不损失任何信息，还能腾出半屏",
      fix: "删掉整段；把其中最有底气的一条换成「核心优势」，每条配一个证据"
    },
    {
      id: "hobby", name: "兴趣爱好",
      re: /(兴趣爱好|爱好)[:：]/,
      why: "除非爱好与岗位直接相关（如应聘体育记者写马拉松），否则是纯占位",
      fix: "删掉；如果相关，改成一行带成果的版本"
    },
    {
      id: "low-skill", name: "低阶技能占位",
      re: /(熟练(使用)?(Word|Excel|PPT|Office|办公软件)|会(Word|Excel|PPT))/,
      why: "办公软件是默认技能，写出来反而降低整体水位",
      fix: "删掉，除非岗位明确要求（如行政岗可写 Excel 函数/透视表的具体能力）"
    },
    {
      id: "course-list", name: "课程流水",
      re: /(主修课程|课程[:：]|核心课程)/,
      why: "课程列表几乎不会被读，占地方",
      fix: "删掉；改写成「用某门课的方法做过什么」"
    },
    {
      id: "slogan", name: "座右铭/口号",
      re: /(座右铭|格言|人生信条|我坚信)/,
      why: "简历不是价值观展示页",
      fix: "删掉"
    },
    {
      id: "duty-dump", name: "职责流水账",
      re: /(完成领导交办|领导安排的其[他它]|其他日常事务|服从工作安排)/,
      why: "这句话在告诉 HR「我做的事说不清」，而且确实没有信息量",
      fix: "删掉，把真正占时间的那件事写出来"
    },
    {
      id: "resume-title", name: "“个人简历”标题",
      re: /^(个人简历|简历|RESUME|Resume)$/,
      why: "文件名和标题都在告诉对方这是简历，这行是纯浪费",
      fix: "删掉，标题位置留给「姓名 + 目标岗位」"
    }
  ];

  /* =========================================================
   * 4. 行分类
   * ========================================================= */

  var BULLET_RE = /^([•·*\-—–▪●○◆◇]|\d+[.、)])\s*/;
  var PHONE_RE = /1[3-9]\d{9}/;
  var MAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

  function isSectionHeading(t) {
    if (!t || t.length > 16) return "";
    if (/\d{4}/.test(t)) return "";
    var pats = D.section_patterns || [];
    for (var i = 0; i < pats.length; i++) {
      if (new RegExp(pats[i][1]).test(t)) return pats[i][0];
    }
    return "";
  }

  function looksLikeEntryHead(t) {
    return /^[\s•·*\-—]*((?:19|20)\d{2})/.test(t);
  }

  function classifyLines(lines, r) {
    var secOfLine = {}, entryOfLine = {};
    (r.sections || []).forEach(function (s) {
      (s.lines || []).forEach(function (l) { secOfLine[l.line] = s.name; });
    });
    (r.entries || []).forEach(function (e) {
      if (typeof e.line === "number") entryOfLine[e.line] = e;
    });

    var out = [];
    lines.forEach(function (raw, i) {
      var t = String(raw).trim();
      if (!t) return;
      var heading = isSectionHeading(t);
      var section = heading || secOfLine[i] || "";
      var kind;
      if (heading) kind = "heading";
      else if (entryOfLine[i]) kind = "entry";
      else if (/^(求职意向|应聘岗位|目标岗位|意向岗位)/.test(t) || section === "求职意向") kind = "intent";
      else if (section === "技能证书" || /^(技能|专业技能|技能证书|证书|资格证书|语言能力)/.test(t) || has(t, "技能证书")) kind = "skill";
      else if (section === "自我评价" || /^(自我评价|个人评价|自我介绍|自我描述)/.test(t) || has(t, "自我评价：")) kind = "selfeval";
      else if (PHONE_RE.test(t) || MAIL_RE.test(t) || (t.indexOf("|") !== -1 && i <= 2)) kind = "contact";
      else if (BULLET_RE.test(t)) kind = "bullet";
      else kind = "body";

      if (!section) section = (kind === "contact" ? "头部" : "其他");

      out.push({
        line: i,
        text: t,
        kind: kind,
        section: section,
        entry: entryOfLine[i] || null
      });
    });
    return out;
  }

  /* 同一行可能被解析成多条 bullet（按句号切过），这里按行聚合信号 */
  function bulletsByLine(sig) {
    var map = {};
    (sig.bullets || []).forEach(function (b) {
      if (!map[b.line]) map[b.line] = [];
      map[b.line].push(b);
    });
    return map;
  }

  function rowSignals(lineInfo, byLine) {
    var list = byLine[lineInfo.line] || [];
    if (list.length) {
      /* 取最长的那条作为主判断，其余只用于补充数字 */
      var main = list.slice().sort(function (a, b) { return b.text.length - a.text.length; })[0];
      var extra = list.filter(function (b) { return b !== main; });
      var merged = {
        text: lineInfo.text, line: lineInfo.line, section: lineInfo.section,
        verbTier: main.verbTier, verb: main.verb, quant: main.quant.slice(),
        resultWords: main.resultWords.slice(), hasResult: main.hasResult,
        vague: main.vague.slice(), overclaim: main.overclaim.slice(),
        firstPerson: main.firstPerson.slice()
      };
      extra.forEach(function (b) {
        b.quant.forEach(function (q) { if (merged.quant.indexOf(q) === -1) merged.quant.push(q); });
        b.resultWords.forEach(function (q) { if (merged.resultWords.indexOf(q) === -1) merged.resultWords.push(q); });
        b.vague.forEach(function (q) { if (merged.vague.indexOf(q) === -1) merged.vague.push(q); });
        b.overclaim.forEach(function (q) { if (merged.overclaim.indexOf(q) === -1) merged.overclaim.push(q); });
        merged.hasResult = merged.hasResult || b.hasResult;
      });
      return merged;
    }
    /* 没被解析成 bullet 的行（技能/自评/抬头）也走一遍信号，省得两套逻辑 */
    if (SG && typeof SG.analyzeBullet === "function") {
      return SG.analyzeBullet({ text: lineInfo.text, section: lineInfo.section || "其他", line: lineInfo.line });
    }
    return {
      text: lineInfo.text, line: lineInfo.line, section: lineInfo.section,
      verbTier: 0, verb: "", quant: [], resultWords: [], hasResult: false,
      vague: [], overclaim: [], firstPerson: []
    };
  }

  /* =========================================================
   * 5. ① 会被问什么
   * ========================================================= */

  var SKELETON = {
    data: "先说口径（分母/统计周期/谁统计的）→ 再说你在其中负责哪一段 → 最后说如果重做会改什么",
    duty: "一句话切分：我独立做 A、B，C 是对接 → 举一个我独立决策的例子 → 说结果归谁",
    result: "上线多久、跑出什么数、谁验收 → 出过什么问题、怎么补的",
    tech: "为什么选它（对比过什么）→ 用它踩过的一个坑 → 现在会怎么改",
    timeline: "这几个月做了什么（具体）+ 学到什么（可验证）+ 现在能干什么",
    stable: "往「我要去哪」说，一句话说完，不铺开",
    motive: "一件具体的事让你想转 + 已经准备了什么 + 旧经验哪部分直接能用",
    manage: "几个人、怎么分工、有没有开过人、下属怎么评价你",
    coop: "最难搞的一次冲突：对方要什么、你要什么、最后怎么定的",
    truth: "降级到可验证的事实：做过几次、多大规模、谁能证明。不硬撑",
    basic: "背景一句、动作两句、结果一句，结果必须有数"
  };

  function quantToken(t) {
    var m = String(t).match(/\d+(?:\.\d+)?\s*(?:%|万|亿|人|个|条|次|家|单|天|小时|元|倍|台|套|份|场|名|位)/g);
    return m && m.length ? m[0].trim() : "";
  }

  function asksForRow(row, ctx) {
    var s = row.sig, t = row.text, out = [];
    var isContent = row.section === "工作经历" || row.section === "实习经历" || row.section === "项目经历";

    function push(kind, risk, q, sk) {
      if (!q) return;
      out.push({ kind: kind, risk: risk, question: q, skeleton: sk || SKELETON.basic });
    }

    if (row.kind === "contact") {
      push("到岗", 1, "现在是在职还是已离职？最快什么时候能到岗？", "在职就说交接期，离职就说可立即到岗；不要给一个含糊的「随时」");
    }

    if (row.kind === "intent") {
      push("动机", 2, "为什么想做「" + cut(t.replace(/^[^:：]*[:：]/, ""), 18) + "」这个方向？", SKELETON.motive);
      if (ctx && ctx.p && ctx.p.mismatch) {
        push("动机", 3, "你现在做的是「" + ctx.p.mismatch.content + "」，为什么投「" + ctx.p.mismatch.target + "」？", SKELETON.motive);
      }
      if (ctx && ctx.p && ctx.p.expMonths >= 12) {
        push("职级", 2, ctx.p.kind === "社招3+" ? "以你的年限，投这个岗是平级还是升一级？为什么？" : "投这个岗，你的期望职级和上一家比是升还是平？",
          "先说上一家的实际责任半径，再说这个岗能给你什么增量");
      }
    }

    if (row.kind === "entry" && row.entry) {
      var e = row.entry;
      if (row.section === "教育背景") {
        push("学历", 1, "这段学历和岗位的相关性怎么讲？哪门课或毕设能对上？",
          "挑一门和工作直接相关的课 → 说你用它做过什么 → 不要背课程名清单");
      } else {
        push("必问", 2, "这段（" + cut((e.title || e.org || e.head || "").replace(/^\S+\s*/, ""), 16) +
          "）你具体负责什么？最大的难点是什么？",
          "先一句话说职责边界，再讲一个只有你能讲清的难点，最后给结果");
        var mths = P && P.months ? P.months(e) : 0;
        if (mths > 0 && mths < 12 && e.section !== "项目经历") {
          push("稳定", 2, "这段只有 " + mths + " 个月，为什么这么短？", SKELETON.stable);
        }
        if (e.section === "项目经历" && !/负责|主导|成员|独立|owner/i.test(e.head || "")) {
          push("角色", 2, "这个项目里你是什么角色？团队几个人？你负责哪一块？",
            "先定角色（负责人/核心成员/配合），再说你独立决策的那一件事");
        }
        if (ctx && ctx.p && ctx.p.kind === "管理") {
          push("管理", 3, "你带几个人？怎么分工？团队里最难管的人你怎么处理？", SKELETON.manage);
        }
      }
    }

    if (row.kind === "skill") {
      var master = has(t, "精通");
      push("技能", master ? 3 : 2, "这几项里你最熟的是哪个？给我一个你用它解决具体问题的场景",
        "挑一项 + 一个场景（什么业务问题 → 你用它做了什么 → 结果），说细节不说结论");
      if (master) {
        push("技能", 3, "你写了「精通」，那说说它的实现原理 / 你在什么场景下被它坑过", "只在你真踩过坑的那一项上回答，其余主动降级为「熟练使用」");
      }
      if (/\b(Excel|SQL)\b/i.test(t)) {
        push("技能", 2, "SQL 你最常写的是哪类查询？窗口函数用过吗？Excel 你用过透视表和 Power Query 吗？", "按「日常写什么 → 复杂的一次是什么 → 结果怎么用」回答");
      }
    }

    if (row.kind === "selfeval") {
      push("软素质", 2, "你写「" + (has(t, "沟通") ? "沟通能力强" : "能承受压力") + "」，举一个具体例子？", "一个场景 + 对方是谁 + 你怎么做的 + 结果，不要讲性格");
    }

    if (row.kind === "body" && /(优势|亮点|擅长|核心竞争力)/.test(t)) {
      push("价值", 2, "这条「优势」里，哪一句是别人复制不走的？凭什么是你？", "选一条 → 给一个只有你有的证据（数据/项目/作品），其余删掉");
    }

    if (row.kind === "body" && /(奖|荣誉|证书|CET|雅思|托福|资格|分数)/.test(t)) {
      push("证书", 1, "这个证书/奖项是怎么拿到的？评选范围多大？", "给范围（多少人/什么级别）+ 时间 + 它和岗位的关系");
    }

    if (isContent) {
      /* 数据类：有数字必问口径，问法按数字类型换（问责标签要贴合真实追问现场） */
      if (s.quant.length) {
        var tok = quantToken(t) || "这个数";
        if (s.quant.indexOf("占比") !== -1) {
          push("数据", 3, "「" + tok + "」的分母是什么？谁定的口径？", SKELETON.data);
        } else if (s.quant.indexOf("对比") !== -1) {
          push("数据", 3, "改之前的数据是谁给的？和改之后是同一个口径吗？", SKELETON.data);
        } else if (s.quant.indexOf("时间") !== -1) {
          push("数据", 2, "把周期压到「" + tok + "」，中间砍掉了哪些环节？", SKELETON.data);
        } else if (s.quant.indexOf("频率") !== -1) {
          push("数据", 2, "「" + tok + "」是常态还是某个高峰期？", SKELETON.data);
        } else {
          push("数据", 2, "「" + tok + "」这个盘子一共多大（人 / 单量 / GMV）？数从哪拿的？", SKELETON.data);
        }
      }
      /* 职责类 */
      if (s.verbTier >= 4) {
        push("职责", 2, "这件事里哪部分是你独立决策的？团队几个人，你怎么分工？", SKELETON.duty);
      } else if (s.verb === "负责" || s.verb === "参与" || s.verb === "协助" || s.verb === "配合") {
        push("职责", 3, "「" + s.verb + "」具体到哪一步？没有你会有什么不同？", SKELETON.duty);
      }
      /* 结果类 */
      if (s.hasResult || /上线|交付|发布|验收|结项/.test(t)) {
        push("结果", 2, "上线/交付之后跑了多久？出过什么问题？谁验收的？", SKELETON.result);
      }
      /* 工具类：只问具名工具，问「为什么用『用』」是废话 */
      var tools = hitsOf(t, TOOL_WORDS);
      if (tools.length) {
        push("工具", 2, "为什么用「" + tools[0] + "」？和替代方案比过吗？踩过什么坑？", SKELETON.tech);
      }
      /* 极端表述 */
      if (/从\s*0\s*到\s*1|从零到一|首次|唯一|独立完成|一手搭建|全权/.test(t)) {
        push("真实性", 3, "为什么是你来做这件事？之前没人做过吗？它现在的状态是什么？", SKELETON.truth);
      }
      /* 协作类 */
      if (/客户|供应商|跨部门|对接|协调|外部|甲方|乙方/.test(t)) {
        push("协作", 2, "最难搞的一次协作冲突是怎么处理的？", SKELETON.coop);
      }
      /* 钱相关 */
      if (/成本|预算|费用|省|降本|毛利|回款|营收/.test(t)) {
        push("财务", 2, "省下/多赚的这笔钱怎么算的？谁认这个数？", "给公式：单价 × 数量 × 周期，再说谁复核过");
      }
      /* 管理 */
      if (/团队|带人|下属|组员|管理\s*\d+/.test(t)) {
        push("管理", 3, "你带的人里，最差的那个你怎么处理的？", SKELETON.manage);
      }
      /* 没有数字的内容行：一定要问「结果是什么」 */
      if (!s.quant.length && !s.hasResult) {
        push("结果", 2, "这件事最后的结果是什么？做成了会怎样、没做会怎样？", SKELETON.result);
      }
    }

    /* 保底：前面所有规则都没命中时，每一行仍要有一条「为什么留着它」 —— 这正是「能不能删」的入口 */
    if (!out.length) {
      push("留存", 1, "这一行证明的是哪件事？删掉会损失什么？", "说不出它证明什么，就该删；说得出来，就把它写具体");
    }

    /* 去重 + 限量：一行最多 3 问，风险高的排前面 */
    var seen = {}, out2 = [];
    out.forEach(function (a) {
      var k = a.kind + a.question.slice(0, 16);
      if (seen[k]) return;
      seen[k] = 1;
      out2.push(a);
    });
    out2.sort(function (a, b) { return b.risk - a.risk; });
    return out2.slice(0, 3);
  }

  /* =========================================================
   * 6. ② 写得够不够细
   * ========================================================= */

  function detailOf(row, ctx) {
    var t = row.text, s = row.sig, len = t.length;
    var isContent = row.section === "工作经历" || row.section === "实习经历" ||
      row.section === "项目经历" || row.section === "校园经历";

    /* 抬头、技能清单、自我评价各自有各自的判法：抬头看「这段有没有内容」，
       清单看分层与取舍，自评看要不要整段删。都不该套「五要素」 */
    if (row.kind !== "bullet") {
      var neutral = { verdict: "清单", score: 70, len: len, got: {}, missing: [], methods: [], note: "" };
      if (row.kind === "entry") {
        neutral.verdict = "抬头";
        neutral.note = "抬头行不评详细度，看的是下面有几条内容、每条够不够具体。";
      } else if (row.kind === "skill") {
        neutral.note = "技能区看的是分层和场景，不是五要素。";
      } else if (row.kind === "selfeval") {
        neutral.verdict = "自评";
        neutral.note = "自评看的是「有没有证据」，通常整段删掉更划算。";
      } else if (row.kind === "contact" || row.kind === "intent") {
        neutral.note = "抬头信息，不评详细度。";
      }
      return neutral;
    }

    var hasObj = hitsOf(t, OBJ_WORDS).length > 0 || /[A-Za-z]{3,}/.test(t) || /（[^）]{2,12}）/.test(t);
    var hasAction = (s.verbTier || 0) >= 3;
    var methodWords = hitsOf(t, METHOD_WORDS);
    var hasMethod = methodWords.length > 0 || /通过|采用|基于/.test(t);
    var hasScale = SCALE_RE.test(t) || s.quant.indexOf("规模") !== -1 || s.quant.indexOf("频率") !== -1;
    var hasRes = s.hasResult || hitsOf(t, RESULT_WORDS).length > 0 ||
      s.quant.indexOf("占比") !== -1 || s.quant.indexOf("对比") !== -1 || s.quant.indexOf("时间") !== -1;

    var got = { 对象: hasObj, 动作: hasAction, 方法: hasMethod, 规模: hasScale, 结果: hasRes };
    var missing = Object.keys(got).filter(function (k) { return !got[k]; });

    var verdict = "合适";
    if (!isContent) verdict = "清单";
    else if (len < 14) verdict = "太薄";
    else if (len > 90) verdict = "太长";
    else if (missing.length >= 3) verdict = "太空";
    else if (missing.length >= 1) verdict = "偏薄";

    var score = Object.keys(got).filter(function (k) { return got[k]; }).length * 20;
    if (len > 90) score -= 15;
    if (len < 14) score = Math.min(score, 40);
    score = clamp(score, 0, 100);

    var note = DETAIL_NOTE[verdict] || "";
    if (verdict === "偏薄" || verdict === "太空") {
      note += " 缺：" + missing.join("、") + "。";
    }

    return {
      verdict: verdict, score: score, len: len, got: got, missing: missing,
      note: note,
      methods: methodWords.slice(0, 3)
    };
  }

  var DETAIL_NOTE = {
    "太薄": "这条不到 14 个字，信息量约等于一个标签。HR 读完不知道你做了什么。",
    "太空": "五个要素里缺三个以上。这条现在只能说明「你在场」，不能说明「你做成了什么」。",
    "偏薄": "骨架缺了一块 —— 面试官会正好问缺的那块。",
    "太长": "超过 90 字，HR 会跳过。一条只讲一件事，剩下的拆成第二条。",
    "合适": "对象、动作、方法、规模、结果基本齐了，读起来能复述。",
    "清单": "这是清单行，不适用「过程描述」的写法；要改的是分层与取舍。"
  };

  function detailExample(row, ctx) {
    var fam = (ctx && ctx.p && ctx.p.family) || "通用";
    var sk = (D.rewrite_skeletons || {})[fam] || (D.rewrite_skeletons || {})["通用"] || [];
    if (!sk.length) return "";
    var pick = sk[row.__i % sk.length];
    return pick ? pick.sk : "";
  }

  /* =========================================================
   * 7. ③ 真不真实
   * ========================================================= */

  function truthOf(row, ctx) {
    var t = row.text, s = row.sig, risks = [];

    TRUTH_RULES.forEach(function (rule) {
      if (rule.notRe && rule.notRe.test(t)) return;
      if (!rule.re.test(t)) return;
      if (rule.id === "level" && ctx && ctx.p && ctx.p.expMonths >= 96) return;
      if (rule.id === "level" && ctx && ctx.p && ctx.p.kind === "管理") return;
      if (rule.id === "team-claim" && !/(主导|统筹|全权|独立|牵头)/.test(t)) return;
      if (rule.id === "skill-flat" && row.kind !== "skill" && !/技能|熟练|精通/.test(t)) return;
      if (rule.id === "award" && row.kind === "body" && !/奖|荣誉/.test(t)) return;
      risks.push({ level: rule.level, name: rule.name, why: rule.why, fix: rule.fix });
    });

    /* 数字密度：一行四个以上数字，像编的 */
    if (countNumbers(t) >= 4) {
      risks.push({
        level: 1, name: "数字过密",
        why: "一行里塞四个以上数字，读起来像在自证；HR 会本能地怀疑",
        fix: "留最强的一个，其余换成过程描述"
      });
    }

    /* 团队规模跟职级/年限不匹配 */
    if (/(总监|负责人|主管|经理)/.test(t) && ctx && ctx.p && ctx.p.expMonths < 36) {
      risks.push({
        level: 3, name: "职级超前",
        why: "不到 3 年就写负责人/经理口径，背调一核对就是硬伤",
        fix: "按真实 title 写；责任半径可以写在经历里，不必写进头衔"
      });
    }

    var high = risks.filter(function (r) { return r.level >= 3; }).length;
    var mid = risks.filter(function (r) { return r.level === 2; }).length;
    var level = high ? "high" : (mid ? "watch" : "clean");
    var score = clamp(100 - high * 30 - mid * 12 - (risks.length - high - mid) * 5, 0, 100);

    return { level: level, score: score, risks: risks.slice(0, 4) };
  }

  /* =========================================================
   * 8. ④ 缺什么（该补）
   * ========================================================= */

  var LADDER = [
    { name: "规模", ex: "管几个店 / 多少 SKU / 多少人 / 多少条数据" },
    { name: "频率", ex: "每周几场 / 日均多少单 / 每月几篇" },
    { name: "占比与排名", ex: "占团队 3 人中的 2 人 / 组内第 1 / 覆盖 60% 区域" },
    { name: "时间", ex: "把周期从 7 天压到 3 天 / 2 周内交付" },
    { name: "对比", ex: "改前 2.1%，改后 2.8%" }
  ];

  function addsForRow(row, ctx) {
    var out = [], t = row.text, d = row.detail, s = row.sig;
    var isContent = row.section === "工作经历" || row.section === "实习经历" ||
      row.section === "项目经历" || row.section === "校园经历";

    if (isContent) {
      if (d.missing.indexOf("规模") !== -1) {
        out.push({
          what: "盘子多大",
          why: "没有规模，你的「优化」就没有分量 —— 优化 10 个用户和 10 万个用户是同一种写法",
          example: "在句首补一个量级词：负责 " + "【3 个店铺 / 1200 人社群 / 日均 800 单】" + " 的……"
        });
      }
      if (d.missing.indexOf("结果") !== -1) {
        out.push({
          what: "结果指标",
          why: "这条只有过程。面试官的原话会是「所以呢？」",
          example: "句尾补「，把【指标】从 A 提到 B（周期）」，A/B 用你真测过的数"
        });
      }
      if (d.missing.indexOf("方法") !== -1) {
        out.push({
          what: "怎么做到的",
          why: "结果相同、方法不同，才是你和别人的差别；方法也是面试最容易展开的点",
          example: "中间补一段「用【工具/机制】做【动作】」，例如「用神策埋点拆三步漏斗」"
        });
      }
      if (!HARD_TEAM_RE.test(t) && ctx && ctx.p && ctx.p.expMonths >= 12 && /主导|牵头|统筹|带/.test(t)) {
        out.push({
          what: "团队与汇报",
          why: "写「主导」而不写团队规模，会被认为在借团队的成果",
          example: "补「带 N 人小组 / 与 M 个部门协同 / 汇报给 XX」"
        });
      }
      if (/上线|交付|发布|投产/.test(t) && !s.quant.length) {
        out.push({
          what: "上线后的变化",
          why: "上线是动作，不是结果。业务指标才是结果",
          example: "补一句「上线后【指标】从 A 到 B，稳定运行 N 个月」"
        });
      }
    }

    if (row.kind === "skill") {
      out.push({
        what: "每项技能的一个使用场景",
        why: "『熟练使用 X』对 HR 等于零信息；场景才能证明你会",
        example: "写成「SQL：日常写多表关联做留存分析，最长跑过 300 万行」"
      });
    }

    if (row.kind === "entry" && row.entry && row.entry.bullets.length === 0 && row.section !== "教育背景") {
      out.push({
        what: "这段经历的内容",
        why: "只有抬头没有一个字，等于告诉 HR 这段没什么可写 —— 但这段往往是最相关的一段",
        example: "至少补三条：一条职责边界、一条具体动作、一条带数的结果"
      });
    }

    if (row.kind === "entry" && row.entry && row.entry.bullets.length === 1 && row.section !== "教育背景") {
      out.push({
        what: "第二、第三条",
        why: "一条撑不起一段经历，HR 会以为你只有这一件事可写",
        example: "第二条写「怎么做的」，第三条写「结果与影响范围」"
      });
    }

    return out;
  }

  function docAdds(ctx) {
    var out = [];
    var r = ctx.r, text = r.raw, p = ctx.p;
    var secNames = (r.sections || []).map(function (s) { return s.name; });

    if (!MAIL_RE.test(text) && !PHONE_RE.test(text)) {
      out.push({
        what: "联系方式",
        why: "没有手机和邮箱，HR 想约你也约不到",
        example: "抬头一行：姓名 | 目标岗位 | 手机 | 邮箱 | 城市（可选：作品集链接）"
      });
    }
    if (secNames.indexOf("教育背景") === -1 && !/(大学|学院|本科|硕士|专科|高中)/.test(text)) {
      out.push({
        what: "教育背景",
        why: "学历是硬筛条件，没有这一行会被直接判为信息不全",
        example: "学校 + 专业 + 学历 + 起止时间（有排名/绩点再加一行）"
      });
    }
    if (secNames.indexOf("技能证书") === -1 && !/(技能|证书|语言)/.test(text)) {
      out.push({
        what: "技能清单",
        why: "HR 找关键词时先看技能区；正文里写过也要在技能区收一遍",
        example: "分三层：能独立交付的 / 用过的 / 只了解的，各配一个场景"
      });
    }
    var fam = p && p.family;
    if ((fam === "技术" || fam === "设计" || fam === "市场" || fam === "运营") &&
      secNames.indexOf("项目经历") === -1 && !/项目经历/.test(text)) {
      out.push({
        what: "项目经历",
        why: "这个职能族看的就是「你独立做成过什么」，只有职责没有项目会被判为执行层",
        example: "挑一个你真做过的：背景一句 → 你的角色 → 动作三件 → 结果一个数"
      });
    }
    if (!/(难点|坑|失败|踩|权衡|取舍|返工|事故)/.test(text)) {
      out.push({
        what: "一处难点或取舍",
        why: "整份简历没有一处「难在哪」，面试必问「最难的是什么」，你会临场现编",
        example: "在某条经历里补半句：「难点是 X，最后用 Y 解决」"
      });
    }
    if (ctx.m && ctx.m.hasJD && ctx.m.missing && ctx.m.missing.length) {
      var words = [];
      ctx.m.missing.forEach(function (x) {
        if (words.some(function (y) { return y.indexOf(x.word) !== -1; })) return;
        words = words.filter(function (y) { return x.word.indexOf(y) === -1; });
        words.push(x.word);
      });
      words.slice(0, 4).forEach(function (w) {
        out.push({
          what: "JD 关键词「" + w + "」",
          why: "JD 里有、简历里找不到，ATS 和 HR 都会判为不匹配",
          example: "只在你真做过的经历里换成 JD 的原词，别新造一段经历"
        });
      });
    }
    if (p && p.expMonths >= 12 && !/至今|现在|目前/.test(text)) {
      out.push({
        what: "当前在职状态",
        why: "最近一段没有「至今」，HR 会以为你已离职很久",
        example: "最近一段写成「2023.06 - 至今」"
      });
    }
    return out;
  }

  /* =========================================================
   * 9. ⑤ 该删什么
   * ========================================================= */

  function cutsForRow(row, ctx) {
    var out = [], t = row.text;

    CUT_DOC_RULES.forEach(function (rule) {
      if (!rule.re.test(t)) return;
      if (rule.id === "resume-title" && row.kind !== "contact" && row.kind !== "body") return;
      if (rule.id === "hobby" && row.kind === "skill") return;
      out.push({ text: t, what: rule.name, why: rule.why, fix: rule.fix });
    });

    /* 空话：来自引擎的 vague 词表 + 语言层的自夸/软素质 */
    var soft = hitsOf(t, ["认真", "努力", "积极", "热情", "踏实", "勤奋", "责任心", "团队精神"]);
    if (soft.length) {
      out.push({
        text: soft.join("、"), what: "空话词",
        why: "这些词删掉之后句子信息量不变，说明它们本来就不承载信息",
        fix: "删掉；如果确实重要，换成一件能证明它的事"
      });
    }

    if (row.kind === "selfeval") {
      out.push({
        text: t, what: "整段自我评价",
        why: "自我评价是简历里最容易被跳过的一段，也是 AI 味最重的一段",
        fix: "整段删掉，把其中最有底气的一条升级成「核心优势」，每条配一个证据"
      });
    }

    if (row.kind === "bullet" && row.sig.firstPerson.length) {
      out.push({
        text: row.sig.firstPerson.join("、"), what: "第一人称",
        why: "简历默认主语是「我」，写出来反而显得业余",
        fix: "删掉「我/本人」，动词开头"
      });
    }

    if (row.detail && row.detail.len > 90) {
      out.push({
        text: cut(t, 24), what: "超长句",
        why: "超过 90 字，HR 的视线会跳过去；一条里塞了两三件事",
        fix: "按「一件事一条」拆开，每条控制在 60 字内"
      });
    }

    var verbs = (t.match(/负责|参与|协助|配合|支持|跟进|推进/g) || []);
    if (verbs.length >= 2) {
      out.push({
        text: uniqArr(verbs).join("、"), what: "一句话两件事",
        why: "两个动词意味着两个不同的责任，混在一句里会互相稀释",
        fix: "拆成两条，各自补上结果"
      });
    }

    if (LOUD_RE.test(t) || EMOJI_RE.test(t) || PUNCT_NOISE_RE.test(t)) {
      out.push({
        text: "！/符号/表情", what: "装饰符号",
        why: "感叹号和表情在简历里只会削弱专业感",
        fix: "删掉，用数字代替语气"
      });
    }

    return out;
  }

  function docCuts(ctx, rows) {
    var out = [], text = ctx.r.raw;

    /* 重复表述：两条 bullet 的字面重合度 */
    var bullets = (ctx.sig.bullets || []).filter(function (b) {
      return b.section === "工作经历" || b.section === "实习经历" || b.section === "项目经历";
    });
    for (var i = 0; i < bullets.length; i++) {
      for (var j = i + 1; j < bullets.length; j++) {
        var a = bullets[i].text, b = bullets[j].text;
        if (Math.abs(a.length - b.length) > 12) continue;
        var same = 0, n = Math.min(a.length, b.length);
        for (var k = 0; k < n; k++) if (a.charAt(k) === b.charAt(k)) same++;
        if (n && same / n > 0.6) {
          out.push({
            text: cut(b, 30), what: "和另一条几乎重复",
            why: "同义的两条会让 HR 觉得你在凑行数",
            fix: "留信息量大的那条，另一条删掉或换成不同角度",
            line: bullets[j].line
          });
          break;
        }
      }
    }

    if (ctx.selfEvalLen > 40) {
      out.push({
        text: "自我评价（" + ctx.selfEvalLen + " 字）", what: "整段自我评价",
        why: "这段通常在 HR 的 6 秒里被整段跳过，却占了半屏",
        fix: "删掉，换成三条带证据的核心优势"
      });
    }

    /* 和目标岗位无关的旧经历：占位太多时建议压缩 */
    if (ctx.m && ctx.m.hasJD && ctx.m.missing && ctx.m.missing.length >= 4 && ctx.p && ctx.p.expMonths >= 36) {
      out.push({
        text: "与 JD 方向不一致的早期经历", what: "无关经历的篇幅",
        why: "JD 关键词覆盖不足时，无关经历占的每一行都在稀释匹配度",
        fix: "早期无关经历压成一行（公司 + 岗位 + 时间），把篇幅让给最相关的两段"
      });
    }

    /* 空的装饰行 / 分隔符 */
    var deco = reCount(text, /^[=\-*_—]{3,}$/m);
    if (deco >= 2) {
      out.push({
        text: "分隔线 ×" + deco, what: "装饰分隔线",
        why: "解析器和大模型都可能把它当乱码，人看也不增加信息",
        fix: "删掉，用留白和层级区分版块"
      });
    }

    return out.slice(0, 6);
  }

  /* =========================================================
   * 10. ⑥ 语言（去 AI 味）
   * ========================================================= */

  function toneOf(text) {
    var hits = [], raw = 0;

    TONE_GROUPS.forEach(function (g) {
      var found = hitsOf(text, g.words);
      found.forEach(function (w) {
        hits.push({ word: w, group: g.key, groupName: g.name, fix: g.fix });
        raw += g.weight;
      });
    });

    TONE_PATTERNS.forEach(function (p) {
      if (!reTest(text, p.re)) return;
      hits.push({ word: p.name, group: "pattern", groupName: "AI 句式", fix: p.fix });
      raw += p.weight;
    });

    var triple = text.match(TRIPLE_RE);
    if (triple) {
      hits.push({
        word: triple[1] + "、" + triple[2] + "、" + triple[3], group: "triple",
        groupName: "同构三连",
        fix: "三个并列读起来像 PPT。留最有力的一个，其余删掉或换成数字"
      });
      raw += 8;
    }
    if (/(结果|成效|结论)[:：]/.test(text)) {
      hits.push({
        word: "结论式冒号", group: "pattern", groupName: "AI 句式",
        fix: "冒号后面通常是一句抽象总结。直接写数字，不用冒号"
      });
      raw += 6;
    }

    /* 权重 ×1.6：命中两个词就该明显掉分，否则「有点 AI 味」和「整段是模板」分不出来 */
    var score = clamp(100 - raw * 1.6, 0, 100);
    return { score: score, hits: hits.slice(0, 6), n: hits.length, raw: raw };
  }

  function stripPreview(text, hits) {
    var t = String(text);
    hits.forEach(function (h) {
      if (h.word && h.word.length >= 2 && h.group !== "pattern" && h.group !== "triple") {
        t = t.split(h.word).join("");
      }
    });
    t = t.replace(/[，,]{2,}/g, "，").replace(/^[，,、\s]+/, "").replace(/[，,、]\s*$/, "");
    return t;
  }

  /* =========================================================
   * 11. ⑦ 逻辑
   * ========================================================= */

  function logicDoc(ctx) {
    var out = [], r = ctx.r, p = ctx.p;
    var workEntries = (r.entries || []).filter(function (e) {
      return (e.section === "工作经历" || e.section === "实习经历") && e.start;
    });

    /* 倒序 */
    for (var i = 0; i + 1 < workEntries.length; i++) {
      var a = workEntries[i], b = workEntries[i + 1];
      if (P && P.cmpYM && P.cmpYM(a.start, b.start) < 0) {
        out.push({
          level: "important", title: "经历不是倒序",
          why: "HR 只想先看最近一段；正序会让他先读到你最弱的起点",
          fix: "整段经历按时间从近到远重排，最近一段放最上面",
          line: b.line, excerpt: cut(b.head, 24)
        });
        break;
      }
    }

    /* 时间重叠 */
    for (var x = 0; x < workEntries.length; x++) {
      for (var y = x + 1; y < workEntries.length; y++) {
        var e1 = workEntries[x], e2 = workEntries[y];
        if (!e1.end || !e2.end) continue;
        var overlap = (e1.end[0] - e2.start[0]) * 12 + (e1.end[1] - e2.start[1]);
        if (overlap > 2 && e2.start && (e2.start[0] * 12 + e2.start[1]) < (e1.end[0] * 12 + e1.end[1])) {
          out.push({
            level: "fatal", title: "两段全职时间重叠",
            why: "时间线重叠会被当成注水，除非明确写明是兼职/并行项目",
            fix: "注明「兼职/并行」并说明投入比例，或者核对日期改对",
            line: e2.line, excerpt: cut(e2.head, 24)
          });
        }
      }
    }

    /* 空窗 */
    (p.gaps || []).forEach(function (g) {
      out.push({
        level: "important", title: g.months + " 个月空窗没有解释",
        why: "空窗本身不是问题，没解释才是；HR 会自己编一个更坏的理由",
        fix: "在对应位置加一行：这几个月做了什么 + 学到什么 + 现在能干什么（一行足够）",
        line: g.line, excerpt: cut((r.entries.filter(function (e) { return e.line === g.line; })[0] || {}).head || "", 24)
      });
    });

    /* 转行 / 岗位错位 */
    if (p.mismatch) {
      out.push({
        level: "important", title: "求职意向与内容不是同一种语言",
        why: p.mismatch.note,
        fix: "旧经历不删，把动作换成目标岗听得懂的词，并补一句为什么转",
        line: null, excerpt: ""
      });
    }

    /* 技能与正文打架 */
    var skillText = ctx.skillText || "";
    if (skillText) {
      var tokens = skillText.match(/[A-Za-z][A-Za-z0-9+#.]{1,14}/g) || [];
      var bodyText = ctx.bodyText || "";
      var notUsed = [];
      tokens.forEach(function (tk) {
        if (tk.length < 2) return;
        var re = new RegExp("\\b" + tk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
        if (!re.test(bodyText)) notUsed.push(tk);
      });
      notUsed.slice(0, 3).forEach(function (tk) {
        out.push({
          level: "minor", title: "技能「" + tk + "」在经历里一次没出现",
          why: "技能区写了但正文没有证据，HR 会把它当摆设，面试也不会问",
          fix: "在真用过它的那条经历里补一句场景；没用过就从技能区删掉",
          line: ctx.skillLine, excerpt: tk
        });
      });
    }

    /* 段落顺序：社招把教育放最前 */
    var secIdx = {};
    (r.sections || []).forEach(function (s, i) { secIdx[s.name] = i; });
    if (p.expMonths >= 24 && secIdx["教育背景"] !== undefined && secIdx["工作经历"] !== undefined &&
      secIdx["教育背景"] < secIdx["工作经历"]) {
      out.push({
        level: "minor", title: "教育背景排在经历前面",
        why: "社招的首屏应该给最近一段经历；教育放最前等于把最弱的信息放在最贵的位置",
        fix: "顺序改成：基本信息 → 核心优势 → 工作经历 → 项目 → 教育 → 技能",
        line: null, excerpt: ""
      });
    }

    return out;
  }

  function logicForRow(row, ctx) {
    var out = [], t = row.text, s = row.sig;
    var isContent = row.section === "工作经历" || row.section === "实习经历" || row.section === "项目经历";

    if (row.kind === "entry" && row.entry) {
      var e = row.entry;
      if (P && P.months) {
        var m = P.months(e);
        if (m > 96 && e.section === "工作经历") {
          out.push({ title: "这段时长超过 8 年", why: "可能是把同一家公司的多个岗位写成一整段，责任变化看不出来", fix: "按岗位拆成两段，各写各的成果" });
        }
      }
      if (e.section === "项目经历" && e.start && e.end && P) {
        var pm = P.months(e);
        if (pm > 0 && pm < 2) {
          out.push({ title: "项目只有 " + pm + " 个月", why: "太短的项目会被问「你到底参与了多少」", fix: "补上你在项目里的具体交付物，或换成更完整的项目" });
        }
      }
    }

    if (isContent) {
      /* 一句两件事：责任被稀释，逻辑上不闭合（与「该删」里的同名规则互为主副，
         这里只保留结论，删法在 cut 里给） */
      var verbs = uniqArr(t.match(/负责|参与|协助|配合|支持|跟进|推进|维护|整理/g) || []);
      if (verbs.length >= 2 && t.length > 30) {
        out.push({
          title: "一句话里两个动作，责任不清",
          why: "「" + verbs.slice(0, 2).join(" + ") + "」写在同一句，HR 分不清你到底主责哪一件",
          fix: "拆成两条，各自把结果写出来"
        });
      }
    }

    if (row.kind === "intent" && ctx.p && ctx.p.targetLevel !== null && ctx.p.contentLevel !== null) {
      if (ctx.p.targetLevel >= 3 && ctx.p.contentLevel <= 2) {
        out.push({
          title: "意向职级高于现有职级",
          why: D.ipo_level_gap_tip ? D.ipo_level_gap_tip.too_high : "目标岗要管理经验，简历里没有管理证据",
          fix: "要么补管理证据（带几个人、定过什么标准），要么换更匹配的岗"
        });
      }
    }

    return out.slice(0, 3);
  }

  /* =========================================================
   * 12. 汇总：七项评分
   * ========================================================= */

  var DIM_DEFS = [
    { key: "detail", name: "详细度", weight: 0.24, desc: "对象 / 动作 / 方法 / 规模 / 结果，五件齐不齐" },
    { key: "missing", name: "该补的补了没", weight: 0.18, desc: "缺的要素、缺的板块、缺的关键词" },
    { key: "truth", name: "真实性", weight: 0.15, desc: "口径、极端词、职级、团队成果归属" },
    { key: "tone", name: "语言 ai味", weight: 0.13, desc: "行话、形容词、软素质、AI 句式" },
    { key: "ask", name: "追问防御", weight: 0.12, desc: "每一处会被追着问的地方，你有没有备好答案" },
    { key: "cut", name: "该删的删了没", weight: 0.11, desc: "废话、隐私、重复、超长句" },
    { key: "logic", name: "逻辑与结构", weight: 0.07, desc: "倒序、重叠、空窗、技能与经历是否打架" }
  ];

  function levelOfScore(sc) {
    if (sc >= 85) return "A";
    if (sc >= 72) return "B";
    if (sc >= 60) return "C";
    return "D";
  }

  /* =========================================================
   * 13. 主入口
   * ========================================================= */

  function audit(text, opts) {
    opts = opts || {};
    var raw = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var trimmed = raw.trim();
    if (trimmed.length < 30) {
      return { ok: false, error: "内容太短：至少要有教育背景 + 一段经历（30 字以上）才能深审。" };
    }
    if (!P || !SG) {
      return { ok: false, error: "引擎未加载：engine-audit 依赖 engine-resume（parse / signals / profile / jd-match）。" };
    }

    var r = P.parse(trimmed);
    var sig = SG.analyze(r);
    var p = global.RProfile.build(r, mapIndustry(opts.industry), opts.jobTitle || "");
    var m = global.RJd ? global.RJd.matchJD(r.raw, opts.jd || "") : { hasJD: false, missing: [], coverage: 0, verdict: "-" };

    var lines = raw.split("\n");
    var byLine = bulletsByLine(sig);
    var infos = classifyLines(lines, r);

    var ctx = {
      r: r, sig: sig, p: p, m: m,
      selfEvalLen: (r.selfEval || "").length,
      skillText: "", skillLine: null, bodyText: ""
    };
    infos.forEach(function (info) {
      if (info.kind === "skill" && !ctx.skillText) {
        ctx.skillText = info.text;
        ctx.skillLine = info.line;
      }
    });
    ctx.bodyText = infos.filter(function (i) {
      return i.kind === "bullet" || i.kind === "entry";
    }).map(function (i) { return i.text; }).join(" ");

    /* ---------- 逐行 ---------- */
    var rows = [], i = 0;
    infos.forEach(function (info) {
      if (info.kind === "heading") return; // 版块标题不是提问点，只在结构里算
      var s = rowSignals(info, byLine);
      var row = {
        __i: i++,
        line: info.line,
        lineNo: info.line + 1,
        text: info.text,
        excerpt: cut(info.text, 40),
        kind: info.kind,
        section: info.section,
        entry: info.entry,
        sig: s
      };
      row.detail = detailOf(row, ctx);
      /* 句式只对正文条目有意义：抬头行、技能清单、自我评价不套五要素模板 */
      row.pattern = row.kind === "bullet" ? patternOf(row) : null;
      row.truth = truthOf(row, ctx);
      row.tone = toneOf(row.text);
      row.ask = asksForRow(row, ctx);
      row.add = addsForRow(row, ctx);
      row.cut = cutsForRow(row, ctx);
      row.logic = logicForRow(row, ctx);
      row.strip = row.tone.hits.length ? stripPreview(row.text, row.tone.hits) : "";
      rows.push(row);
    });

    /* ---------- 全局 ---------- */
    var cutDoc = docCuts(ctx, rows);
    var addDoc = docAdds(ctx);
    var logicDocList = logicDoc(ctx);

    /* 语言：整篇的 AI 味指纹（句长雷同 / 动词单一 / 结构同构） */
    var toneDoc = toneDocCheck(ctx, rows);

    /* ---------- 汇总统计 ---------- */
    var contentRows = rows.filter(function (x) {
      return x.kind === "bullet" || x.kind === "entry";
    });
    var allAsks = [];
    rows.forEach(function (row) {
      row.ask.forEach(function (a) {
        allAsks.push({
          line: row.line, lineNo: row.lineNo, excerpt: row.excerpt,
          kind: a.kind, risk: a.risk, question: a.question, skeleton: a.skeleton,
          section: row.section
        });
      });
    });
    allAsks.sort(function (a, b) { return b.risk - a.risk || a.line - b.line; });

    var allCuts = [];
    rows.forEach(function (row) {
      row.cut.forEach(function (c) {
        allCuts.push(Object.assign({}, c, { line: row.line, lineNo: row.lineNo, excerpt: row.excerpt }));
      });
    });
    cutDoc.forEach(function (c) { allCuts.push(Object.assign({}, c, { lineNo: c.line != null ? c.line + 1 : null })); });

    var allAdds = [];
    rows.forEach(function (row) {
      row.add.forEach(function (a) {
        allAdds.push(Object.assign({}, a, { line: row.line, lineNo: row.lineNo, excerpt: row.excerpt }));
      });
    });

    var allLogic = [];
    rows.forEach(function (row) {
      row.logic.forEach(function (l) {
        allLogic.push(Object.assign({}, l, { line: row.line, lineNo: row.lineNo, excerpt: row.excerpt }));
      });
    });
    logicDocList.forEach(function (l) {
      allLogic.push(Object.assign({}, l, { lineNo: l.line != null ? l.line + 1 : null }));
    });

    /* ---------- 七项分 ---------- */
    var nContent = Math.max(1, contentRows.length);
    var highAsk = allAsks.filter(function (a) { return a.risk >= 3; }).length;
    var bulletRows = rows.filter(function (x) { return x.kind === "bullet"; });
    var textRows = rows.filter(function (x) {
      return x.kind === "bullet" || x.kind === "skill" || x.kind === "selfeval";
    });

    /* 职能族：同一套七维，换权重、加一条硬门槛。
       销售没业绩数字 / 技术没技术栈 / 设计没作品链接，这三条是该族真会刷人的点 */
    var famName = familyOf(p);
    var famProf = FAMILY_PROFILE[famName];
    var famArch = famProf.arch;
    var weights = ARCH_WEIGHTS[famArch] || ARCH_WEIGHTS["通用"];
    var famGate = familyGate(famName, ctx, rows);
    if (famGate.adds.length) addDoc = addDoc.concat(famGate.adds);

    /* ① 详细度：只数正文 bullet。抬头行没有「详细度」这回事，
       只有「这段是光秃的」这件事，单独扣分 */
    var detailScore;
    if (bulletRows.length) {
      detailScore = pyRound(
        bulletRows.reduce(function (a, x) { return a + x.detail.score; }, 0) / bulletRows.length, 0);
    } else {
      detailScore = contentRows.length ? 40 : 25;
    }
    contentRows.forEach(function (x) {
      if (x.kind === "entry" && x.entry && x.entry.bullets.length === 0 && x.section !== "教育背景") detailScore -= 15;
    });
    detailScore = clamp(detailScore, 0, 100);

    /* ② 真实性：硬风险（口径/职级/极端词）扣得最狠 */
    var truthHigh = rows.filter(function (x) { return x.truth.level === "high"; }).length;
    var truthMid = rows.filter(function (x) { return x.truth.level === "watch"; }).length;
    var truthScore = clamp(100 - truthHigh * 22 - truthMid * 8, 0, 100);

    /* ③ 语言：只算承载文字的条目；姓名电话抬头本来就没什么语言可评 */
    var toneRowScore = textRows.length
      ? pyRound(textRows.reduce(function (a, x) { return a + x.tone.score; }, 0) / textRows.length, 0) : 85;
    var toneScore = clamp(toneRowScore - toneDoc.penalty, 0, 100);

    /* ④ 追问防御：只数「落在站不住的行上的高危追问」。
       有数的地方当然会被追问 —— 那是好事，不该罚 */
    var weakHighAsks = 0;
    var weakAskRows = 0;
    rows.forEach(function (x) {
      var maxRisk = 0;
      x.ask.forEach(function (a) { maxRisk = Math.max(maxRisk, a.risk); });
      var weak = (x.detail && x.detail.score < 60) || (x.truth && x.truth.level !== "clean");
      if (maxRisk >= 3 && weak) {
        weakAskRows++;
        x.ask.forEach(function (a) { if (a.risk >= 3) weakHighAsks++; });
      }
    });
    var askScore = clamp(100 - weakHighAsks * 9, 0, 100);

    /* ⑤ 该删：按「每条内容摊到几个要删的东西」算，绝对数量容易冤枉长简历 */
    var cutsPerRow = allCuts.length / nContent;
    var cutScore = clamp(100 - cutsPerRow * 34, 0, 100);

    /* ⑥ 该补：板块缺口 > JD 词缺口 > 单条要素缺口 */
    var structuralAdds = addDoc.filter(function (a) { return !/JD 关键词/.test(a.what); }).length;
    var jdAdds = addDoc.length - structuralAdds;
    var addsPerRow = allAdds.length / nContent;
    var addTotal = allAdds.length + addDoc.length;
    var missingScore = clamp(
      100 - structuralAdds * 9 - jdAdds * 4 - Math.min(62, addsPerRow * 22), 0, 100);

    /* ⑦ 逻辑 */
    var fatalLogic = allLogic.filter(function (l) { return l.level === "fatal"; }).length;
    var importantLogic = allLogic.filter(function (l) { return l.level === "important"; }).length;
    var logicScore = clamp(
      100 - fatalLogic * 20 - importantLogic * 10 - (allLogic.length - fatalLogic - importantLogic) * 3, 0, 100);

    var scores = {
      detail: detailScore, truth: truthScore, tone: toneScore, ask: askScore,
      cut: cutScore, missing: missingScore, logic: logicScore
    };

    /* 先动这三条：按「改起来最便宜 × 掉分最狠」排，不是按严重程度排 */
    var topArr = topActions(rows, allCuts, addDoc, allLogic, bulletRows, nContent, toneDoc);

    /* JD 行级落位：只在给了 JD 时算，只做关键词映射 */
    var jdMap = jdRowMap(rows, m);
    var rawOverall = 0;
    DIM_DEFS.forEach(function (d) {
      var w = (weights[d.key] == null ? d.weight : weights[d.key]);
      rawOverall += scores[d.key] * w;
    });
    rawOverall = clamp(Math.round(rawOverall), 0, 100);

    /* 有硬伤时维度相加是假分：内容都没写清楚的简历，不该靠「真实」「语言」拿高分。
       封顶逻辑与 resume_engine 一致：写清原始分、封顶值、为什么封 */
    var resultBullets = bulletRows.filter(function (x) { return x.detail.got && x.detail.got.结果; }).length;
    var resultRatio = bulletRows.length ? resultBullets / bulletRows.length : 0;
    var cap = 100, capReason = "";
    var baldEntries = contentRows.filter(function (x) {
      return x.kind === "entry" && x.entry && x.entry.bullets.length === 0 && x.section !== "教育背景";
    }).length;
    if (baldEntries) {
      cap = Math.min(cap, 58);
      capReason = baldEntries + " 段经历只有抬头没有内容";
    }
    if (detailScore < 40) {
      cap = Math.min(cap, 59);
      capReason = "正文要素严重缺失（详细度 " + detailScore + " 分），先写内容再谈分数";
    } else if (bulletRows.length >= 3 && resultRatio < 0.25) {
      cap = Math.min(cap, 68);
      capReason = "只有 " + resultBullets + "/" + bulletRows.length + " 条写出了结果，其余只写了「在忙」";
    }
    if (truthHigh >= 2) {
      cap = Math.min(cap, 66);
      capReason = truthHigh + " 处真实性硬风险，答不上来会翻车";
    }
    if (famGate.cap < cap) {
      cap = famGate.cap;
      capReason = famGate.why;
    }
    var overall = Math.min(rawOverall, cap);

    var dims = DIM_DEFS.map(function (d) {
      var sc = Math.round(scores[d.key]);
      return {
        key: d.key, name: d.name,
        weight: (weights[d.key] == null ? d.weight : weights[d.key]),
        score: sc, desc: d.desc,
        note: dimNote(d.key, {
          scores: scores, highAsk: highAsk, nContent: nContent, truthHigh: truthHigh,
          truthMid: truthMid, allCuts: allCuts, addTotal: addTotal, allLogic: allLogic,
          toneDoc: toneDoc, contentRows: contentRows, bulletRows: bulletRows,
          weakAskRows: weakAskRows, structuralAdds: structuralAdds
        })
      };
    });

    var weakest = dims.slice().sort(function (a, b) { return a.score - b.score; })[0];

    var out = {
      ok: true,
      version: VERSION,
      meta: {
        lines: lines.filter(function (x) { return x.trim(); }).length,
        rows: rows.length,
        contentRows: contentRows.length,
        chars: trimmed.replace(/\s/g, "").length,
        kind: p.kind, family: p.family, industry: p.industry,
        familyArch: famArch,
        familyLook: famProf.look,
        familyScale: famProf.scale,
        familyGate: famGate.cap < 100 ? famGate.why : "",
        expMonths: p.expMonths, nJobs: p.nJobs,
        hasJD: !!m.hasJD, coverage: m.hasJD ? Math.round((m.coverage || 0) * 100) : null,
        verdict: m.verdict || "",
        generatedAt: new Date().toISOString()
      },
      overall: overall,
      rawOverall: rawOverall,
      capped: overall < rawOverall,
      cap: cap,
      capReason: capReason,
      level: levelOfScore(overall),
      headline: "最该先动的是「" + weakest.name + "」（" + weakest.score + " 分）。" +
        (contentRows.length ? "逐行过堂共 " + rows.length + " 处，其中 " + highAsk + " 处会被追着问。" : ""),
      dims: dims,
      counts: {
        asks: allAsks.length, highAsks: highAsk, cuts: allCuts.length,
        adds: addTotal, logic: allLogic.length, toneHits: toneDoc.n + rows.reduce(function (a, x) { return a + x.tone.n; }, 0)
      },
      rows: rows,
      asks: allAsks,
      topActions: topArr,
      jdMap: jdMap,
      cuts: allCuts,
      adds: allAdds,
      addsDoc: addDoc,
      logic: allLogic,
      toneDoc: toneDoc,
      ladder: LADDER,
      jd: { hasJD: !!m.hasJD, missing: m.hasJD ? (m.missing || []).map(function (x) { return x.word; }) : [], coverage: m.hasJD ? Math.round((m.coverage || 0) * 100) : null, verdict: m.verdict || "" }
    };

    out.markdown = function () { return toMarkdown(out); };
    out.checklist = buildChecklist(out, 8);
    return out;
  }

  function dimNote(key, c) {
    if (key === "detail") {
      var thin = (c.contentRows || []).filter(function (x) {
        return x.detail && (x.detail.verdict === "太薄" || x.detail.verdict === "太空");
      }).length;
      return thin ? thin + " 条只有动作没有结果 / 要素缺三块以上" : "要素基本齐，主要看取舍";
    }
    if (key === "truth") {
      return c.truthHigh ? c.truthHigh + " 处硬风险（口径/职级/极端词）" :
        (c.truthMid ? c.truthMid + " 处需要补口径" : "没有发现明显的可信度风险");
    }
    if (key === "tone") {
      return c.toneDoc && c.toneDoc.n ? "整篇 " + c.toneDoc.n + " 处 AI 腔指纹" : "句子干净，不像模板生成的";
    }
    if (key === "ask") {
      return c.weakAskRows
        ? c.weakAskRows + " 处高危追问落在站不住的行上"
        : "追问都能落在有证据的地方";
    }
    if (key === "cut") {
      return c.allCuts.length ? c.allCuts.length + " 处可以删或必须删" : "没有明显该删的内容";
    }
    if (key === "missing") {
      if (!c.addTotal) return "该有的板块和要素都在";
      return c.addTotal + " 处该补" + (c.structuralAdds ? "（含 " + c.structuralAdds + " 处板块/要素缺口）" : "（主要是 JD 关键词）");
    }
    if (key === "logic") {
      var f = (c.allLogic || []).filter(function (l) { return l.level === "fatal"; }).length;
      return f ? f + " 处硬冲突" : ((c.allLogic || []).length ? (c.allLogic || []).length + " 处结构问题" : "时间线与主题都通");
    }
    return "";
  }

  /* 整篇的 AI 味指纹 */
  function toneDocCheck(ctx, rows) {
    var out = { hits: [], penalty: 0, n: 0 };
    var bullets = (ctx.sig.bullets || []).filter(function (b) {
      return b.section === "工作经历" || b.section === "实习经历" || b.section === "项目经历";
    });

    if (bullets.length >= 5) {
      var lens = bullets.map(function (b) { return b.text.length; });
      var avg = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
      var variance = lens.reduce(function (a, b) { return a + Math.pow(b - avg, 2); }, 0) / lens.length;
      if (Math.sqrt(variance) < 6) {
        out.hits.push({
          word: "句长雷同", group: "doc", groupName: "整篇指纹",
          fix: "每条都差不多长，读起来像一次生成的。故意写一条 12 字的短句和一条 50 字的长句"
        });
        out.penalty += 10;
      }
    }

    var startVerbs = {};
    bullets.forEach(function (b) {
      var v = String(b.text).slice(0, 2);
      startVerbs[v] = (startVerbs[v] || 0) + 1;
    });
    var topVerb = Object.keys(startVerbs).sort(function (a, b) { return startVerbs[b] - startVerbs[a]; })[0];
    if (bullets.length >= 5 && startVerbs[topVerb] / bullets.length >= 0.6) {
      out.hits.push({
        word: "开头动词单一（" + topVerb + "…）", group: "doc", groupName: "整篇指纹",
        fix: "六条里五条用同一个动词开头，读起来是职责说明书。换成动作各异的表达"
      });
      out.penalty += 8;
    }

    var selfEval = ctx.r.selfEval || "";
    if (selfEval.length > 60) {
      out.hits.push({
        word: "整段自我评价（" + selfEval.length + " 字）", group: "doc", groupName: "整篇指纹",
        fix: "连续三个以上的软素质形容，是 AI 生成简历最稳定的特征。删掉"
      });
      out.penalty += 8;
    }

    var dashCount = reCount(ctx.r.raw, /——/);
    if (dashCount >= 3) {
      out.hits.push({
        word: "破折号 ×" + dashCount, group: "doc", groupName: "整篇指纹",
        fix: "破折号构成的对偶解释是模型腔，删成普通句"
      });
      out.penalty += 5;
    }

    out.n = out.hits.length;
    return out;
  }

  function mapIndustry(label) {
    if (!label) return "";
    var s = String(label);
    var cat = s.split("-")[0];
    var MAP = {
      "互联网": "互联网技术", "人工智能": "互联网技术", "金融": "财会金融",
      "快消": "销售运营", "零售/电商": "销售运营", "制造业": "机械制造",
      "汽车/新能源": "新能源制造", "教育": "教育培训", "医疗": "医疗健康",
      "生物医药": "医疗健康", "财务/会计": "财会金融", "建筑/地产": "建筑工程",
      "能源/电力": "新能源制造", "通信": "互联网技术", "半导体": "机械制造",
      "游戏": "互联网技术"
    };
    return MAP[cat] || "";
  }

  /* =========================================================
   * 13.5 可填句式 + 先动这三条
   *   「写得太薄」只是诊断。用户接下来要的是：这句话照什么结构填。
   *   句式只搬运行里已经有的事实，缺的位置一律写成 [括号提示]，
   *   绝不替用户生成数字或成果 —— 这是这个引擎的底线。
   * ========================================================= */

  var VERB_UP = {
    "负责": "主导 / 负责（后面必须跟清「哪一段」，光「负责」等于没说）",
    "参与": "牵头 / 承担某个模块（写清你独立负责的那一块）",
    "协助": "支持（写清对方是谁、你交付了什么，别让人以为你只是递材料）",
    "配合": "推动 / 对接（写清谁听你的、你要到的结果是什么）",
    "完成": "交付 / 上线 / 落地（说清交付物是什么）",
    "进行": "直接换成具体动词：搭建 / 优化 / 复盘 / 谈判",
    "跟踪": "监控 / 复盘（说清盯的是哪个指标）",
    "处理": "解决 / 处置（说清处理了什么类型的问题、处理了多少）",
    "帮助": "支撑 / 推动（说清你让对方哪件事发生了变化）"
  };

  /* 抓行里第一个数字片段：坦白说就是「这一行唯一的证据」 */
  function numSpan(t) {
    var m = String(t).match(/[^，,。；;：:]{0,8}(?:\d+(?:\.\d+)?%?|\d+[万千百]?)[^，,。；;：:]{0,8}/);
    return m ? m[0].trim() : "";
  }

  function patternOf(row) {
    var t = String(row.text || "").replace(/^[-*·•\s]+/, "").trim();
    var s = row.sig || {};
    var d = row.detail || {};
    var got = d.got || {};
    var verb = s.verb || "";

    var rest = verb ? t.replace(verb, "") : t;
    rest = rest.replace(/^[了的地]/, "");
    var obj = rest.split(/[，,。；;：:]/, 1)[0].trim();
    obj = obj.replace(/^(的|等)/, "").replace(/等$/, "");
    if (obj.length > 18) obj = obj.slice(0, 18);

    var num = numSpan(t);
    var parts = [];

    parts.push({
      key: "动作+对象",
      text: (verb || "[动词]") + (obj || "[对象]"),
      filled: !!(verb && obj),
      hint: verb ? "" : "换一个能看出你干了什么的动词"
    });

    if (got.方法) {
      var mh = (d.methods && d.methods.length) ? d.methods[0] : "";
      parts.push({ key: "方法", text: mh || "[怎么做的]", filled: !!mh, hint: mh ? "" : "补工具名 / 流程名 / 机制名，让别人能照做" });
    } else {
      parts.push({ key: "方法", text: "[怎么做的]", filled: false, hint: "工具名、流程名或机制 —— 没有方法，读者只能猜" });
    }

    if (got.规模) {
      parts.push({ key: "规模", text: num || "[盘子多大]", filled: !!num, hint: num ? "" : "人数 / 单量 / 金额 / 条数 / 覆盖多少门店" });
    } else {
      parts.push({ key: "规模", text: "[盘子多大]", filled: false, hint: "人数 / 单量 / 金额 / 条数 / 覆盖多少门店" });
    }

    if (got.结果) {
      var rw = (s.resultWords && s.resultWords.length) ? s.resultWords[0] : "";
      parts.push({ key: "结果", text: rw + "[从多少 → 到多少]", filled: false, hint: "原文有结果词，但缺口径：补改前与改后的两个数" });
    } else {
      parts.push({ key: "结果", text: "[改前 → 改后]", filled: false, hint: "占比 / 时长 / 成本 / 排名 / 复购，任选一个你真有的" });
    }

    var sentence = parts.map(function (p) { return p.text; }).join("，");
    var holes = parts.filter(function (p) { return !p.filled; }).length;

    return {
      sentence: sentence,
      leadWithResult: parts[3].text + "：" + parts[0].text +
        (parts[1].filled ? "，" + parts[1].text : "") + (parts[2].filled ? "，" + parts[2].text : ""),
      parts: parts,
      holes: holes,
      verbFix: (s.verbTier || 0) < 3 ? (VERB_UP[verb] || "") : "",
      note: holes
        ? "括号里都是你还没写的信息。填你真有的，没有就换一个能拿到的角度 —— 别估。"
        : "要素齐了，只剩把语气收紧。"
    };
  }

  /* 单条动作的收益估算：按上面那套权重反推，只做一阶近似，界面上标「估」。
     note 用来放「这一行本身」的变化 —— 总分的 +N 往往很小，行内的变化才看得见 */
  function gain(dim, delta, note) { return { dim: dim, delta: Math.round(delta), note: note || "" }; }

  function topActions(rows, allCuts, addDoc, allLogic, bulletRows, nContent, toneDoc) {
    var cands = [];

    rows.forEach(function (x) {
      if (x.truth.level === "high" && x.truth.risks.length) {
        var r = x.truth.risks[0];
        cands.push({
          kind: "truth", line: x.line, lineNo: x.lineNo, excerpt: x.excerpt,
          title: "改口径：" + r.name,
          why: r.why,
          doThis: r.fix,
          impact: gain("真实性", 22, "去掉 " + x.truth.risks.length + " 处硬风险"),
          weight: 100 + x.truth.risks.length * 4
        });
      }
    });

    rows.forEach(function (x) {
      if (x.kind !== "entry" || !x.entry || x.section === "教育背景") return;
      if (x.entry.bullets.length) return;
      cands.push({
        kind: "fill", line: x.line, lineNo: x.lineNo, excerpt: x.excerpt,
        title: "给「" + (x.entry.title || x.entry.org || x.entry.head || "这段经历") + "」补三条",
        why: "只有抬头没有内容，读者会默认这段没什么可写；而这段往往是最相关的",
        doThis: "三条各管一件事：① 你负责的范围（管多少人 / 多少店 / 多少钱）② 你做过的一个具体动作（怎么做的）③ 一个带数结果（改前 → 改后）",
        impact: gain("详细度", 15, "这段从 0 条内容到 3 条"),
        weight: 96
      });
    });

    bulletRows.forEach(function (x) {
      var high = x.ask.filter(function (a) { return a.risk >= 3; }).length;
      if (!high || x.detail.score > 45) return;
      var miss = x.detail.missing || [];
      cands.push({
        kind: "thicken", line: x.line, lineNo: x.lineNo, excerpt: x.excerpt,
        title: "把这条写到能被复述",
        why: "这条现在只有动作没有证据，却挂着 " + high + " 条必答追问",
        doThis: miss.length
          ? "按顺序补：" + miss.slice(0, 3).join(" → ") + "；照句式填：「" + patternOf(x).sentence + "」"
          : "补一个改前改后的对比数，或一个能说明规模的量",
        impact: gain("详细度", Math.round((80 - x.detail.score) / Math.max(1, bulletRows.length)),
          "这一行 " + x.detail.score + " → 80"),
        weight: 90 + high * 2
      });
    });

    allCuts.forEach(function (c) {
      if (c.lineNo == null) return;
      var w = /隐私|身份证|婚|薪|籍贯|身高/.test(c.what) ? 86 : 78;
      cands.push({
        kind: "cut", line: c.line != null ? c.line : null, lineNo: c.lineNo, excerpt: c.excerpt || "",
        title: "删掉：" + c.what,
        why: c.why,
        doThis: c.fix,
        impact: gain("该删", 34 / Math.max(1, nContent), ""),
        weight: w
      });
    });

    if (toneDoc && toneDoc.penalty >= 8 && toneDoc.hits.length) {
      cands.push({
        kind: "tone", line: null, lineNo: null, excerpt: "整篇",
        title: "统一笔调：" + toneDoc.hits[0].word,
        why: toneDoc.hits[0].fix,
        doThis: "把整篇的动词统一成你自己的说法（别一句「搭建」一句「完成了 XX 的搭建」），每句都念一遍，念着别扭的就是模板句子",
        impact: gain("语言", toneDoc.penalty, toneDoc.hits.length + " 类整篇指纹"),
        weight: 80
      });
    }

    allLogic.forEach(function (l) {
      if (l.level !== "fatal") return;
      cands.push({
        kind: "logic", line: l.line != null ? l.line : null, lineNo: l.lineNo, excerpt: l.excerpt || "",
        title: "修掉硬冲突：" + l.title,
        why: l.why,
        doThis: l.fix,
        impact: gain("逻辑", 20, ""),
        weight: 88
      });
    });

    (addDoc || []).forEach(function (a) {
      if (/JD 关键词/.test(a.what)) return;
      cands.push({
        kind: "add", line: null, lineNo: null, excerpt: "整份",
        title: "补板块：" + a.what,
        why: a.why,
        doThis: a.example,
        impact: gain("该补", 9, ""),
        weight: 74
      });
    });

    cands.sort(function (a, b) { return b.weight - a.weight; });

    var out = [];
    var usedLine = {};
    var usedKind = {};
    cands.forEach(function (c) {
      if (out.length >= 3) return;
      if (c.lineNo != null && usedLine[c.lineNo]) return;
      if (c.lineNo == null && usedKind[c.kind]) return;
      if ((usedKind[c.kind] || 0) >= 2) return;
      usedKind[c.kind] = (usedKind[c.kind] || 0) + 1;
      if (c.lineNo != null) usedLine[c.lineNo] = 1;
      c.rank = out.length + 1;
      c.impactText = c.impact.dim + " +" + c.impact.delta + " 分（估）" +
        (c.impact.note ? " · " + c.impact.note : "");
      out.push(c);
    });

    return out;
  }

  /* =========================================================
   * 13.6 职能族：换权重、加硬门槛
   *   同一套七维，不同职能族的筛法不一样：销售没业绩数字直接跳过，
   *   设计没作品链接直接跳过，技术看不到技术栈就当没做过。
   *   这里只做「该族 HR 真会用的那几条」，不编行业规则。
   * ========================================================= */

  var ARCH_WEIGHTS = {
    结果: { detail: 0.26, missing: 0.16, truth: 0.17, tone: 0.10, ask: 0.12, cut: 0.10, logic: 0.09 },
    工程: { detail: 0.26, missing: 0.18, truth: 0.14, tone: 0.10, ask: 0.12, cut: 0.10, logic: 0.10 },
    规范: { detail: 0.22, missing: 0.18, truth: 0.18, tone: 0.10, ask: 0.12, cut: 0.11, logic: 0.09 },
    表达: { detail: 0.24, missing: 0.16, truth: 0.12, tone: 0.16, ask: 0.14, cut: 0.10, logic: 0.08 },
    通用: { detail: 0.24, missing: 0.18, truth: 0.15, tone: 0.13, ask: 0.12, cut: 0.11, logic: 0.07 }
  };

  var FAMILY_PROFILE = {
    "运营": { arch: "结果", look: "你动过哪个指标、动了多少", scale: "用户数 / 单量 / 社群人数 / 活动参与" },
    "销售": { arch: "结果", look: "客单价、签单额、回款、客户体量", scale: "签单额 / 客户数 / 成交周期" },
    "市场": { arch: "结果", look: "投放 ROI、曝光、转化、预算规模", scale: "预算 / 曝光量 / 线索数" },
    "客服": { arch: "结果", look: "工单量、解决率、满意度、响应时长", scale: "工单量 / 日均接待 / 团队人数" },
    "技术": { arch: "工程", look: "技术栈、系统规模、你负责的模块边界", scale: "QPS / 数据量 / 用户量 / 服务数" },
    "测试": { arch: "工程", look: "用例数、缺陷数、自动化覆盖率", scale: "用例数 / 版本数 / 覆盖率" },
    "制造/工艺": { arch: "工程", look: "产线规模、良率、节拍、不良率", scale: "产线数 / 良率 / 日产量" },
    "建工": { arch: "工程", look: "项目体量、造价、工期、专业分工", scale: "建筑面积 / 造价 / 工期" },
    "供应链": { arch: "工程", look: "库存周转、履约时效、成本、SKU 数", scale: "SKU 数 / 月单量 / 仓库面积" },
    "财会": { arch: "规范", look: "账套规模、报表周期、审计口径、证书", scale: "账套数 / 金额规模 / 报表张数" },
    "法务": { arch: "规范", look: "合同量、诉讼标的、合规范围", scale: "合同份数 / 标的金额" },
    "人力资源": { arch: "规范", look: "招聘量、到岗率、组织规模、薪酬带宽", scale: "招聘量 / 员工数 / 部门数" },
    "行政": { arch: "规范", look: "流程覆盖人数、采购金额、会务规模", scale: "人数 / 金额 / 场次" },
    "设计": { arch: "表达", look: "作品、风格适配、落地效果", scale: "项目数 / 上线数 / 作品链接" },
    "教育": { arch: "表达", look: "学段、班型、提分或通过率、教研产出", scale: "学生数 / 班数 / 提分幅度" },
    "医护": { arch: "表达", look: "科室、床位、护理量、资质", scale: "床位数 / 日均护理量" },
    "通用": { arch: "通用", look: "你做的事、你的角色、结果", scale: "规模 / 频次 / 覆盖范围" }
  };

  var CERT_WORDS = ["CPA", "ACCA", "CMA", "初级会计", "中级会计", "税务师", "法律职业资格", "司法考试",
    "教师资格", "执业医师", "护士执业", "一级建造师", "二级建造师", "PMP", "人力资源管理师", "CFA"];

  var PORTFOLIO_RE = /(https?:\/\/|作品集|portfolio|behance|dribbble|站酷|zcool|花瓣|huaban|个人网站)/i;

  function familyOf(p) {
    var fam = (p && p.family) || "通用";
    return FAMILY_PROFILE[fam] ? fam : "通用";
  }

  /* 该职能族「没有就基本没戏」的那一条。只在这一条真的成立时才压分 */
  function familyGate(fam, ctx, rows) {
    var out = { cap: 100, why: "", adds: [] };
    var bodyAll = rows.filter(function (x) {
      return x.kind === "bullet" || x.kind === "entry" || x.kind === "skill";
    }).map(function (x) { return x.text; }).join(" ");

    if (fam === "销售") {
      var hasMoney = /\d+(?:\.\d+)?\s*(?:万|万元|w|W|k|K|亿)|签单|回款|业绩|成交金额/.test(bodyAll);
      if (!hasMoney) {
        out.cap = 62;
        out.why = "销售岗通篇看不到签单额 / 回款 / 客户体量，HR 一般直接跳过";
      }
    }

    if (fam === "技术" || fam === "测试") {
      var stack = hitsOf(bodyAll, TOOL_WORDS);
      var veryTech = ["Java", "Python", "Go", "C++", "Vue", "React", "Spring", "MySQL", "Redis", "Kafka", "Docker", "K8s"];
      var techHit = veryTech.filter(function (w) { return bodyAll.indexOf(w) !== -1; });
      if (!stack.length && !techHit.length && !(ctx.skillText || "").trim()) {
        out.cap = 66;
        out.why = "整份看不到技术栈，技术岗第一眼判断「没做过」";
      }
    }

    if (fam === "设计") {
      if (!PORTFOLIO_RE.test(bodyAll)) {
        out.cap = 68;
        out.why = "设计岗没有作品链接，作品集是唯一硬通货";
        out.adds.push({
          what: "作品集链接",
          why: "设计岗的简历正文只是索引，HR 会先点链接；没有链接等于没作品",
          example: "在抬头加一行：作品集 https://（你的在线作品地址），或在每条项目后标「作品见 #1」"
        });
      }
    }

    if (fam === "财会" || fam === "法务" || fam === "医护" || fam === "教育") {
      var hasCert = CERT_WORDS.some(function (w) { return bodyAll.indexOf(w) !== -1; });
      if (!hasCert) {
        var certName = fam === "财会" ? "会计职称 / CPA / 税务师"
          : fam === "法务" ? "法律职业资格"
            : fam === "医护" ? "护士执业证 / 医师资格证"
              : "教师资格证（写清学段学科）";
        out.adds.push({
          what: "资质证书",
          why: fam + "岗的证书是硬门槛，机筛和 HR 都会找关键词",
          example: "在「技能证书」区单独一行写：" + certName + "（有就写全称 + 取得年份，没有就先别写）"
        });
      }
    }

    return out;
  }

  /* =========================================================
   * 13.7 JD 行级映射：只做关键词落位，不做语义联想
   *   三档：正文有人接 / 只在技能区躺着 / 全文没提
   * ========================================================= */

  function jdRowMap(rows, m) {
    if (!m || !m.hasJD) return null;

    var terms = (m.covered || []).map(function (t) {
      return { word: t.word, via: t.via || t.word, weight: t.weight || 1 };
    }).concat((m.missing || []).map(function (t) {
      return { word: t.word, via: t.word, weight: t.weight || 1 };
    }));

    var contentRows = rows.filter(function (x) { return x.kind === "bullet" || x.kind === "entry"; });
    var skillRows = rows.filter(function (x) { return x.kind === "skill" || x.kind === "selfeval"; });

    var strong = [], skillOnly = [], absent = [];
    terms.forEach(function (t) {
      function scan(list) {
        var found = [];
        list.forEach(function (x) {
          var hit = "";
          if (x.text.indexOf(t.word) !== -1) hit = t.word;
          else if (t.via !== t.word && x.text.indexOf(t.via) !== -1) hit = t.via;
          if (hit) found.push({ no: x.lineNo, via: hit });
        });
        return found;
      }
      var inContent = scan(contentRows);
      var inSkill = scan(skillRows);
      var all = inContent.concat(inSkill);
      var via = (all.filter(function (f) { return f.via !== t.word; })[0] || {}).via || "";
      var item = { word: t.word, weight: t.weight, via: via, lines: all.map(function (f) { return f.no; }) };
      if (inContent.length) strong.push(item);
      else if (inSkill.length) skillOnly.push(item);
      else absent.push(item);
    });

    strong.sort(function (a, b) { return b.weight - a.weight; });
    skillOnly.sort(function (a, b) { return b.weight - a.weight; });
    absent.sort(function (a, b) { return b.weight - a.weight; });

    /* 展示层去噪：n-gram 抽取会切出「户运」「长模」这种碎片，单个字母（R、C）也不是
       用户能照着补的词。只压缩展示，不动覆盖率口径 —— 口径用的是引擎原始统计 */
    var every = strong.concat(skillOnly, absent);
    function keep(it) {
      if (/^[A-Za-z]$/.test(it.word)) return false;
      if (!it.word.trim()) return false;
      var frag = every.some(function (o) {
        return o !== it && o.word.length > it.word.length && o.word.indexOf(it.word) !== -1 &&
          it.word.length <= 2;
      });
      return !frag;
    }
    strong = strong.filter(keep);
    skillOnly = skillOnly.filter(keep);
    absent = absent.filter(keep);

    var shown = strong.length + skillOnly.length + absent.length;

    /* 每行对上了哪些 JD 词 —— 行内芯片用 */
    rows.forEach(function (x) {
      x.jd = strong.filter(function (s) { return s.lines.indexOf(x.lineNo) !== -1; })
        .map(function (s) { return s.word; });
    });

    return { strong: strong, skillOnly: skillOnly, absent: absent, total: shown, rawTotal: terms.length };
  }

  /* =========================================================
   * 13.8 答案质检：你说一声，我判一句
   *   只判「这个答案还缺什么」，不替你写答案。
   *   组装只用你答过的字，不新增事实。
   * ========================================================= */

  var ANSWER_HEDGE = ["大概", "估计", "好像", "可能", "差不多", "应该有", "似乎是", "记不清", "忘了", "左右", "上下"];
  var ANSWER_VAGUE = ["挺好的", "还不错", "比较多", "不少", "很多", "大幅", "显著", "明显", "有效", "积极", "顺利"];
  var ANSWER_TEAM = ["我们", "团队一起", "大家一起", "协助", "配合", "参与"];
  var ANSWER_ABS = ["所有", "全部", "每一个", "任何", "第一", "最好", "最强", "唯一", "零失误", "完美"];

  var ARCH_SCALE_HINT = {
    结果: "用户数 / 单量 / 活动参与",
    工程: "QPS / 数据量 / 产线规模",
    规范: "账套 / 合同量 / 人数",
    表达: "项目数 / 学生数 / 作品数",
    通用: "规模"
  };

  function checkAnswer(input) {
    var ans = String((input && input.answer) || "").trim();
    var kind = (input && input.kind) || "";
    var rowText = (input && input.rowText) || "";
    var arch = (input && input.arch) || "通用";

    var out = {
      ok: ans.length >= 2,
      score: 60, verdict: "", missing: [], flags: [], followups: [], assembled: "", note: ""
    };

    if (ans.length < 2) {
      out.score = 0;
      out.verdict = "还没答";
      out.note = "空着不算错 —— 想不出来就先留着，不要为了好看填一个估计数。";
      return out;
    }

    var nums = ans.match(/\d+(?:\.\d+)?%?|\d+[万千百亿]?/g) || [];
    var hasNum = nums.length > 0;
    var hasPair = nums.length >= 2 || /从\s*\d.*?(?:到|→|提升到|涨到|涨至)\s*\d/.test(ans);
    var hasScaleUnit = /人|个|家|单|条|次|万|千|百|元|块|SKU|款|场|篇|份|张|台|店/.test(ans);

    function add(key, why, ask) { out.missing.push({ key: key, why: why, ask: ask }); }

    var vagueHit = hitsOf(ans, ANSWER_VAGUE);
    if (vagueHit.length) {
      out.flags.push({
        kind: "vague", word: vagueHit[0],
        why: "形容词不是证据：「" + vagueHit[0] + "」后面必须跟一个数或一件具体事"
      });
    }

    var hedgeHit = hitsOf(ans, ANSWER_HEDGE);
    if (hedgeHit.length) {
      out.flags.push({
        kind: "hedge", word: hedgeHit[0],
        why: "「" + hedgeHit[0] + "」一出口，面试官就会追着核 —— 要么给准确数，要么直说「这个数我当时没记，我记得的是…」"
      });
      add("准确数", "带「" + hedgeHit[0] + "」说明你自己也不确定，这种答案进简历就是给自己埋雷",
        "准确数是多少？记不得就说清统计口径和区间，不要给假精确。");
    }

    var teamHit = hitsOf(ans, ANSWER_TEAM);
    if (teamHit.length && !/(我独立|我负责|我主导|我牵头|由我)/.test(ans)) {
      out.flags.push({
        kind: "boundary", word: teamHit[0],
        why: "「" + teamHit[0] + "」听着像团队成果，没写清你那一块"
      });
      add("你的那一块", "团队成果不算个人成绩，面试官一定会切开问", "这件事里哪一步是你做的？别人做的是哪一步？");
    }

    var absHit = hitsOf(ans, ANSWER_ABS);
    if (absHit.length) {
      out.flags.push({
        kind: "absolute", word: absHit[0],
        why: "「" + absHit[0] + "」这种绝对词，只要有一个反例就会被记住"
      });
    }

    if (hasNum && /%/.test(ans) && !hasPair) {
      add("改前 / 改后", "只有现在这个百分比，没有起点，涨幅算不出来", "这是做完之后的数，那做之前是多少？");
    }
    if (hasNum && !hasScaleUnit) {
      add("单位 / 口径", "数字没带单位，读者只能猜是人数还是单量", "这个数指的是什么？人数、单量，还是金额？");
    }
    if (!hasNum && /结果|规模|占比|频率/.test(kind)) {
      add("一个数", "没有数，回答还是「在忙」", "这件事能被数出来的那部分是什么？哪怕给个区间也行。");
    }

    var anchors = (rowText.match(/[\u4e00-\u9fa5]{2,4}/g) || []).slice(0, 10);
    var onTopic = anchors.some(function (w) { return ans.indexOf(w) !== -1; });
    if (!onTopic && !hasNum) {
      out.flags.push({ kind: "offtopic", word: "", why: "这段话和这一行几乎对不上，面试官会觉得你在答别的问题" });
    }

    out.score = clamp(out.score - out.missing.length * 14 - out.flags.length * 9 +
      (hasPair ? 18 : 0) + (hasNum ? 8 : 0), 0, 100);

    if (out.score >= 80) out.verdict = "能答了";
    else if (out.score >= 55) out.verdict = "答了一半";
    else out.verdict = "还得补";

    if (out.missing.length) {
      out.followups = out.missing.slice(0, 2).map(function (x) { return x.ask; });
    } else {
      var hint = ARCH_SCALE_HINT[arch] || "";
      if (hint) out.followups = ["再确认一句：这块你手上有「" + hint + "」里的哪个数？"];
    }

    var base = rowText.replace(/^[-*·•\s]+/, "").trim();
    var pieces = [];
    if (base) pieces.push(base);
    ans.split(/[，,。；;]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) {
      if (base.indexOf(s) === -1) pieces.push(s);
    });
    out.assembled = pieces.join("，");

    out.note = out.missing.length
      ? "还差 " + out.missing.length + " 项：" + out.missing.map(function (x) { return x.key; }).join("、") +
        "。补上这些，这句话就能进简历。"
      : (out.flags.length
        ? "口径齐了，但有 " + out.flags.length + " 处措辞会被追问 —— 先把措辞改掉再放进简历。"
        : "齐了。进简历时把时间范围一起写上，别单独留一句。");
    return out;
  }

  /* =========================================================
   * 13.9 今日清单：把「该动什么」变成能划掉的一列
   * ========================================================= */

  function buildChecklist(o, limit) {
    var cap = limit || 8;
    var items = [];
    var seenText = {};

    function push(it) {
      var k = String(it.text).replace(/\s+/g, "");
      if (seenText[k]) return;
      /* 同一行同一件事只在清单里出现一次 */
      var sameLine = it.lineNo && items.some(function (x) {
        return x.lineNo === it.lineNo && x.kind === it.kind;
      });
      if (sameLine) return;
      seenText[k] = 1;
      items.push(it);
    }

    (o.topActions || []).forEach(function (a) {
      push({
        id: "act-" + (a.lineNo || a.kind) + "-" + a.kind,
        text: a.title,
        detail: a.doThis,
        lineNo: a.lineNo, kind: a.kind
      });
    });

    /* 追问只挑措辞不同的三条：同样的骨架重复四遍，清单就废了 */
    var askTexts = {};
    (o.asks || []).filter(function (a) { return a.risk >= 3; }).forEach(function (a) {
      if (items.filter(function (x) { return x.kind === "ask"; }).length >= 3) return;
      var qk = a.question.slice(0, 8);
      if (askTexts[qk]) return;
      askTexts[qk] = 1;
      push({
        id: "ask-" + a.lineNo + "-" + a.question.slice(0, 10),
        text: "想好这一问怎么答：" + a.question,
        detail: "答法：" + a.skeleton,
        lineNo: a.lineNo, kind: "ask"
      });
    });

    (o.cuts || []).slice(0, 2).forEach(function (c) {
      push({
        id: "cut-" + (c.lineNo || "doc") + "-" + String(c.what).slice(0, 8),
        text: "删 / 改：" + c.what,
        detail: c.fix,
        lineNo: c.lineNo, kind: "cut"
      });
    });

    return items.slice(0, cap);
  }

  /* =========================================================
   * 14. Markdown 报告
   * ========================================================= */

  function toMarkdown(o) {
    var L = [];
    var meta = o.meta || {};
    L.push("# 简历深审报告 · 七项体检");
    L.push("");
    L.push("> 引擎 AuditEngine " + o.version + "（离线规则层）· " +
      meta.kind + " / " + meta.family + " / " + meta.industry +
      " · 有效 " + meta.rows + " 行 · " + meta.chars + " 字");
    L.push("");
    L.push("## 一、总评");
    L.push("");
    L.push("**" + o.overall + " / 100（" + o.level + " 档）** —— " + o.headline);
    L.push("");
    L.push("| 维度 | 分数 | 说明 |");
    L.push("| --- | --- | --- |");
    (o.dims || []).forEach(function (d) {
      L.push("| " + d.name + " | " + d.score + " | " + d.desc + "；" + d.note + " |");
    });
    L.push("");
    L.push("统计：会被追问 " + o.counts.asks + " 处（高危 " + o.counts.highAsks + "）· 该删 " +
      o.counts.cuts + " 处 · 该补 " + o.counts.adds + " 处 · 逻辑问题 " + o.counts.logic + " 处 · 语言命中 " + o.counts.toneHits + " 处");
    L.push("");

    L.push("## 二、先动这三条（按投入产出排，不按严重程度排）");
    L.push("");
    if (!o.topActions || !o.topActions.length) {
      L.push("没有需要立刻动手的地方 —— 逐行看完下面几张表就行。");
    } else {
      o.topActions.forEach(function (a) {
        L.push("**" + a.rank + ". " + a.title + "**" +
          (a.lineNo ? "（第 " + a.lineNo + " 行）" : "（整份）") + " · " + a.impactText);
        L.push("");
        if (a.excerpt) L.push("- 原文：" + a.excerpt);
        L.push("- 为什么先动它：" + a.why);
        L.push("- 怎么做：" + a.doThis);
        L.push("");
      });
    }

    L.push("## 三、每一处会被追问的地方（按风险排序）");
    L.push("");
    if (!o.asks.length) L.push("没有生成追问点 —— 这份简历信息密度太低，先按第四节把内容补起来。");
    o.asks.slice(0, 30).forEach(function (a, i) {
      L.push("**" + (i + 1) + ". [" + a.kind + " · 风险 " + a.risk + "] 第 " + a.lineNo + " 行** " + a.question);
      L.push("");
      L.push("- 原文：" + a.excerpt);
      L.push("- 答法：" + a.skeleton);
      L.push("");
    });

    L.push("## 四、写得够不够细");
    L.push("");
    (o.rows || []).filter(function (x) { return x.kind === "bullet" || x.kind === "entry"; }).forEach(function (x) {
      L.push("- 第 " + x.lineNo + " 行【" + x.detail.verdict + " · " + x.detail.score + " 分】" + x.excerpt);
      if (x.detail.note) L.push("  - " + x.detail.note);
      if (x.pattern && x.pattern.sentence) L.push("  - 照这个填：" + x.pattern.sentence);
      if (x.pattern && x.pattern.verbFix) L.push("  - 动词：" + x.pattern.verbFix);
    });
    L.push("");

    L.push("## 五、真实性与口径");
    L.push("");
    var risky = (o.rows || []).filter(function (x) { return x.truth.risks.length; });
    if (!risky.length) L.push("没有发现明显的可信度风险。");
    risky.forEach(function (x) {
      x.truth.risks.forEach(function (r) {
        L.push("- 第 " + x.lineNo + " 行【" + r.name + "】" + r.why);
        L.push("  - 改法：" + r.fix);
      });
    });
    L.push("");

    L.push("## 六、该补什么");
    L.push("");
    (o.addsDoc || []).forEach(function (a) {
      L.push("- **" + a.what + "**：" + a.why);
      L.push("  - 怎么写：" + a.example);
    });
    (o.adds || []).forEach(function (a) {
      L.push("- 第 " + a.lineNo + " 行 **" + a.what + "**：" + a.why);
      L.push("  - 怎么写：" + a.example);
    });
    L.push("");
    L.push("没有数字时的补法顺序（可信度从高到低）：");
    (o.ladder || []).forEach(function (x, i) {
      L.push((i + 1) + ". " + x.name + "：" + x.ex);
    });
    L.push("");

    /* 职能族：换权重 + 一条硬门槛 */
    if (o.meta && o.meta.familyArch) {
      L.push("**职能族口径（" + o.meta.family + " · " + o.meta.familyArch + "型）**：" +
        o.meta.familyLook + "；盘子口径写 " + o.meta.familyScale + "。");
      if (o.meta.familyGate) L.push("- 硬门槛：" + o.meta.familyGate + "（这条卡住，其它维度再高也不加分）。");
      L.push("");
    }

    /* JD 逐条落位：只做关键词映射，不做语义联想 */
    if (o.jdMap) {
      L.push("**JD 逐条落位**（" + o.jdMap.total + " 个岗位词）");
      L.push("");
      L.push("- 正文有人接（" + o.jdMap.strong.length + "）：" +
        (o.jdMap.strong.map(function (x) {
          return x.word + "（第 " + x.lines.join("/") + " 行）";
        }).join("、") || "无"));
      L.push("- 只在技能区躺着（" + o.jdMap.skillOnly.length + "）：" +
        (o.jdMap.skillOnly.map(function (x) { return x.word; }).join("、") || "无") +
        " —— 技能区写了但正文没有证据，面试官一问就穿");
      L.push("- 全文没提（" + o.jdMap.absent.length + "）：" +
        (o.jdMap.absent.map(function (x) { return x.word; }).join("、") || "无") +
        " —— 只有你真做过，才把它写进对应的经历里");
      L.push("");
    }

    L.push("## 七、该删什么");
    L.push("");
    if (!o.cuts.length) L.push("没有明显该删的内容。");
    o.cuts.forEach(function (c) {
      L.push("- " + (c.lineNo ? "第 " + c.lineNo + " 行 " : "") + "**" + c.what + "**：" + c.why);
      L.push("  - 怎么处理：" + c.fix);
    });
    L.push("");

    L.push("## 八、语言与 AI 味");
    L.push("");
    if (o.toneDoc && o.toneDoc.hits.length) {
      L.push("**整篇指纹**");
      L.push("");
      o.toneDoc.hits.forEach(function (h) { L.push("- " + h.word + "：" + h.fix); });
      L.push("");
    }
    var toned = (o.rows || []).filter(function (x) { return x.tone.hits.length; });
    if (!toned.length) L.push("逐行没有命中行话 / 形容词 / AI 句式。");
    toned.forEach(function (x) {
      L.push("- 第 " + x.lineNo + " 行：" + x.excerpt);
      x.tone.hits.forEach(function (h) {
        L.push("  - 【" + h.groupName + "】" + h.word + " → " + h.fix);
      });
      if (x.strip) L.push("  - 删词后近似：" + x.strip);
    });
    L.push("");

    L.push("## 九、逻辑与结构");
    L.push("");
    if (!o.logic.length) L.push("时间线、主题、技能与经历之间没有发现冲突。");
    o.logic.forEach(function (l) {
      L.push("- " + (l.lineNo ? "第 " + l.lineNo + " 行 " : "") + "**" + l.title + "**：" + l.why);
      L.push("  - 怎么改：" + l.fix);
    });
    L.push("");
    L.push("## 十、今日清单（打印这一节，照着划掉）");
    L.push("");
    (o.checklist || []).forEach(function (c, i) {
      L.push("- [ ] " + (i + 1) + ". " + c.text + (c.lineNo ? "（第 " + c.lineNo + " 行）" : ""));
      if (c.detail) L.push("  - " + c.detail);
    });
    L.push("");
    L.push("---");
    L.push("报告由本地离线引擎生成：只重排事实，不新增事实。带括号的示例都要换成你自己的真实经历。");
    return L.join("\n");
  }

  global.AuditEngine = {
    VERSION: VERSION,
    audit: audit,
    toMarkdown: toMarkdown,
    checkAnswer: checkAnswer,
    buildChecklist: buildChecklist,
    // 暴露给测试与调参：词表改了先看这里
    internals: {
      toneOf: toneOf, truthOf: truthOf, detailOf: detailOf, patternOf: patternOf,
      classifyLines: classifyLines, TONE_GROUPS: TONE_GROUPS, TRUTH_RULES: TRUTH_RULES,
      CUT_DOC_RULES: CUT_DOC_RULES, LADDER: LADDER,
      FAMILY_PROFILE: FAMILY_PROFILE, ARCH_WEIGHTS: ARCH_WEIGHTS, jdRowMap: jdRowMap
    }
  };

})(typeof window !== "undefined" ? window : globalThis);