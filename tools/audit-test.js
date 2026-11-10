/* =========================================================
 * audit-test.js — 七项深审引擎的离线验收
 * ---------------------------------------------------------
 * 只跑规则层，不开浏览器；断言的是「契约」不是「文案」：
 *   - 七维评分齐全且在 0~100
 *   - 每一行都给了七项判断，且 excerpt 能在原行定位
 *   - 追问点带答法骨架；风险 3 的问题必须真的存在（不许空喊）
 *   - 好简历分数 > 示例简历 > 空心简历（排序不能反）
 *   - Markdown 报告八节齐全
 *
 *   node tools/audit-test.js            # 跑全部
 *   node tools/audit-test.js --dump     # 额外把完整结果写到 tools/audit-test-report.txt
 * ========================================================= */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ENGINE = [
  "lexicon.data.js", "parse.js", "signals.js", "profile.js", "jd-match.js",
  "diagnose.js", "rewrite.js", "interview.js", "score.js", "report.js", "review.js"
];

function load() {
  const sandbox = {
    console,
    document: {
      readyState: "complete",
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ENGINE) {
    const p = path.join(ROOT, "js", "engine-resume", f);
    vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: p });
  }
  const demoP = path.join(ROOT, "js", "demo-resume.js");
  vm.runInContext(fs.readFileSync(demoP, "utf8"), sandbox, { filename: demoP });
  const auditP = path.join(ROOT, "js", "engine-audit.js");
  vm.runInContext(fs.readFileSync(auditP, "utf8"), sandbox, { filename: auditP });
  return sandbox;
}

/* ---------------- 三份靶子 ---------------- */
const DEMO = null; // 从引擎里取

const GOOD = [
  "赵敏 | 用户运营 | 13900001111 | zhaomin@example.com | 上海",
  "求职意向：用户运营（增长方向）",
  "教育背景",
  "2015.09-2019.06 XX大学 统计学（本科） 专业排名 8/120",
  "工作经历",
  "2021.04-至今 YY科技 用户增长运营",
  "- 负责 2 条业务线的用户分层与生命周期管理，覆盖 46 万注册用户，按 RFM 拆 7 层并每月校准一次标签口径",
  "- 用神策埋点重建注册到首单的 5 步漏斗，定位到实名环节流失 38%，改版后该环节完成率从 52% 提到 71%（4 周，A/B 各 1.2 万流量）",
  "- 主导召回策略迭代：短信 + 站内信的 3 组文案与 2 档券面额做正交测试，30 天召回率从 6.4% 提到 9.1%，单用户成本从 3.2 元降到 2.4 元",
  "- 带 2 名运营专员，负责周会评审与实验看板，把实验上线周期从 10 天压到 4 天",
  "2019.07-2021.03 XX电商 类目运营",
  "- 管理 3 个天猫店共 1200 个 SKU 的排期与活动报名，年 GMV 约 2400 万",
  "- 用竞品价格表做每周调价，主推款毛利率从 18% 提到 22%（口径：后台毛利报表，6 个月均值）",
  "项目经历",
  "2023.03-2023.09 「老带新」裂变项目 项目负责人",
  "- 负责整体方案与预算（12 万），设计三级奖励阶梯，活动期新增注册 3.1 万，邀请转化率 14.6%，ROI 1.8",
  "技能证书",
  "SQL：日常写多表关联做留存与分层分析，最长跑过 800 万行；神策：埋点设计与看板搭建；Excel：透视表 + Power Query",
  "CET-6（560 分）"
].join("\n");

const HOLLOW = [
  "李四 | 男 | 未婚 | 1999.11 | 13800002222 | 籍贯山东 | 身高 175",
  "求职意向：运营",
  "教育背景",
  "2018.09-2022.06 某大学 工商管理",
  "工作经历",
  "2022.07-至今 某公司 运营专员",
  "- 负责日常运营工作",
  "- 参与各类活动，协助团队完成相关任务",
  "- 完成领导交办的其他工作",
  "自我评价：本人性格开朗，沟通能力强，工作认真负责，有较强的学习能力和团队协作能力，能够承受一定的工作压力，希望在运营方向长期发展，为公司创造价值。",
  "兴趣爱好：旅游、音乐、看电影"
].join("\n");

