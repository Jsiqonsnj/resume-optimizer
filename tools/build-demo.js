/* build-demo.js — 把 tools/fixtures/demo.json 变成 js/demo-resume.js
 *
 * 为什么要多这一步：示例简历同时被两处用到 ——
 *   ① 站点里的「载入示例」按钮（前端，必须内联进 JS）
 *   ② tools/parity.py 的黄金对照（Python，读 JSON）
 * 复制两份一定会漂移，所以让 JSON 当唯一事实源。
 *
 *   node tools/build-demo.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "tools", "fixtures", "demo.json");
const OUT = path.join(ROOT, "js", "demo-resume.js");

const demo = JSON.parse(fs.readFileSync(SRC, "utf8"));

const js = `/* =========================================================
 * demo-resume.js — 自动生成，不要手改
 * 来源：tools/fixtures/demo.json（唯一事实源）
 * 重新生成：node tools/build-demo.js
 * ---------------------------------------------------------
 * 这份示例故意写得像真人：有真事、有职责，但没数、没结果、
 * 有一处空窗、有一句"精通"。引擎该抓的都在里面。
 * ========================================================= */

(function (global) {
  "use strict";

  var DEMO = ${JSON.stringify(demo, null, 2).replace(/\n/g, "\n  ")};

  global.DEMO_RESUME = DEMO;

  function init() {
    var btn = document.getElementById("btnLoadDemo");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!global.App) return;
      App.setResume(DEMO.text, {
        source: "paste",
        filename: "",
        kind: "demo",
        lines: DEMO.text.split("\\n").length,
        chars: DEMO.text.length,
        pages: 1,
        format: null
      });
      if (DEMO.jd) App.setJd(DEMO.jd);
      App.toast("已载入示例简历，正在按引擎跑一遍");
      App.setTab("scan");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
`;

fs.writeFileSync(OUT, js, "utf8");
console.log(`写入 ${OUT}  ${Buffer.byteLength(js, "utf8")} bytes`);