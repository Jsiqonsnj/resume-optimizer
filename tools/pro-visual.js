/* pro-visual.js — 用几何量代替肉眼：检查三页（审阅 / 优化 / 规划）的排版
   检查项：卡片顺序 / 相互重叠 / 文字被截断 / 零高卡片 / 横向溢出 / 字号层级
   用法：node tools/pro-visual.js */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9344;
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    require("http").get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function waitForTargets(timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* 等 */ }
    await sleep(300);
  }
  throw new Error("CDP 目标未就绪");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return {
    ready,
    send(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    },
    close() { ws.close(); }
  };
}

/* 每页看哪些容器 / 卡片 */
const PAGES = {
  scan: {
    ids: ["proHead", "proCard", "questionsCard", "proWrap", "layerCard", "strengthCard", "probeCard", "formatCard"],
    roots: "#panel-scan #proWrap, #panel-scan #questionsCard, #panel-scan #formatCard",
    unitsSel: "#panel-scan .layer, #panel-scan .probe",
    sizes: [".card-title", ".layer-title", ".pro-dim-note", ".pro-score strong"]
  },
  optimize: {
    ids: ["optWrap", "rewriteCard", "optList", "planCard", "exportCard", "jdCard"],
    roots: "#panel-optimize #optWrap, #panel-optimize #jdCard",
    unitsSel: "#panel-optimize .opt-item, #panel-optimize .plan-item",
    sizes: [".card-title", ".opt-quote", ".opt-ask-q", ".opt-rewritten"]
  },
  plan: {
    ids: ["planWrap", "planCardMain", "planBody", "pitchCard", "introCard"],
    roots: "#panel-plan #planWrap",
    unitsSel: "#panel-plan .plan-block, #panel-plan .plan-col",
    sizes: [".card-title", ".plan-block-head h3", ".plan-col-note", ".pitch-line"]
  }
};

const probe = (page) => `(() => {
  const cfg = ${JSON.stringify(PAGES)}[${JSON.stringify(page)}];
  const rect = el => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };

  const cards = cfg.ids.map(id => {
    const el = document.getElementById(id);
    if (!el) return { id, missing: true };
    const r = rect(el);
    const cs = getComputedStyle(el);
    return { id, ...r, hidden: el.hidden || cs.display === 'none',
             opacity: cs.opacity, order: Math.round(el.getBoundingClientRect().top + window.scrollY) };
  }).filter(c => !c.missing && !c.hidden && c.h > 0);

  // 文字截断：overflow 非 visible 且 scrollHeight 明显大于 clientHeight 的叶子节点
  const clipped = [];
  document.querySelectorAll(cfg.roots).forEach(root => {
    root.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'visible' && cs.overflowY === 'visible') return;
      // 视觉隐藏工具类与表单控件（textarea 自带滚动）不算截断
      if (el.classList.contains('sr-only')) return;
      if (/^(TEXTAREA|INPUT|SELECT)$/.test(el.tagName)) return;
      if (el.scrollHeight - el.clientHeight > 3 && el.clientHeight > 0 && el.children.length === 0) {
        clipped.push({ cls: String(el.className || el.tagName).slice(0, 30), tag: el.tagName,
          scrollH: el.scrollHeight, clientH: el.clientHeight, text: (el.textContent || '').slice(0, 24) });
      }
    });
  });

  // 卡片重叠：跳过包裹层（*Wrap / *Head / *Body / *List 包住子卡）
  const isWrap = id => /(Head|Wrap|Body|List)$/.test(id);
  const overlaps = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      if (isWrap(a.id) || isWrap(b.id)) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 4 && oy > 4) overlaps.push([a.id, b.id, ox, oy]);
    }
  }

  // 页内块状单元（优化页的问答卡、规划页的区块）不能有零高的
  const units = [...document.querySelectorAll(cfg.unitsSel)]
    .map(el => Math.round(el.getBoundingClientRect().height));

  const sizes = {};
  cfg.sizes.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) sizes[sel] = getComputedStyle(el).fontSize;
  });

  return {
    cards: cards.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, order: c.order })),
    overlaps, clipped: clipped.slice(0, 8), units, sizes,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    pageH: Math.round(document.getElementById('panel-' + ${JSON.stringify(page)}).getBoundingClientRect().height)
  };
})()`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-pv-"));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile, "--window-size=1440,1400", PAGE
  ], { stdio: "ignore" });

  const page = await waitForTargets();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Page.reload");
  await sleep(1200);

  const evaluate = async (expression) => {
    const res = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception));
    return res.result.value;
  };

  await evaluate(`(() => { localStorage.clear(); return 1; })()`);
  await evaluate(`(() => { App.setTab('upload'); document.getElementById('btnLoadDemo').click(); return 1; })()`);
  await sleep(1000);
  await evaluate(`(() => { const b = document.getElementById('btnScanSkip'); if (b && !b.hidden) b.click(); return 1; })()`);
  await sleep(1600);

  let bad = 0;
  for (const width of [1440, 390]) {
    if (width === 390) {
      await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await sleep(400);
      await evaluate('(window.dispatchEvent(new Event("resize")), 1)');
      await sleep(600);
    }
    console.log(`\n===== ${width} 宽 =====`);
    for (const name of Object.keys(PAGES)) {
      await evaluate(`(() => { App.setTab('${name}'); window.scrollTo(0, 0); return 1; })()`);
      await sleep(350);
      const r = await evaluate(probe(name));
      const zeroUnits = (r.units || []).filter((h) => h <= 0).length;
      const ok = r.docOverflow <= 1 && r.overlaps.length === 0 && r.clipped.length === 0 && zeroUnits === 0;
      if (!ok) bad++;
      console.log(`[${ok ? "OK  " : "BAD "}] ${name}  高 ${r.pageH}  卡 ${r.cards.length} 块  ` +
        (r.units.length ? `单元 ${r.units.length}(零高 ${zeroUnits})  ` : "") +
        `溢出 ${r.docOverflow}  重叠 ${r.overlaps.length}  截断 ${r.clipped.length}`);
      if (!ok) console.log(JSON.stringify(r, null, 2));
      else console.log("     字号 " + JSON.stringify(r.sizes) + "  顺序 " + r.cards.map((c) => c.id).join("→"));
    }
  }

  client.close();
  proc.kill();
  console.log(bad ? "\nLAYOUT 有问题：" + bad + " 处" : "\nLAYOUT OK（审阅 / 优化 / 规划 × 桌面 / 窄屏）");
  if (bad) process.exitCode = 1;
})();