const AIISH = [
  "王五 | 数据分析师 | wangwu@example.com | 13600003333",
  "核心优势：具备全链路数据赋能能力，擅长以数据为抓手驱动业务闭环，拥有极强的跨部门协同与底层逻辑拆解能力",
  "工作经历",
  "2021.03-至今 某互联网公司 数据分析师",
  "- 致力于通过搭建数据中台体系，实现对业务的全方位赋能，有效提升整体运营效率，助力业务高质量发展",
  "- 围绕用户增长模型展开深度分析，不仅完成多维度指标体系搭建，而且持续推动数据驱动的精细化运营落地",
  "- 对核心报表进行了系统性优化升级，实现了数据处理效率的显著提升，为公司创造价值",
  "- 深度参与跨部门项目，充分发挥数据专业优势，打造高效、稳定、可靠的数据支撑体系，全面提升决策效率 300%",
  "技能证书：精通 Python、SQL、Tableau、PowerBI、R、Excel"
].join("\n");

/* ---------------- 断言 ---------------- */
let pass = 0, fail = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { pass++; return true; }
  fail++; fails.push(msg);
  return false;
}

function checkShape(res, label, text) {
  ok(res && res.ok, `${label}: audit 返回 ok`);
  if (!res || !res.ok) return;

  ok(res.dims.length === 7, `${label}: 七维齐全（实际 ${res.dims.length}）`);
  res.dims.forEach(d => ok(d.score >= 0 && d.score <= 100, `${label}: 维度 ${d.name} 分数越界 ${d.score}`));
  ok(res.overall >= 0 && res.overall <= 100, `${label}: 总分越界`);
  ok(["A", "B", "C", "D"].includes(res.level), `${label}: 档位合法`);

  const lines = text.split("\n");
  let badAnchor = 0, noAsk = 0;
  res.rows.forEach(r => {
    if (lines[r.line] == null || lines[r.line].indexOf(r.text) === -1) badAnchor++;
    if (!Array.isArray(r.ask) || r.ask.length === 0) noAsk++;
    ok(r.detail && typeof r.detail.verdict === "string", `${label}: 第 ${r.lineNo} 行有详细度判断`);
    ok(r.truth && Array.isArray(r.truth.risks), `${label}: 第 ${r.lineNo} 行有真实性判断`);
    ok(r.tone && typeof r.tone.score === "number", `${label}: 第 ${r.lineNo} 行有语言判断`);
    ok(Array.isArray(r.cut), `${label}: 第 ${r.lineNo} 行有该删判断`);
    ok(Array.isArray(r.logic), `${label}: 第 ${r.lineNo} 行有逻辑判断`);
  });
  ok(badAnchor === 0, `${label}: 每行都能在原文定位（越界 ${badAnchor}）`);
  ok(noAsk === 0, `${label}: 每行至少一条追问（缺 ${noAsk}）`);

  res.asks.forEach(a => {
    ok(a.skeleton && a.skeleton.length > 6, `${label}: 追问带答法骨架`);
    ok([1, 2, 3].includes(a.risk), `${label}: 追问风险等级合法`);
  });

  const md = res.markdown();
  ["一、总评", "二、先动这三条", "三、每一处会被追问的地方", "四、写得够不够细", "五、真实性与口径",
    "六、该补什么", "七、该删什么", "八、语言与 AI 味", "九、逻辑与结构"].forEach(h => {
      ok(md.includes(h), `${label}: 报告含「${h}」`);
    });
  ok(md.length > 1200, `${label}: 报告长度合理（${md.length}）`);

  /* 先动这三条：最多三条、必须能指回原文、必须给做法与估算 */
  ok(Array.isArray(res.topActions) && res.topActions.length <= 3,
    `${label}: 先动这三条不超过三条（${(res.topActions || []).length}）`);
  (res.topActions || []).forEach(a => {
    ok(typeof a.title === "string" && a.title.length > 3, `${label}: 动作有标题`);
    ok(typeof a.doThis === "string" && a.doThis.length > 8, `${label}: 动作「${a.title}」给了做法`);
    ok(/分（估）/.test(a.impactText || ""), `${label}: 动作「${a.title}」带收益估算`);
    if (a.lineNo != null) {
      const src = lines[a.lineNo - 1] || "";
      const frag = String(a.excerpt || "").replace(/…$/, "").trim();
      ok(frag === "" || src.indexOf(frag) !== -1, `${label}: 动作「${a.title}」锚在第 ${a.lineNo} 行`);
    }
  });

  /* 可填句式：缺的槽必须写成 [括号]，不能凭空出现原文没有的数字 */
  res.rows.filter(r => r.kind === "bullet").forEach(r => {
    ok(r.pattern && typeof r.pattern.sentence === "string", `${label}: 第 ${r.lineNo} 行有可填句式`);
    if (!r.pattern) return;
    ok(r.pattern.parts.length === 4, `${label}: 第 ${r.lineNo} 行句式四槽（动作对象/方法/规模/结果）`);
    const nums = (r.pattern.sentence.match(/\d+(?:\.\d+)?/g) || []);
    const invented = nums.filter(n => r.text.indexOf(n) === -1);
    ok(invented.length === 0, `${label}: 第 ${r.lineNo} 行句式没编数字（多出 ${invented.join(",")}）`);
    if (!r.detail.got.结果) {
      ok(r.pattern.sentence.includes("改前"), `${label}: 第 ${r.lineNo} 行缺结果时给改前改后占位`);
    }
  });
  return md;
}

