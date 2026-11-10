/* 把 .data-parts/part*.js 合并成 js/data.js（一次性构建脚本） */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const partsDir = path.join(root, "js", ".data-parts");
const files = ["part1.js", "part2.js", "part3.js", "part4.js"];

const merged = {};
files.forEach((f) => {
  const code = fs.readFileSync(path.join(partsDir, f), "utf8");
  const obj = eval(code);
  Object.keys(obj).forEach((k) => {
    if (merged[k]) throw new Error("重复 key: " + k);
    merged[k] = obj[k];
  });
});

const CATEGORY_ORDER = [
  "互联网", "人工智能", "金融", "快消", "零售/电商", "制造业", "汽车/新能源",
  "国企央企", "政府/事业单位", "教育", "医疗", "生物医药", "法律", "财务/会计",
  "人力资源", "咨询", "传媒/内容", "设计/创意", "建筑/地产", "物流/供应链",
  "能源/电力", "通信", "半导体", "游戏", "文旅/酒店", "农业/食品"
];

const tree = [];
CATEGORY_ORDER.forEach((category) => {
  const directions = [];
  Object.keys(merged).forEach((key) => {
    const idx = key.indexOf("-");
    const cat = key.slice(0, idx);
    const dir = key.slice(idx + 1);
    if (cat === category) directions.push(dir);
  });
  tree.push({ category, directions });
});

const missing = tree.filter((g) => !g.directions.length);
if (missing.length) throw new Error("空大类: " + missing.map((g) => g.category).join(","));

const total = tree.reduce((a, g) => a + g.directions.length, 0);

const header = `/* =========================================================
 * data.js — 行业 HR 偏好知识库（纯数据）
 * ---------------------------------------------------------
 * 结构：
 *   INDUSTRY_TREE = [{ category, directions: [] }]       两级选择器用
 *   INDUSTRY_DB   = { "大类-方向": { hrHabits, preferences, redFlags, keywords } }
 *   INDUSTRY_META = { version, categories, directions, updated }
 * 覆盖 ${tree.length} 个大类 / ${total} 个方向；知识库搜索会同时检索
 * 方向名、hrHabits、preferences、redFlags、keywords。
 * ========================================================= */

(function (global) {
  "use strict";

`;

const footer = `
  global.INDUSTRY_DB = DATA;
  global.INDUSTRY_TREE = TREE;
  global.INDUSTRY_META = { version: "2.0.0", categories: TREE.length, directions: ${total}, updated: "2026-11-10" };
})(window);
`;

const body =
  "  var DATA = " + JSON.stringify(merged, null, 2).replace(/\n/g, "\n  ") + ";\n\n" +
  "  var TREE = " + JSON.stringify(tree, null, 2).replace(/\n/g, "\n  ") + ";\n";

fs.writeFileSync(path.join(root, "js", "data.js"), header + body + footer, "utf8");

console.log("categories", tree.length, "directions", total, "keys", Object.keys(merged).length);
console.log("bytes", fs.statSync(path.join(root, "js", "data.js")).size);
console.log("sample keys", Object.keys(merged).slice(0, 3).join(" | "));