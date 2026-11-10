/* 规则引擎离线测试：node tools/rules-test.js */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sandbox = { console, setTimeout, Date, Promise, JSON, Math, Number, Object, Array, String, RegExp };
sandbox.window = sandbox;
vm.createContext(sandbox);

vm.runInContext('window.INDUSTRY_DB = {"互联网-后端": {keywords: ["高并发","分布式","微服务","压测","QPS","消息队列"]}};', sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "js", "engine-rules.js"), "utf8"), sandbox, { filename: "engine-rules.js" });

const resume = [
  "张三 | 后端开发工程师",
  "电话 138-0000-0000 | 邮箱 zs@example.com",
  "2020.07 - 2022.03  A 公司  后端工程师",
  "负责相关工作，参与业务系统的日常开发与维护。",
  "2021.03 - 2023.06  B 公司  技术专家",
  "主导订单重构，性能提升 300%，用户满意度大幅提升。",
  "工作认真负责，具备良好的团队协作能力。",
  "技能",
  "熟练掌握 Java、MySQL、Redis。"
].join("\n");

const jd = "要求精通 Go，熟悉高并发、分布式、压测与消息队列。";

(async () => {
  const r = await sandbox.RuleEngine.analyze(resume, jd, "互联网-后端", {
    kind: "docx", pages: 3, paragraphs: 40, emptyParagraphs: 16,
    fontSizes: [9, 10.5, 12, 16, 20], fonts: ["宋体", "华文彩云"]
  });

  const lines = resume.split("\n");
  console.log("score:", r.score, "issues:", r.issues.length, "format:", r.formatIssues.length);
  console.log("jdGaps:", r.jdGaps);
  let bad = 0;
  r.issues.forEach((it) => {
    const line = lines[it.lineIndex] || "";
    const ok = line.includes(it.excerpt);
    if (!ok) bad++;
    console.log(`${ok ? "OK " : "BAD"} L${it.lineIndex + 1} [${it.type}] "${it.excerpt}" in "${line}"`);
  });
  console.log("---- format ----");
  r.formatIssues.forEach((f) => console.log(`[${f.level}] ${f.label}: ${f.thought}`));
  console.log("---- suggestion ----");
  console.log(r.suggestions[0]);

  const refine = await sandbox.RuleEngine.refine(r.issues[0], { detail: "负责订单查询链路，独立重构 3 个接口", proof: "wrk 压测报告" });
  console.log("refine:", refine);

  const types = new Set(r.issues.map((i) => i.type));
  console.log("types:", [...types].join(","));
  if (bad) { console.log("EXCERPT MISMATCH:", bad); process.exit(1); }
  if (!types.has("vague") || !types.has("data-doubt") || !types.has("timeline-conflict") || !types.has("empty-desc") || !types.has("jd-mismatch")) {
    console.log("TYPE COVERAGE MISSING"); process.exit(1);
  }
  console.log("RULES OK");
})();