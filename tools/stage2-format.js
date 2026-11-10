/* 阶段 2 补充验证：圈与文字对齐、真实 DOCX 上传后的格式信号、扫描中气泡位置。
   用法：node tools/stage2-format.js */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9342;
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
const SHOT_DIR = path.join(ROOT, ".preview");
const FIXTURE = path.join(ROOT, ".preview", "fixtures", "test.docx");

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
    } catch (e) { /* retry */ }
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-s2f-"));
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
  await client.send("DOM.enable");
  await sleep(1100);

  const evaluate = async (expression, awaitPromise = true) => {
    const res = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) throw new Error("页面异常: " + JSON.stringify(res.exceptionDetails));
    return res.result.value;
  };

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log((ok ? "PASS " : "FAIL ") + name + (detail === undefined ? "" : "  " + JSON.stringify(detail)));
  };

  // ---- 1) 真实 DOCX 走上传流程 ----
  const doc = await client.send("DOM.getDocument", { depth: -1 });
  const node = await client.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#fileInput" });
  await client.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [FIXTURE] });
  await evaluate(`(() => { document.getElementById('fileInput').dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);

  let uploaded = null;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    uploaded = await evaluate(`(() => {
      const meta = App.state.resumeMeta;
      return {
        chars: (App.state.resumeText || '').length,
        kind: meta && meta.kind,
        format: meta && meta.format,
        tab: document.querySelector('.panel.is-active').dataset.panel,
        fmtHidden: document.getElementById('formatCard').hidden,
        notes: [...document.querySelectorAll('.format-note .format-label')].map(n => n.textContent)
      };
    })()`);
    if (uploaded.chars > 40) break;
  }
  check("DOCX 已解析出正文", uploaded.chars > 40, { chars: uploaded.chars, kind: uploaded.kind });
  check("DOCX 抓到格式信号", !!uploaded.format && Array.isArray(uploaded.format.fontSizes) &&
    uploaded.format.fontSizes.length > 0, uploaded.format);
  check("上传后自动进入审阅页", uploaded.tab === "scan", uploaded.tab);
  check("格式批注卡片已渲染", uploaded.fmtHidden === false && uploaded.notes.length > 0, uploaded.notes);

  // ---- 2) 圈与文字对齐 ----
  // 等分析完成（疑问条数出现）再跳过动画，否则量到的是空纸
  for (let i = 0; i < 50; i++) {
    const ready = await evaluate(`(() => document.querySelectorAll('#questionList .q-item').length)`);
    if (ready > 0) break;
    await sleep(300);
  }
  await evaluate(`(() => { const b = document.getElementById('btnScanSkip'); if (!b.hidden) b.click(); return 1; })()`);
  await sleep(1800);

  const align = await evaluate(`(() => {
    const inner = document.getElementById('paperInner');
    const ir = inner.getBoundingClientRect();
    const marks = [...document.querySelectorAll('#paperLines mark.excerpt')];
    const groups = [...document.querySelectorAll('#inkLayer .ink-circle')];
    const rows = groups.map((g, i) => {
      const box = g.getBBox();
      const m = marks[i];
      if (!m) return { i, missingMark: true };
      const mr = m.getBoundingClientRect();
      const cx = (mr.left - ir.left) + mr.width / 2;
      const cy = (mr.top - ir.top) + mr.height / 2;
      return {
        i,
        dx: Math.round((box.x + box.width / 2) - cx),
        dy: Math.round((box.y + box.height / 2) - cy),
        markW: Math.round(mr.width),
        circleW: Math.round(box.width)
      };
    });
    return {
      count: groups.length,
      rows,
      maxDx: Math.max(...rows.map(r => Math.abs(r.dx || 0))),
      maxDy: Math.max(...rows.map(r => Math.abs(r.dy || 0))),
      clipped: groups.some(g => { const b = g.getBBox(); return b.x < 0 || b.y < 0; })
    };
  })()`);
  check("圈数量与标注一致", align.count === align.rows.length, align.count);
  check("圈中心与文字横向误差 ≤ 12px", align.maxDx <= 12, align.rows);
  check("圈中心与文字纵向误差 ≤ 12px", align.maxDy <= 12, align.rows);

  // ---- 3) 扫描中的气泡位置 ----
  // 文本必须变化，否则 setResume 不会派发 resume:change，也就不会重跑
  await evaluate(`(() => {
    App.setResume(App.state.resumeText + ' 负责相关工作，协助日常事务。', App.state.resumeMeta);
    return 1;
  })()`);
  await sleep(1200);

  let bubble = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    bubble = await evaluate(`(() => {
      const b = document.getElementById('hrBubble');
      if (b.hidden) return { hidden: true };
      const r = b.getBoundingClientRect();
      return {
        hidden: false,
        text: document.getElementById('bubbleText').textContent.slice(0, 24),
        left: Math.round(r.left), top: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
        inViewport: r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0
      };
    })()`);
    if (!bubble.hidden) break;
  }
  check("扫描过程中弹出 HR 气泡", bubble && !bubble.hidden, bubble);
  check("气泡完整在视口内", !!bubble && bubble.inViewport, bubble);

  const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage2-bubble.png"), Buffer.from(shot.data, "base64"));

  client.close();
  proc.kill();

  const failed = checks.filter((c) => !c.ok);
  console.log("---- 结果 ----");
  console.log("通过 " + (checks.length - failed.length) + " / " + checks.length);
  if (failed.length) {
    console.log("失败项：" + failed.map((f) => f.name).join("、"));
    process.exitCode = 1;
  }
})();