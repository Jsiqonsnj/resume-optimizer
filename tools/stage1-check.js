/* 阶段 1 联调：粘贴正文 → 知识库两级选择 → 全页拖拽解析（真实 File 走完整解析链）。
   用法：node tools/stage1-check.js */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9334;
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
const SHOT_DIR = path.join(ROOT, ".preview");

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
  const events = [];

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method) events.push(msg);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  return {
    ready,
    events,
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

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (detail === undefined ? "" : "  → " + JSON.stringify(detail)));
  if (!ok) failures.push(name);
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-s1-"));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile, "--window-size=1440,1300", PAGE
  ], { stdio: "ignore" });

  const page = await waitForTargets();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Page.enable");
  await sleep(900);

  const evaluate = async (expression, awaitPromise = true) => {
    const res = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error("页面脚本异常: " + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
    }
    return res.result.value;
  };

  console.log("---- 粘贴正文 ----");
  const paste = await evaluate(`(() => {
    const demo = [
      "李四 | 后端开发工程师",
      "电话 139-0000-0000 | 邮箱 lisi@example.com | 上海",
      "教育背景",
      "2017.09 - 2021.06  某某大学  软件工程  本科",
      "2021.07 - 2023.02  A 公司  后端开发工程师",
      "负责相关工作，参与业务系统的日常开发与维护。",
      "2023.03 - 至今  B 公司  高级后端开发工程师",
      "主导订单链路重构，QPS 从 800 提升到 2400（wrk 压测，P99 320ms→90ms）。",
      "技能",
      "熟练 Java、MySQL、Redis、Kafka，了解 Go。"
    ].join("\\n");
    const ta = document.getElementById('resumePaste');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, demo);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const counter = document.getElementById('pasteCount').textContent;
    document.getElementById('btnUsePaste').click();
    const state = JSON.parse(localStorage.getItem('resume-opt.state.v1') || '{}');
    return {
      counter,
      previewHidden: document.getElementById('resumePreview').hidden,
      previewTextHead: document.getElementById('previewText').textContent.slice(0, 24),
      metaCells: document.querySelectorAll('#previewMeta .summary-cell').length,
      sourceTag: document.getElementById('previewSource').textContent,
      savedChars: (state.resumeText || '').length,
      savedSource: state.resumeMeta && state.resumeMeta.source,
      savedLines: state.resumeMeta && state.resumeMeta.lines,
      status: document.getElementById('uploadStatus').textContent
    };
  })()`);
  console.log(JSON.stringify(paste, null, 2));
  check("粘贴计数正确", paste.counter.includes("字"), paste.counter);
  check("预览卡片出现", paste.previewHidden === false);
  check("预览显示正文", paste.previewTextHead.includes("李四"));
  check("元信息格子渲染", paste.metaCells === 3, paste.metaCells);
  check("来源标记为粘贴", paste.sourceTag === "粘贴");
  check("已写入 localStorage", paste.savedChars > 200 && paste.savedSource === "paste", {
    chars: paste.savedChars, source: paste.savedSource, lines: paste.savedLines
  });

  await sleep(300);
  let shot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT_DIR, "stage1-upload-paste.png"), Buffer.from(shot.data, "base64"));

  console.log("---- 知识库 ----");
  const knowledge = await evaluate(`(() => {
    App.setTab('knowledge');
    const cats = [...document.querySelectorAll('#categoryChips .chip-btn')];
    const first = cats.find(b => b.textContent === '互联网');
    first.click();
    const dirs = [...document.querySelectorAll('#directionChips .chip-btn')];
    const beforeCards = document.querySelectorAll('#industryCards .card').length;
    return {
      categories: cats.map(b => b.textContent),
      categoryActive: !!document.querySelector('#categoryChips .chip-btn.is-active'),
      directions: dirs.map(b => b.textContent),
      beforeCards,
      emptyHint: document.querySelector('#industryCards') ? document.querySelector('#industryCards').innerText.slice(0, 30) : ''
    };
  })()`);
  console.log(JSON.stringify(knowledge, null, 2));
  check("26 个行业大类", knowledge.categories.length === 26, knowledge.categories.length);
  check("点大类后出现二级方向", knowledge.directions.length === 9, knowledge.directions);
  check("未选方向时提示选方向", knowledge.beforeCards === 1 && knowledge.emptyHint.includes("二级方向"), knowledge.emptyHint);

  const pick = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('#directionChips .chip-btn')].find(b => b.textContent === '后端');
    btn.click();
    const cards = [...document.querySelectorAll('#industryCards .card .card-title')].map(n => n.textContent);
    const state = JSON.parse(localStorage.getItem('resume-opt.state.v1') || '{}');
    return {
      cards,
      chip: document.getElementById('industryChipValue').textContent,
      readout: document.getElementById('industryCurrentValue').textContent,
      keywords: document.querySelectorAll('#industryCards .kw').length,
      saved: state.industry,
      listItems: document.querySelectorAll('#industryCards .k-list li').length
    };
  })()`);
  console.log(JSON.stringify(pick, null, 2));
  check("渲染四张知识卡片", pick.cards.length === 4, pick.cards);
  check("顶栏标签同步", pick.chip === "互联网-后端", pick.chip);
  check("页面内当前方向同步", pick.readout === "互联网-后端", pick.readout);
  check("关键词渲染", pick.keywords === 6, pick.keywords);
  check("偏好/减分项列表有内容", pick.listItems >= 6, pick.listItems);
  check("行业写入 localStorage", pick.saved && pick.saved.sub === "后端", pick.saved);

  await sleep(300);
  shot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT_DIR, "stage1-knowledge.png"), Buffer.from(shot.data, "base64"));

  console.log("---- 刷新持久化 ----");
  await client.send("Page.reload", { ignoreCache: true });
  await sleep(1300);
  const persisted = await evaluate(`(() => ({
    chip: document.getElementById('industryChipValue').textContent,
    cards: document.querySelectorAll('#industryCards .card').length,
    activeDir: (document.querySelector('#directionChips .chip-btn.is-active') || {}).textContent || null,
    preview: !document.getElementById('resumePreview').hidden,
    pasteFilled: document.getElementById('resumePaste').value.length > 100
  }))()`);
  console.log(JSON.stringify(persisted, null, 2));
  check("刷新后行业仍在", persisted.chip === "互联网-后端" && persisted.cards === 4, persisted);
  check("刷新后内容仍在", persisted.preview === true && persisted.pasteFilled === true, persisted);

  console.log("---- 全页拖拽 ----");
  const overlay = await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["王五 | 前端开发工程师\\n电话 137-0000-0000\\n2022.07 - 至今  C 公司  前端工程师\\n负责页面开发。"], "测试简历.txt", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const visible = !document.getElementById('dropOverlay').hidden;
    const title = document.querySelector('.drop-overlay-title').textContent;
    return { visible, title };
  })()`);
  console.log(JSON.stringify(overlay, null, 2));
  check("拖入时全屏遮罩出现", overlay.visible === true && overlay.title === "松手开始解析", overlay);

  await sleep(200);
  shot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT_DIR, "stage1-dropoverlay.png"), Buffer.from(shot.data, "base64"));

  const dropped = await evaluate(`(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(["王五 | 前端开发工程师\\n电话 137-0000-0000\\n2022.07 - 至今  C 公司  前端工程师\\n负责页面开发。"], "测试简历.txt", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 700));
    const state = JSON.parse(localStorage.getItem('resume-opt.state.v1') || '{}');
    return {
      overlayHidden: document.getElementById('dropOverlay').hidden,
      saved: (state.resumeText || '').slice(0, 20),
      source: state.resumeMeta && state.resumeMeta.source,
      filename: state.resumeMeta && state.resumeMeta.filename,
      tag: document.getElementById('previewSource').textContent,
      status: document.getElementById('uploadStatus').textContent
    };
  })()`);
  console.log(JSON.stringify(dropped, null, 2));
  check("放下后遮罩关闭", dropped.overlayHidden === true);
  check("TXT 拖拽解析成功", dropped.saved.startsWith("王五") && dropped.source === "file", dropped);
  check("来源显示 TXT 文件", dropped.tag === "TXT 文件", dropped.tag);

  console.log("---- 控制台错误 ----");
  const errors = client.events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails.text + " " + (e.params.exceptionDetails.exception || {}).description);
  const logErrors = client.events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  console.log(JSON.stringify({ errors, logErrors }, null, 2));
  check("无页面异常", errors.length === 0, errors);
  check("无资源/网络错误", logErrors.length === 0, logErrors);

  // 收尾：清状态再截一张上传页
  await evaluate(`(() => { localStorage.clear(); location.reload(); return 1; })()`);
  await sleep(1200);
  await evaluate(`App.setTab('upload'); 1`);
  await sleep(250);
  shot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT_DIR, "stage1-upload-empty.png"), Buffer.from(shot.data, "base64"));

  client.close();
  proc.kill();
  console.log(failures.length ? "FAILED: " + failures.join(" | ") : "ALL PASS");
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error("CHECK FAILED:", err);
  process.exit(1);
});