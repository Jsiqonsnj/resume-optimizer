/* 阶段 0 的离线自检：在 Node 里模拟 window，跑 engine 的契约校验。
   用法：node tools/selftest.js   （不需要任何依赖） */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "js", "engine.js"), "utf8");

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  Promise,
  JSON,
  Math,
  Number,
  Object,
  Array,
  String
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "js/engine.js" });

(async () => {
  const report = await sandbox.Engine.selfTest({ industry: "互联网-后端" });
  const lines = report.input.resume.split(/\r\n|\r|\n/);

  console.log("engine:", sandbox.Engine.VERSION, "mode:", sandbox.Engine.MODE);
  console.log("issues:", report.result.issues.length, "score:", report.result.score);
  console.log("jdGaps:", report.result.jdGaps.length, "suggestions:", report.result.suggestions.length);
  console.log("refine.rewritten:", report.refined.rewritten);
  console.log("refine.advice:", report.refined.advice);
  console.log("---- 逐条定位 ----");
  for (const it of report.result.issues) {
    const line = lines[it.lineIndex] || "";
    console.log(
      `L${it.lineIndex + 1} [${it.type}] "${it.excerpt}" in "${line}" -> ${line.includes(it.excerpt)}`
    );
  }
  console.log("---- 校验 ----");
  console.log("resultCheck:", report.resultCheck);
  console.log("refineCheck:", report.refineCheck);
  console.log(report.ok ? "SELFTEST OK" : "SELFTEST FAILED");
  process.exit(report.ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});