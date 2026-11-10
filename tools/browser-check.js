/* 阶段 0 的浏览器联调：用无头 Edge + CDP 打开本页，检查布局与交互。
   用法：node tools/browser-check.js */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
const SHOT_DIR = path.join(ROOT, ".preview");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    require("http").get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
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
    } catch (e) { /* 进程还没起来 */ }
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

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
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

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-ro-"));
  const proc = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile,
    "--window-size=1440,1200",
    PAGE
  ], { stdio: "ignore" });

  const page = await waitForTargets();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await sleep(900);

  const evaluate = async (expression, awaitPromise = true) => {
    const res = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error("页面脚本异常: " + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
    }
    return res.result.value;
  };

  const layout = await evaluate(`(() => {
    const rect = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const tabs = [...document.querySelectorAll('.nav-item')].map(n => {
      const r = n.getBoundingClientRect();
      return { tab: n.dataset.tab, active: n.classList.contains('is-active'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    });
    return {
      ready: document.readyState,
      title: document.title,
      engine: window.Engine ? Engine.VERSION : null,
      mode: window.Engine ? Engine.MODE : null,
      tabOrder: tabs.map(t => t.tab),
      tabX: [...new Set(tabs.map(t => t.x))],
      tabY: tabs.map(t => t.y),
      activeTab: tabs.filter(t => t.active).map(t => t.tab),
      activePanel: document.querySelector('.panel.is-active')?.dataset.panel,
      visiblePanels: [...document.querySelectorAll('.panel')].filter(p => !p.hidden && getComputedStyle(p).display !== 'none').length,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyScrollW: document.documentElement.scrollWidth,
      viewportW: window.innerWidth,
      topbar: rect('.topbar'),
      sidenav: rect('.sidenav'),
      workspace: rect('.workspace'),
      h1: document.querySelector('.panel.is-active h1')?.textContent,
      h1Rect: rect('.panel.is-active h1'),
      cards: [...document.querySelectorAll('.panel.is-active .card')].map(c => {
        const r = c.getBoundingClientRect();
        return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) };
      }),
      chip: document.getElementById('industryChipValue')?.textContent,
      overflowNodes: [...document.querySelectorAll('.panel.is-active *')]
        .filter(n => n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).overflowX === 'visible')
        .slice(0, 5)
        .map(n => n.className || n.tagName)
    };
  })()`);

  console.log("---- 布局 ----");
  console.log(JSON.stringify(layout, null, 2));

  // 切换每个 Tab，确认面板互斥
  const tabSwitch = [];
  for (const tab of ["upload", "knowledge", "scan", "optimize", "plan"]) {
    const r = await evaluate(`(() => { App.setTab(${JSON.stringify(tab)}); 
      const p = document.querySelector('.panel.is-active');
      return { tab: ${JSON.stringify(tab)}, panel: p.dataset.panel, hidden: p.hidden,
               visible: [...document.querySelectorAll('.panel')].filter(x => !x.hidden).length,
               hash: location.hash }; })()`);
    tabSwitch.push(r);
    await sleep(120);
  }
  console.log("---- Tab 切换 ----");
  console.log(JSON.stringify(tabSwitch, null, 2));

  // 契约自检按钮（阶段 3 重构后审阅页不再挂这张卡，缺就跳过）
  await evaluate(`(() => { App.setTab('scan'); const b = document.getElementById('btnContractRun'); if (b) b.click(); return 1; })()`);
  await sleep(900);
  const contract = await evaluate(`(() => {
    const box = document.getElementById('contractSummary');
    const out = document.getElementById('contractOutput');
    if (!box || !out) return { skipped: true };
    return {
      summaryHidden: box.hidden,
      summaryText: box.innerText.slice(0, 400),
      checksOk: [...box.querySelectorAll('.ck')].filter(n => n.textContent === '✓').length,
      checksBad: [...box.querySelectorAll('.ck')].filter(n => n.textContent === '✕').length,
      jsonHidden: out.hidden,
      jsonLen: out.textContent.length,
      btnLabel: document.getElementById('btnContractRun').textContent,
      jsonParses: (() => { try { JSON.parse(out.textContent); return true; } catch (e) { return false; } })()
    };
  })()`);
  console.log("---- 契约自检 UI ----");
  console.log(JSON.stringify(contract, null, 2));

  // 直接调 API 验证（不经 UI）
  const api = await evaluate(`(async () => {
    const res = await analyze(Engine.FAKE_SAMPLE_RESUME, Engine.FAKE_SAMPLE_JD, '互联网-后端');
    const v = Engine.validateResult(res, Engine.FAKE_SAMPLE_RESUME);
    const first = res.issues[0];
    const refined = await refine(first, { detail: '独立负责订单查询链路', proof: 'wrk 压测报告' });
    const rv = Engine.validateRefine(refined);
    return { issues: res.issues.length, score: res.score, ok: v.ok, errors: v.errors,
             refineOk: rv.ok, rewritten: refined.rewritten };
  })()`);
  console.log("---- API 直调 ----");
  console.log(JSON.stringify(api, null, 2));

  // 设置弹窗
  const modal = await evaluate(`(() => {
    document.getElementById('btnSettings').click();
    const m = document.getElementById('settingsModal');
    const open = !m.hidden;
    document.getElementById('setBaseUrl').value = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    document.getElementById('setModel').value = 'deepseek-v3';
    document.getElementById('btnSettingsSave').click();
    return { open, closedAfterSave: m.hidden, saved: JSON.parse(localStorage.getItem('resume-opt.state.v1') || '{}').settings };
  })()`);
  console.log("---- 设置弹窗 ----");
  console.log(JSON.stringify(modal, null, 2));

  // 持久化：行业写进 state 后刷新仍在
  const persist = await evaluate(`(() => {
    App.setIndustry({ category: '互联网', sub: '后端' });
    return { chip: document.getElementById('industryChipValue').textContent,
             current: document.getElementById('industryCurrentValue').textContent };
  })()`);
  console.log("---- 行业状态 ----（刷新前）");
  console.log(JSON.stringify(persist, null, 2));

  await client.send("Page.reload", { ignoreCache: true });
  await sleep(1200);
  const afterReload = await evaluate(`(() => ({ chip: document.getElementById('industryChipValue').textContent, hash: location.hash, tab: document.querySelector('.panel.is-active').dataset.panel, engine: !!window.Engine }))()`);
  console.log("---- 刷新后持久化 ----");
  console.log(JSON.stringify(afterReload, null, 2));

  // 截图（先清掉测试写入的状态，还原成用户首次打开的样子）
  await evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); location.reload(); return 1; })()`);
  await sleep(1400);
  for (const tab of ["upload", "knowledge", "scan", "audit", "optimize", "plan"]) {
    await evaluate(`App.setTab(${JSON.stringify(tab)}); 1`);
    if (tab === "scan") {
      await evaluate(`(() => { const b = document.getElementById('btnContractRun'); if (b) b.click(); return 1; })()`);
      await sleep(900);
    }
    await sleep(250);
    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOT_DIR, `stage0-${tab}.png`), Buffer.from(shot.data, "base64"));
  }

  const errors = await evaluate(`(() => [...document.querySelectorAll('.toast--warn')].map(n => n.textContent))()`);
  console.log("---- 警告 toast ----");
  console.log(JSON.stringify(errors));

  client.close();
  proc.kill();
  console.log("DONE");
  process.exit(0);
})().catch((err) => {
  console.error("CHECK FAILED:", err);
  process.exit(1);
});