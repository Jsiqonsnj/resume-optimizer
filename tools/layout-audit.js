/* 布局审计：逐 Tab 检查横向溢出、元素重叠、关键区块尺寸。
   用法：node tools/layout-audit.js */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9336;
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
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* not ready */ }
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
    send: (method, params) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    }),
    close: () => ws.close()
  };
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-audit-"));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile, "--window-size=1440,1200", PAGE
  ], { stdio: "ignore" });

  const page = await waitForTargets();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await sleep(800);

  const evaluate = async (expression) => {
    const res = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result.value;
  };

  // 先造一份内容，让上传页处于"已载入"状态
  await evaluate(`(() => {
    App.setResume(Engine.FAKE_SAMPLE_RESUME, { source: 'paste' });
    App.setIndustry({ category: '互联网', sub: '后端' });
    return 1;
  })()`);
  await sleep(200);

  const tabs = ["upload", "knowledge", "scan", "optimize", "plan"];
  let bad = 0;

  for (const tab of tabs) {
    const r = await evaluate(`(() => {
      App.setTab(${JSON.stringify(tab)});
      const panel = document.querySelector('.panel.is-active');
      // 装饰层（笔、墨迹、气泡、涟漪）允许溢出，不算内容溢出
      const DECOR = ['pen', 'ink-layer', 'hr-bubble', 'tap-ripple'];
      const isDecor = (n) => DECOR.some(c => n.classList && n.classList.contains(c));
      const offenders = [...panel.querySelectorAll('*')].filter(n => {
        if (isDecor(n)) return false;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        return n.scrollWidth > n.clientWidth + 2 && (cs.overflowX === 'visible');
      }).slice(0, 6).map(n => ({ cls: (n.className || n.tagName).toString().slice(0, 40),
                                sw: n.scrollWidth, cw: n.clientWidth }));
      const rects = [...panel.querySelectorAll('.card, .dropzone, .textarea, .chips, .industry-cards')]
        .slice(0, 14).map(n => { const r = n.getBoundingClientRect();
          return { cls: (n.className || '').toString().split(' ')[0] || n.tagName,
                   x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }; });
      return {
        tab: ${JSON.stringify(tab)},
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        panelH: Math.round(panel.getBoundingClientRect().height),
        offenders, rects,
        h1: panel.querySelector('h1') ? panel.querySelector('h1').textContent : ''
      };
    })()`);
    console.log(JSON.stringify(r, null, 2));
    if (r.docOverflow > 0 || r.offenders.length) bad++;
  }

  // 窄屏（手机）再跑一遍
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await sleep(400);
  for (const tab of ["upload", "knowledge", "scan"]) {
    const r = await evaluate(`(() => {
      App.setTab(${JSON.stringify(tab)});
      const panel = document.querySelector('.panel.is-active');
      return { tab: ${JSON.stringify(tab)},
               docOverflow: document.documentElement.scrollWidth - window.innerWidth,
               panelH: Math.round(panel.getBoundingClientRect().height),
               navMode: getComputedStyle(document.querySelector('.sidenav')).flexDirection };
    })()`);
    console.log("MOBILE " + JSON.stringify(r));
    if (r.docOverflow > 0) bad++;
  }

  client.close();
  proc.kill();
  console.log(bad ? "LAYOUT ISSUES: " + bad : "LAYOUT OK");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });