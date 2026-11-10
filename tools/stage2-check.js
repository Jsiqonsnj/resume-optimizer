/* 阶段 2 联调：上传后自动审阅、圈画、追问清单、格式批注。
   用法：node tools/stage2-check.js */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9341;
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
    } catch (e) { /* 等浏览器起来 */ }
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

const RESUME = [
  "李四 | 后端开发工程师",
  "电话 139-0000-0000 | 邮箱 lisi@example.com",
  "教育",
  "2016.09 - 2020.06  某大学  计算机科学与技术  本科",
  "工作经历",
  "2020.07 - 2022.03  A 公司  后端工程师",
  "负责相关工作，参与业务系统的日常开发与维护。",
  "2021.03 - 2023.06  B 公司  技术专家",
  "主导订单重构，性能提升 300%，用户满意度大幅提升。",
  "项目经历",
  "技能",
  "熟练掌握 Java、MySQL、Redis。",
  "自我评价",
  "工作认真负责，具备良好的团队协作能力。"
].join("\n");

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-s2-"));
  const proc = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile,
    "--window-size=1440,1400",
    PAGE
  ], { stdio: "ignore" });

  const page = await waitForTargets();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__errors = []; window.addEventListener('error', e => window.__errors.push(String(e.message))); window.addEventListener('unhandledrejection', e => window.__errors.push('rejection:' + String(e.reason)));"
  });
  await client.send("Page.reload");
  await sleep(1200);

  const evaluate = async (expression, awaitPromise = true) => {
    const res = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error("页面脚本异常: " + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
    }
    return res.result.value;
  };

  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log((ok ? "PASS " : "FAIL ") + name + (detail === undefined ? "" : "  " + JSON.stringify(detail)));
  };

  // 1) 数据与模块
  const boot = await evaluate(`(() => ({
    categories: (window.INDUSTRY_TREE || []).length,
    directions: (window.INDUSTRY_TREE || []).reduce((a, g) => a + g.directions.length, 0),
    hasRules: !!(window.RuleEngine && window.RuleEngine.analyze),
    hasMascot: !!document.querySelector('.hr-avatar'),
    errors: window.__errors.slice()
  }))()`);
  check("知识库 26 大类 / 80 方向", boot.categories === 26 && boot.directions === 80, boot);
  check("规则引擎已加载", boot.hasRules);

  // 2) 知识库计数与搜索
  const kb = await evaluate(`(() => {
    App.setTab('knowledge');
    const count = document.getElementById('industryCount').textContent;
    const input = document.getElementById('industrySearch');
    input.value = '芯片';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = [...document.querySelectorAll('#searchResults .search-row')];
    return {
      count, rows: rows.length,
      first: rows[0] ? rows[0].dataset.category + '-' + rows[0].dataset.direction : null,
      hit: rows[0] ? rows[0].querySelector('.search-hit').textContent : ''
    };
  })()`);
  check("知识库计数", /26 大类/.test(kb.count) && /80 方向/.test(kb.count), kb.count);
  check("搜索「芯片」有结果", kb.rows > 0 && /半导体/.test(kb.first || ""), kb);

  // 3) 上传后自动审阅
  await evaluate(`(() => {
    App.setTab('upload');
    App.setResume(${JSON.stringify(RESUME)}, { source: 'file', filename: 'demo.docx', kind: 'docx', pages: 3,
      format: { kind: 'docx', pages: 3, fontSizes: [9, 10.5, 12, 18], fonts: ['宋体', '华文彩云'], paragraphs: 40, emptyParagraphs: 16, estimatedPages: 3 } });
    return 1;
  })()`);

  await sleep(700);
  const auto = await evaluate(`(() => ({
    tab: document.querySelector('.panel.is-active').dataset.panel,
    status: document.getElementById('scanStatus').textContent,
    penVisible: !document.getElementById('pen').hidden,
    score: document.getElementById('scanScore').textContent,
    issues: document.getElementById('scanIssueCount').textContent,
    dots: document.querySelectorAll('#paperLines mark.excerpt').length,
    qItems: document.querySelectorAll('#questionList .q-item').length
  }))()`);
  check("自动跳到审阅页", auto.tab === "scan", auto);
  check("自动开始扫描（笔已出现）", auto.penVisible, auto.status);
  check("分析完成：疑问条数与标注一致", auto.qItems > 0 && auto.dots === auto.qItems, auto);

  // 4) 跳过动画，检查圈
  await evaluate(`(() => { document.getElementById('btnScanSkip').click(); return 1; })()`);
  await sleep(1500);
  const afterSkip = await evaluate(`(() => ({
    circles: document.querySelectorAll('#inkLayer .ink-circle').length,
    status: document.getElementById('scanStatus').textContent,
    penHidden: document.getElementById('pen').hidden,
    bubbleHidden: document.getElementById('hrBubble').hidden,
    colors: [...document.querySelectorAll('#inkLayer .ink-circle path')].slice(0, 12).map(p => p.getAttribute('stroke'))
  }))()`);
  check("跳过动画后画出全部圈", afterSkip.circles === auto.qItems, afterSkip.circles + " / " + auto.qItems);
  check("每圈两种笔迹（双层描边）", afterSkip.colors.length >= auto.qItems * 2 - 2, afterSkip.colors.length);

  // 5) 格式批注
  const fmt = await evaluate(`(() => {
    const card = document.getElementById('formatCard');
    return {
      hidden: card.hidden,
      count: document.getElementById('formatCount').textContent,
      notes: [...document.querySelectorAll('.format-note .format-label')].map(n => n.textContent),
      thoughts: [...document.querySelectorAll('.format-thought')].map(n => n.textContent.slice(0, 24))
    };
  })()`);
  check("文档格式批注可见", !fmt.hidden && fmt.notes.length >= 4, fmt.notes);
  check("格式批注带 HR 心理活动", fmt.thoughts.every(t => t.length > 6), fmt.thoughts.slice(0, 3));

  // 6) 追问 → 细化 → 已解决
  const refine = await evaluate(`(async () => {
    const li = document.querySelector('#questionList .q-item');
    li.querySelector('[data-act="detail"]').click();
    const ta = li.querySelector('textarea');
    ta.value = '独立负责订单查询链路重构，拆了 3 个接口，P99 从 800ms 降到 120ms';
    li.querySelector('[data-act="generate"]').click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (!li.querySelector('.q-result').hidden) break;
    }
    return {
      resolved: li.classList.contains('is-resolved'),
      rewritten: li.querySelector('.q-rewritten').textContent.slice(0, 60),
      advice: li.querySelector('.q-advice').textContent.slice(0, 40),
      progress: document.getElementById('questionsProgress').textContent,
      barWidth: document.getElementById('progressBar').style.width,
      stored: !!localStorage.getItem('resume-opt.scan.v1')
    };
  })()`);
  check("细化后标记已解决", refine.resolved && refine.rewritten.length > 10, refine);
  check("进度条与持久化", /1 \//.test(refine.progress) && refine.stored, refine.progress);

  // 7) 点圈跳转
  const jump = await evaluate(`(() => {
    const g = document.querySelector('#inkLayer .ink-circle');
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const li = document.querySelector('#questionList .q-item.is-flash');
    return { flashed: !!li };
  })()`);
  check("点圈能定位到疑问", jump.flashed);

  // 8) 截图 + 控制台错误 + 小屏溢出
  await evaluate(`(() => { App.setTab('scan'); window.scrollTo(0, 0); return 1; })()`);
  await sleep(300);
  const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage2-scan.png"), Buffer.from(shot.data, "base64"));

  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await evaluate('(window.dispatchEvent(new Event("resize")), 1)');
  await sleep(700);

  const mobile = await evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    paperW: Math.round(document.querySelector('.paper').getBoundingClientRect().width),
    circles: document.querySelectorAll('#inkLayer .ink-circle').length
  }))()`);
  check("390 宽无横向溢出", mobile.overflow <= 1, mobile);
  check("小屏重排后圈数量不变", mobile.circles === afterSkip.circles, mobile);

  const shot2 = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage2-scan-mobile.png"), Buffer.from(shot2.data, "base64"));

  const errs = await evaluate("window.__errors");
  check("无 JS 运行时错误", errs.length === 0, errs);

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