/* ---------------- 主流程 ---------------- */
function main() {
  const S = load();
  const E = S.AuditEngine;
  const DEMO_TEXT = S.DEMO_RESUME.text;
  const DEMO_JD = S.DEMO_RESUME.jd;
  ok(!!E, "AuditEngine 已导出");

  const demo = E.audit(DEMO_TEXT, { jd: DEMO_JD, industry: "互联网-用户运营", jobTitle: "用户运营" });
  const good = E.audit(GOOD, {});
  const hollow = E.audit(HOLLOW, {});
  const aiish = E.audit(AIISH, {});
  const empty = E.audit("太短", {});

  const mdDemo = checkShape(demo, "示例简历", DEMO_TEXT);
  checkShape(good, "好简历", GOOD);
  checkShape(hollow, "空心简历", HOLLOW);
  checkShape(aiish, "AI 味简历", AIISH);

  ok(empty && empty.ok === false && !!empty.error, "过短输入返回错误而不是崩溃");

  /* 排序：好 > 示例 > 空心 */
  ok(good.overall > demo.overall, `好简历(${good.overall}) 应高于示例(${demo.overall})`);
  ok(demo.overall > hollow.overall, `示例(${demo.overall}) 应高于空心(${hollow.overall})`);

  /* 定向能力检查 */
  ok(demo.counts.highAsks > 0, "示例简历应抓到高危追问");
  ok(demo.cuts.length > 0, "示例简历应抓到该删内容");
  ok(demo.rows.some(r => /自我评价/.test(r.text) && r.cut.some(c => c.what === "整段自我评价")),
    "示例自我评价被判为整段删除");
  ok(demo.asks.some(a => /口径|分母|盘子|数从哪/.test(a.question)), "有数的行会追问口径");
  ok(demo.asks.some(a => a.kind === "结果"), "缺结果的行会追问结果");
  ok(demo.logic.some(l => /空窗/.test(l.title)), "空窗被识别");
  ok(demo.dims.find(d => d.key === "detail").score < good.dims.find(d => d.key === "detail").score,
    "示例详细度应低于好简历");

  ok(hollow.cuts.some(c => /隐私/.test(c.what)), "空心简历的隐私项被抓");
  ok(hollow.cuts.some(c => /兴趣爱好/.test(c.what)), "兴趣爱好被抓");
  ok(hollow.addsDoc.concat(hollow.adds).some(a => /结果|盘子|怎么做到/.test(a.what)), "空心简历该补项非空");

  ok(aiish.toneDoc.hits.length > 0 || aiish.rows.some(r => r.tone.hits.length >= 2), "AI 味简历的语言命中非空");
  ok(aiish.dims.find(d => d.key === "tone").score < 60, `AI 味简历语言分应低（${aiish.dims.find(d => d.key === "tone").score}）`);
  ok(aiish.rows.some(r => r.truth.risks.some(x => /百分比没有基线|整数太整/.test(x.name))), "300% 被标为口径风险");

  ok(good.rows.some(r => r.detail.verdict === "合适"), "好简历存在「合适」的条目");

  /* ---------------- 职能族：换权重 + 硬门槛 ---------------- */
  const SALES = [
    "王五 | 男 | 1997.06 | 13800003333 | 现居广州",
    "求职意向：销售代表",
    "工作经历",
    "2021.07-至今 某贸易公司 销售",
    "- 负责客户开发与维护，跟进订单，配合团队完成销售任务",
    "- 参与展会，协助上级处理客户投诉",
    "教育背景",
    "2017.09-2021.06 某大学 市场营销 本科"
  ].join("\n");
  const sales = E.audit(SALES, { jobTitle: "销售代表" });
  ok(sales.meta.family === "销售", `销售岗职能族识别（${sales.meta.family}）`);
  ok(sales.meta.familyArch === "结果", "销售族归入结果型");
  ok(sales.cap <= 62 && /业绩|签单|回款/.test(sales.capReason || ""),
    `销售无业绩数字 → 压到 62 以下并说明原因（${sales.cap} / ${sales.capReason}）`);

  const DESIGN = [
    "赵六 | 女 | 1998.02 | 13800004444 | 现居上海",
    "求职意向：UI 设计师",
    "工作经历",
    "2021.07-至今 某互联网公司 UI 设计师",
    "- 负责 App 界面设计与改版，配合产品完成需求，参与设计评审",
    "教育背景",
    "2016.09-2020.06 某大学 视觉传达 本科"
  ].join("\n");
  const design = E.audit(DESIGN, { jobTitle: "UI 设计师" });
  ok(design.meta.family === "设计", `设计岗职能族识别（${design.meta.family}）`);
  ok(design.cap <= 68 && /作品/.test(design.capReason || ""), "设计无作品链接 → 压分并说明");
  ok(design.addsDoc.some(a => /作品集链接/.test(a.what)), "设计该补项含作品集链接");

  const TECH = [
    "孙七 | 男 | 1996.05 | 13800005555 | 现居北京",
    "求职意向：后端开发",
    "工作经历",
    "2021.07-至今 某公司 研发",
    "- 负责接口开发与维护，配合前端联调，参与需求评审",
    "教育背景",
    "2014.09-2018.06 某大学 计算机 本科"
  ].join("\n");
  const tech = E.audit(TECH, { jobTitle: "后端开发" });
  ok(tech.meta.family === "技术", `技术岗职能族识别（${tech.meta.family}）`);
  ok(tech.cap <= 66 && /技术栈/.test(tech.capReason || ""), "技术无技术栈 → 压分并说明");

  /* 权重变了，但七维仍在 0..100，且总分仍等于加权和 */
  ["销售", "设计", "技术", "通用"].forEach(() => {});
  [demo, good, hollow, aiish, sales, design, tech].forEach(r => {
    const sum = r.dims.reduce((a, d) => a + d.score * d.weight, 0);
    ok(Math.abs(Math.round(sum) - r.rawOverall) <= 1,
      `${r.meta.family}: 总分等于加权和（${Math.round(sum)} vs ${r.rawOverall}）`);
    const wSum = r.dims.reduce((a, d) => a + d.weight, 0);
    ok(Math.abs(wSum - 1) < 0.001, `${r.meta.family}: 七维权重合计为 1（${wSum.toFixed(3)}）`);
  });

  /* ---------------- JD 行级落位 ---------------- */
  ok(demo.jdMap && demo.jdMap.total > 0, "有 JD 时产出逐条落位");
  const jd = demo.jdMap;
  ok(jd.strong.length + jd.skillOnly.length + jd.absent.length === jd.total,
    "JD 词三档互斥且不丢（" + [jd.strong.length, jd.skillOnly.length, jd.absent.length].join("+") + "）");
  const words = new Set();
  let dupWord = 0;
  jd.strong.concat(jd.skillOnly, jd.absent).forEach(x => {
    if (words.has(x.word)) dupWord++;
    words.add(x.word);
  });
  ok(dupWord === 0, "JD 词不重复出现");
  jd.strong.forEach(x => {
    x.lines.forEach(no => {
      const src = DEMO_TEXT.split("\n")[no - 1] || "";
      ok(src.includes(x.word) || (x.via && src.includes(x.via)), `${x.word} 真的落在第 ${no} 行`);
    });
  });
  ok(demo.rows.filter(r => r.jd && r.jd.length).length > 0, "行内带上对上的 JD 词");
  ok(aiish.jdMap === null, "没给 JD 时不产出落位（不臆测）");

  /* ---------------- 答案质检 ---------------- */
  const CA = E.checkAnswer;
  const emptyAns = CA({ answer: "", kind: "规模", rowText: demo.rows[0].text });
  ok(emptyAns.ok === false && emptyAns.score === 0 && /空着/.test(emptyAns.note), "空答案不判分、不逼填");

  const vagueAns = CA({ answer: "挺好的，效果不错", kind: "结果", rowText: "负责天猫店铺的日常运营与活动报名" });
  ok(vagueAns.flags.some(f => f.kind === "vague"), "形容词答案被标记");
  ok(vagueAns.score < 55, `空话答案分低（${vagueAns.score}）`);
  ok(/一个数/.test(vagueAns.missing.map(m => m.key).join("")), "缺数时要求一个数");

  const goodAns = CA({
    answer: "3 个微信社群共 1200 人，月活从 18% 提到 41%",
    kind: "结果", rowText: "负责天猫店铺的日常运营与活动报名"
  });
  ok(goodAns.score >= 80, `完整答案得高分（${goodAns.score}）`);
  ok(goodAns.missing.length === 0, "完整答案没有缺口项");
  ok(goodAns.assembled.includes("负责天猫店铺的日常运营与活动报名"), "组装句保留原行");
  ok(goodAns.assembled.includes("1200"), "组装句用用户自己给的数");
  const invented = (goodAns.assembled.match(/\d+(?:\.\d+)?/g) || [])
    .filter(n => !("3 个微信社群共 1200 人，月活从 18% 提到 41%" + "负责天猫店铺的日常运营与活动报名").includes(n));
  ok(invented.length === 0, "组装句不出现用户没给过的数字（" + invented.join(",") + "）");

  const hedgeAns = CA({ answer: "大概提升了 30% 左右", kind: "结果", rowText: "负责活动报名" });
  ok(hedgeAns.flags.some(f => f.kind === "hedge"), "「大概...左右」被判为不确定");

  const teamAns = CA({ answer: "我们团队一起完成了活动上线", kind: "结果", rowText: "负责活动落地" });
  ok(teamAns.flags.some(f => f.kind === "boundary"), "团队口径被标记");
  ok(teamAns.missing.some(m => /你的那一块/.test(m.key)), "追问你负责哪一块");

  const pctAns = CA({ answer: "做到了 41%", kind: "结果", rowText: "负责社群运营" });
  ok(pctAns.missing.some(m => /改前/.test(m.key)), "只有百分比时要求改前改后");

  const unitAns = CA({ answer: "做了 12", kind: "规模", rowText: "负责门店运营" });
  ok(unitAns.missing.some(m => /单位/.test(m.key)), "数字没单位时追问口径");

  const offAns = CA({ answer: "我觉得这个岗位挺有挑战的", kind: "规模", rowText: "负责门店陈列与库存盘点" });
  ok(offAns.flags.some(f => f.kind === "offtopic") || offAns.score < 55, "跑题答案被判");

  /* ---------------- 今日清单 ---------------- */
  ok(Array.isArray(demo.checklist) && demo.checklist.length > 0 && demo.checklist.length <= 8,
    `今日清单 1~8 条（${demo.checklist.length}）`);
  const ids = new Set();
  let dupId = 0;
  demo.checklist.forEach(c => {
    if (ids.has(c.id)) dupId++;
    ids.add(c.id);
    ok(!!c.text && c.text.length > 4, "清单条目有文本");
    ok(!!c.detail, "清单条目有做法");
  });
  ok(dupId === 0, "清单 id 不重复");

  /* ---------------- 报告新增节 ---------------- */
  ok(mdDemo.includes("十、今日清单"), "报告含今日清单");
  ok(mdDemo.includes("JD 逐条落位"), "有 JD 时报告含逐条落位");
  ok(mdDemo.includes("职能族口径"), "报告含职能族口径");
  ok(!mdDemo.includes("undefined"), "报告不出现 undefined");

  /* 字段可序列化（前端要写 localStorage） */
  try {
    JSON.stringify({ rows: demo.rows, asks: demo.asks });
    pass++;
  } catch (e) {
    fail++; fails.push("结果不可 JSON 序列化：" + e.message);
  }

  const rows = [
    ["示例简历", demo],
    ["好简历", good],
    ["空心简历", hollow],
    ["AI 味简历", aiish]
  ];
  const table = rows.map(([n, r]) => {
    const d = {};
    r.dims.forEach(x => { d[x.name] = x.score; });
    return `${n.padEnd(8)} 总分 ${String(r.overall).padStart(3)} (${r.level})  ` +
      r.dims.map(x => `${x.name} ${String(x.score).padStart(3)}`).join("  ") +
      `  | 追问 ${r.counts.asks}（高危 ${r.counts.highAsks}）· 该删 ${r.counts.cuts} · 该补 ${r.counts.adds} · 逻辑 ${r.counts.logic} · 语言命中 ${r.counts.toneHits}`;
  });

  if (process.argv.includes("--dump")) {
    const dumpPath = path.join(__dirname, "audit-test-report.txt");
    const parts = [];
    parts.push("=== 示例简历 ===");
    parts.push("总分 " + demo.overall + " " + demo.level + " · " + demo.headline);
    demo.dims.forEach(d => parts.push("  " + d.name + " " + d.score + "：" + d.note));
    parts.push("\n--- 追问（前 12） ---");
    demo.asks.slice(0, 12).forEach((a, i) => parts.push(`${i + 1}. [${a.kind}/风险${a.risk}] 第${a.lineNo}行 ${a.question}`));
    parts.push("\n--- 逐行 ---");
    demo.rows.forEach(r => {
      parts.push(`第${r.lineNo}行[${r.section}/${r.kind}] ${r.text}`);
      parts.push(`  详细度 ${r.detail.verdict}(${r.detail.score}) 缺:${r.detail.missing.join("、") || "-"} | 真实 ${r.truth.level}`);
      r.ask.forEach(a => parts.push(`  问(${a.kind}${a.risk}): ${a.question}`));
      r.add.forEach(a => parts.push(`  补: ${a.what}`));
      r.cut.forEach(c => parts.push(`  删: ${c.what}`));
      r.tone.hits.forEach(h => parts.push(`  语言[${h.groupName}]: ${h.word}`));
      r.logic.forEach(l => parts.push(`  逻辑: ${l.title}`));
    });
    parts.push("\n--- 全局该删 ---");
    demo.cuts.filter(c => !c.lineNo).forEach(c => parts.push("  " + c.what + "：" + c.why));
    parts.push("\n--- 全局该补 ---");
    demo.addsDoc.forEach(a => parts.push("  " + a.what + "：" + a.why));
    parts.push("\n--- 逻辑 ---");
    demo.logic.forEach(l => parts.push("  " + l.title + "：" + l.why));
    parts.push("\n--- 整篇语言指纹 ---");
    demo.toneDoc.hits.forEach(h => parts.push("  " + h.word + "：" + h.fix));
    parts.push("\n=== AI 味简历 ===");
    parts.push("总分 " + aiish.overall + " · 语言 " + aiish.dims.find(d => d.key === "tone").score);
    aiish.rows.forEach(r => {
      if (!r.tone.hits.length) return;
      parts.push(`第${r.lineNo}行 ${r.text.slice(0, 40)}`);
      r.tone.hits.forEach(h => parts.push(`  [${h.groupName}] ${h.word}`));
      if (r.strip && r.strip !== r.text) parts.push("  删词近似：" + r.strip);
    });
    parts.push("\n=== 空心简历 ===");
    hollow.rows.forEach(r => parts.push(`第${r.lineNo}行 ${r.text.slice(0, 30)} | 详细度 ${r.detail.verdict} | 删:${r.cut.map(c => c.what).join(",") || "-"}`));
    parts.push("\n=== 好简历 ===");
    parts.push("总分 " + good.overall + " · " + good.headline);
    good.rows.forEach(r => parts.push(`第${r.lineNo}行 [${r.detail.verdict}] ${r.text.slice(0, 46)}`));
    parts.push("\n\n" + mdDemo);
    fs.writeFileSync(dumpPath, parts.join("\n"), "utf8");
    console.log("[dump] " + dumpPath);
  }

  console.log("");
  table.forEach(t => console.log(t));
  console.log("");
  if (fail === 0) {
    console.log(`✅ 深审引擎 ${pass} 项断言全部通过`);
    return 0;
  }
  console.log(`❌ ${fail} 项未通过（通过 ${pass}）`);
  fails.slice(0, 30).forEach(f => console.log("   - " + f));
  return 1;
}

process.exit(main());