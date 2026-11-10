/* 阶段 3 联调：信息架构（导航门控 / 三页分工）+ resume_engine 结果
   用法：node tools/stage3-check.js
   前置：python tools/parity.py && node tools/parity-js.js 全绿 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9343;
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

const FORMAT = {
  kind: "docx", pages: 3, fontSizes: [9, 10.5, 12, 18], fonts: ["宋体", "华文彩云"],
  paragraphs: 40, emptyParagraphs: 16, estimatedPages: 3
};

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-s3-"));

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
  await sleep(800);

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

  /* 从干净状态开始 */
  await evaluate("(() => { localStorage.clear(); sessionStorage.clear(); return 1; })()");
  await client.send("Page.reload");
  await sleep(1200);

  /* 1) 引擎模块 */
  const boot = await evaluate(`(() => ({
    hasEngine: !!(window.ResumeEngine && ResumeEngine.reviewWithContext),
    version: window.Engine ? Engine.VERSION : null,
    missing: ['RParse','RSignals','RProfile','RJd','RDiagnose','RRewrite','RInterview','RScore','RReport','PlanView','OptimizeView','PLAN_DATA']
      .filter(k => !window[k])
  }))()`);
  check("引擎与三个视图模块已加载", boot.hasEngine && boot.missing.length === 0, boot);
  check("Engine 版本 2.0", /2\.0/.test(boot.version || ""), boot.version);

  /* 2) 初始只有上传 / 知识库 */
  const locked = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.nav-item')];
    const visible = items.filter(i => !i.hidden && getComputedStyle(i).display !== 'none').map(i => i.dataset.tab);
    App.setTab('scan');
    return {
      visible: visible,
      total: items.length,
      afterTry: document.querySelector('.panel.is-active').dataset.panel,
      navHint: document.getElementById('navHint') ? !document.getElementById('navHint').hidden : null,
      planHidden: document.getElementById('planWrap').hidden,
      optHidden: document.getElementById('optWrap').hidden
    };
  })()`);
  check("初始导航只有上传 + 知识库", locked.visible.length === 2 &&
    locked.visible.includes("upload") && locked.visible.includes("knowledge"), locked.visible);
  check("锁着的 Tab 点了会回退", locked.afterTry === "upload", locked.afterTry);
  check("初始有解锁提示", locked.navHint === true, locked.navHint);
  check("没结果时优化 / 规划容器不显示", locked.optHidden && locked.planHidden, locked);

  /* 3) 载入示例 → 解锁 + 自动审阅 */
  await evaluate(`(() => {
    App.setTab('upload');
    document.getElementById('btnLoadDemo').click();
    return 1;
  })()`);
  await sleep(900);
  const unlocked = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.nav-item')];
    return {
      visible: items.filter(i => !i.hidden && getComputedStyle(i).display !== 'none').length,
      unlockedFlag: App.isUnlocked(),
      tab: document.querySelector('.panel.is-active').dataset.panel
    };
  })()`);
  check("放简历后六个 Tab 全出现（含深审）", unlocked.visible === 6 && unlocked.unlockedFlag, unlocked);
  check("自动进审阅页", unlocked.tab === "scan", unlocked.tab);

  await evaluate(`(() => { const b = document.getElementById('btnScanSkip'); if (b && !b.hidden) b.click(); return 1; })()`);
  await sleep(1600);

  const run = await evaluate(`(() => {
    const r = window.__lastResult || {};
    const types = {};
    (r.issues || []).forEach(i => { types[i.type] = (types[i.type] || 0) + 1; });
    return {
      engine: (r._meta || {}).engine,
      score: document.getElementById('scanScore').textContent,
      level: document.getElementById('scanLevel').textContent,
      proTotal: r.professional ? r.professional.total : null,
      proLevel: r.professional ? r.professional.level : null,
      issueCount: document.getElementById('scanIssueCount').textContent,
      qItems: document.querySelectorAll('#questionList .q-item').length,
      circles: document.querySelectorAll('#inkLayer .ink-circle').length,
      types: types,
      jdLen: JSON.parse(localStorage.getItem('resume-opt.state.v1')).jdText.length
    };
  })()`);
  check("结果来自 resume-engine", run.engine === "resume-engine", run.engine);
  check("评分档位与引擎一致（61 / C）", run.score === "61" && run.proTotal === 61 && run.proLevel === "C", run);
  check("5 种疑问类型全覆盖", Object.keys(run.types).length === 5, run.types);
  check("圈 = 疑问 = 圈出条数", run.circles === run.qItems && run.qItems > 0 &&
    parseInt(run.issueCount, 10) === run.qItems, run);
  check("示例 JD 同步进状态", run.jdLen > 40, run.jdLen);

  /* 4) 审阅页装载的卡：总评 / 诊断 / 追问 / 亮点（不含改写与规划） */
  const scanPage = await evaluate(`(() => {
    const inPanel = id => !!document.querySelector('#panel-scan #' + id);
    return {
      proHead: inPanel('proCard'),
      questions: inPanel('questionsCard'),
      layers: inPanel('layerCard'),
      probes: inPanel('probeCard'),
      strengths: inPanel('strengthCard'),
      format: inPanel('formatCard'),
      rewriteInScan: inPanel('rewriteCard'),
      layerTitles: [...document.querySelectorAll('#layerList .layer-title')].map(t => t.textContent.slice(0, 12)),
      probeKinds: [...new Set([...document.querySelectorAll('#probeList .probe-kind')].map(k => k.textContent))],
      probeCount: document.querySelectorAll('#probeList .probe').length,
      dims: document.querySelectorAll('#proDims .pro-dim').length,
      jdShown: !document.getElementById('proJd').hidden,
      six: document.querySelector('#proSix .six-badge').textContent,
      strength: document.querySelectorAll('#strengthList .strength').length
    };
  })()`);
  check("审阅页 = 总评 + 疑问 + 诊断 + 追问 + 亮点",
    scanPage.proHead && scanPage.questions && scanPage.layers && scanPage.probes && scanPage.strengths, scanPage);
  check("改写卡不在审阅页", scanPage.rewriteInScan === false);
  check("四层诊断四条", scanPage.layerTitles.length === 4, scanPage.layerTitles);
  check("五维分五条", scanPage.dims === 5, scanPage.dims);
  check("追问预演含亮点与疑点", scanPage.probeCount >= 3 && scanPage.probeKinds.includes("疑点"), scanPage.probeKinds);
  check("JD 雷达与 6 秒测试在总评里", scanPage.jdShown && /6 秒测试/.test(scanPage.six), scanPage.six);

  /* 5) 优化页：逐句问 → 生成 */
  const opt = await evaluate(`(() => {
    App.setTab('optimize');
    const items = [...document.querySelectorAll('#optList .opt-item')];
    const first = items[0];
    return {
      tab: document.querySelector('.panel.is-active').dataset.panel,
      count: items.length,
      tag: document.getElementById('optCount').textContent,
      quote: first ? first.querySelector('.opt-quote').textContent.slice(0, 20) : '',
      asks: first ? first.querySelectorAll('[data-ask]').length : 0,
      askLabels: first ? [...first.querySelectorAll('.opt-ask-q')].map(q => q.textContent.slice(0, 14)) : [],
      skeletonShown: first ? !!first.querySelector('.opt-sk-line') : false,
      resultHidden: first ? first.querySelector('.opt-result').hidden : null,
      layerInOpt: !!document.querySelector('#panel-optimize #layerCard')
    };
  })()`);
  check("优化页独立且不带诊断", opt.tab === "optimize" && opt.layerInOpt === false, opt.tab);
  check("逐句列表条数 = 改写条数", opt.count >= 5 && opt.count <= 8, opt.tag);
  check("每条给出提问与输入框", opt.asks >= 2 && opt.askLabels.length >= 2, opt.askLabels);
  check("默认展示骨架、结果未生成", opt.skeletonShown && opt.resultHidden === true, opt);

  const generated = await evaluate(`(() => {
    const first = document.querySelectorAll('#optList .opt-item')[0];
    const inputs = [...first.querySelectorAll('[data-ask]')];
    const answers = ['3 个微信社群共 1200 人', '月活跃', '从 18% 提到 41%'];
    inputs.forEach((inp, i) => { inp.value = answers[i] || ''; inp.dispatchEvent(new Event('input', { bubbles: true })); });
    first.querySelector('[data-act="gen"]').click();
    const text = first.querySelector('.opt-rewritten').textContent;
    return {
      text: text,
      shown: !first.querySelector('.opt-result').hidden,
      advice: first.querySelector('.opt-advice').textContent.slice(0, 40),
      done: first.classList.contains('is-done'),
      ready: document.getElementById('optReady').textContent,
      stored: !!localStorage.getItem('resume-opt.opt.v1'),
      fillInside: text.indexOf('1200') !== -1 && text.indexOf('41%') !== -1
    };
  })()`);
  check("按骨架生成用上了用户答案", generated.fillInside, generated.text.slice(0, 60));
  check("生成后结果区展开并标记已改", generated.shown && generated.done, generated.advice);
  check("进度与本地留存", /1 \//.test(generated.ready) && generated.stored, generated.ready);

  /* 6) 规划页：自动生成 */
  const plan = await evaluate(`(async () => {
    App.setTab('plan');
    await new Promise(r => setTimeout(r, 120));
    const b = window.PlanView.build(window.__lastResult.professional, window.App.state.resumeText);
    return {
      tab: document.querySelector('.panel.is-active').dataset.panel,
      wrapShown: !document.getElementById('planWrap').hidden,
      blocks: document.querySelectorAll('#planBody .plan-block').length,
      tag: document.getElementById('planTag').textContent,
      kw: document.querySelectorAll('#planBody .kw--miss').length,
      cols: [...document.querySelectorAll('#planBody .plan-col-title')].map(t => t.textContent.trim()),
      rungs: document.querySelectorAll('#planBody .plan-rung').length,
      quick: document.querySelectorAll('#planBody .plan-quick li').length,
      pitch: document.getElementById('planPitch').textContent,
      intro: document.getElementById('introText').textContent.length,
      text: document.getElementById('planBody').textContent.length,
      builtFamily: b.family, builtGaps: b.gaps.length, builtCerts: b.certs.length
    };
  })()`);
  check("规划页自动有内容（无需点击）", plan.tab === "plan" && plan.wrapShown && plan.blocks >= 4, plan.blocks);
  check("定位带行业与职能族", /运营|技术|销售|财会/.test(plan.tag) && plan.tag.length > 3, plan.tag);
  check("拔高三列 A/B/C 齐备", plan.cols.length === 3, plan.cols);
  check("缺口词与一周动作都算出来", plan.kw >= 1 && plan.quick >= 1, { kw: plan.kw, quick: plan.quick });
  check("3 / 6 / 12 月阶梯三段", plan.rungs === 3, plan.rungs);
  check("一句话卖点已生成", plan.pitch.length > 12 && plan.pitch.indexOf("运营") !== -1, plan.pitch.slice(0, 40));
  check("自我介绍已填充", plan.intro > 40, plan.intro);

  /* 6.5) 五维雷达 + PDF 导出 */
  const radar = await evaluate(`(() => {
    App.setTab('scan');
    const box = document.getElementById('proRadar');
    const svg = box.querySelector('svg');
    return {
      hidden: box.hidden,
      hasSvg: !!svg,
      polygons: svg ? svg.querySelectorAll('path').length : 0,
      dots: svg ? svg.querySelectorAll('circle').length : 0,
      labels: svg ? [...svg.querySelectorAll('text')].map(t => t.textContent).slice(0, 10) : [],
      box: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
      imgs: document.querySelectorAll('#proRadar img, #proRadar canvas').length
    };
  })()`);
  check("五维雷达是纯 SVG", !radar.hidden && radar.hasSvg && radar.imgs === 0, radar);
  check("雷达 5 点 + 网格环", radar.dots === 5 && radar.polygons === 4, { dots: radar.dots, polygons: radar.polygons });
  check("雷达标签带维度名与分值", radar.labels.length === 10 && radar.labels.filter(function (l) { return /^\d+\/\d+$/.test(l); }).length === 5, radar.labels);

  const pdf = await evaluate(`(async () => {
    const res = await window.PdfExport.build(window.__lastResult.professional);
    const bytes = res.bytes;
    const tail = String.fromCharCode.apply(null, bytes.subarray(bytes.length - 40));
    return {
      head: res.head, pages: res.pages, size: res.size,
      hasEof: tail.indexOf('%%EOF') !== -1,
      hasXref: tail.indexOf('startxref') !== -1,
      hasDct: String.fromCharCode.apply(null, bytes.subarray(0, Math.min(bytes.length, 4000))).indexOf('DCTDecode') !== -1,
      type: res.bytes.constructor.name
    };
  })()`);
  check("PDF 头与结构合法", pdf.head === "%PDF-1.4" && pdf.hasXref && pdf.hasEof && pdf.hasDct, pdf);
  check("PDF 多页且体积合理", pdf.pages >= 1 && pdf.size > 40000, { pages: pdf.pages, kb: Math.round(pdf.size / 1024) });

  const pdfBtn = await evaluate(`(() => {
    const btn = document.getElementById('btnExportPdf');
    return { exists: !!btn, text: btn ? btn.textContent : '' };
  })()`);
  check("导出卡里有 PDF 按钮", pdfBtn.exists && /PDF/.test(pdfBtn.text), pdfBtn);

  /* 7) 门控联动：清空简历 → 重新上锁 */
  const relock = await evaluate(`(() => {
    App.setResume('', null);
    const items = [...document.querySelectorAll('.nav-item')];
    return {
      visible: items.filter(i => !i.hidden && getComputedStyle(i).display !== 'none').map(i => i.dataset.tab),
      tab: document.querySelector('.panel.is-active').dataset.panel,
      optHidden: document.getElementById('optWrap').hidden
    };
  })()`);
  check("清空简历后重新上锁", relock.visible.length === 2, relock.visible);

  /* 8) 重新载入 + 格式批注共存 */
  await evaluate(`(() => {
    App.setResume(window.DEMO_RESUME.text, { source: 'file', filename: 'demo.docx', kind: 'docx',
      lines: window.DEMO_RESUME.text.split('\\n').length, chars: window.DEMO_RESUME.text.length,
      pages: 3, format: ${JSON.stringify(FORMAT)} });
    return 1;
  })()`);
  await sleep(1000);
  const fmt = await evaluate(`(() => ({
    hidden: document.getElementById('formatCard').hidden,
    notes: document.querySelectorAll('.format-note').length,
    engine: (window.__lastResult._meta || {}).engine,
    issues: document.querySelectorAll('#questionList .q-item').length,
    tabs: [...document.querySelectorAll('.nav-item')].filter(i => !i.hidden).length
  }))()`);
  check("文档格式批注仍挂在引擎结果上", !fmt.hidden && fmt.notes >= 4 && fmt.engine === "resume-engine", fmt);
  check("格式批注不影响疑问条数", fmt.issues > 0, fmt.issues);
  check("重新载入后导航仍解锁", fmt.tabs === 6, fmt.tabs);

  /* 9) JD 录入 → 重算 */
  await evaluate(`(() => { App.setTab('optimize'); return 1; })()`);
  await sleep(200);
  const jdPage = await evaluate(`(() => {
    const ta = document.getElementById('jdText');
    const prefilled = ta.value.length;
    ta.value = window.DEMO_RESUME.jd + '另外要求：有会员积分体系搭建经验。';
    document.getElementById('btnJdSave').click();
    return { prefilled, stored: JSON.parse(localStorage.getItem('resume-opt.state.v1')).jdText.length };
  })()`);
  await sleep(900);
  const jdAfter = await evaluate(`(() => ({
    tab: document.querySelector('.panel.is-active').dataset.panel,
    gaps: document.querySelectorAll('#proJd .pro-jd-miss .kw').length
  }))()`);
  check("JD 页预填已保存的 JD", jdPage.prefilled > 40, jdPage.prefilled);
  check("保存 JD 后回到审阅页并重算", jdAfter.tab === "scan" && jdAfter.gaps > 0, jdAfter);

  /* 9.5) 深审页冒烟：门控解锁后能进，且有自己的块 */
  const audit = await evaluate(`(() => {
    App.setTab('audit');
    const panel = document.getElementById('panel-audit');
    return {
      tab: document.querySelector('.panel.is-active').dataset.panel,
      shown: !panel.hidden,
      text: panel.textContent.trim().length,
      h1: panel.querySelector('h1') ? panel.querySelector('h1').textContent : ''
    };
  })()`);
  check("深审页可进且有内容", audit.tab === "audit" && audit.shown && audit.text > 300, audit);

  /* 10) 截图 */
  await evaluate(`(() => { App.setTab('scan'); window.scrollTo(0, 0); return 1; })()`);
  await sleep(400);
  let shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage3-scan.png"), Buffer.from(shot.data, "base64"));

  await evaluate(`(() => { App.setTab('optimize'); window.scrollTo(0, 0); return 1; })()`);
  await sleep(300);
  shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage3-optimize.png"), Buffer.from(shot.data, "base64"));

  await evaluate(`(() => { App.setTab('plan'); window.scrollTo(0, 0); return 1; })()`);
  await sleep(300);
  shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage3-plan.png"), Buffer.from(shot.data, "base64"));

  /* 11) 窄屏 */
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await evaluate('(window.dispatchEvent(new Event("resize")), 1)');
  await sleep(700);
  const mobile = await evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    cols: getComputedStyle(document.querySelector('#planBody .plan-three')).gridTemplateColumns.split(' ').length
  }))()`);
  check("390 宽无横向溢出", mobile.overflow <= 1, mobile);
  check("小屏规划三列塌成单列", mobile.cols === 1, mobile.cols);

  shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage3-plan-mobile.png"), Buffer.from(shot.data, "base64"));

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