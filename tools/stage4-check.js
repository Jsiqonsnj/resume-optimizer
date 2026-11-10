/* 阶段 4 联调：深审页（04 深审）
   用法：node tools/stage4-check.js
   前置：node tools/audit-test.js 全绿（引擎层）
   覆盖：导航门控 / 七项体检 / 逐行卡片七块 / 筛选 / 追问备答留存 / 导出 / 窄屏 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9344;
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

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-s4-"));

  const proc = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile,
    "--window-size=1440,1600",
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

  /* ---------- 0) 干净状态 ---------- */
  await evaluate("(() => { localStorage.clear(); sessionStorage.clear(); return 1; })()");
  await client.send("Page.reload");
  await sleep(1200);

  const boot = await evaluate(`(() => ({
    engine: !!(window.AuditEngine && AuditEngine.audit),
    view: !!(window.AuditView && AuditView.recompute),
    version: window.AuditEngine ? AuditEngine.VERSION : null,
    navTabs: [...document.querySelectorAll('.nav-item')].map(i => i.dataset.tab)
  }))()`);
  check("深审引擎与视图已加载", boot.engine && boot.view && !!boot.version, { v: boot.version });
  check("导航六格顺序：上传 / 知识库 / 审阅 / 深审 / 优化 / 规划",
    boot.navTabs.join(",") === "upload,knowledge,scan,audit,optimize,plan", boot.navTabs);

  const locked = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.nav-item')];
    App.setTab('audit');
    return {
      visible: items.filter(i => !i.hidden && getComputedStyle(i).display !== 'none').map(i => i.dataset.tab),
      after: document.querySelector('.panel.is-active').dataset.panel
    };
  })()`);
  check("没简历时深审不上锁不显示", locked.visible.length === 2 && locked.after === "upload", locked);

  /* ---------- 1) 载入示例 ---------- */
  await evaluate("(() => { App.setTab('upload'); document.getElementById('btnLoadDemo').click(); return 1; })()");
  await sleep(900);
  await evaluate("(() => { App.setTab('audit'); window.scrollTo(0, 0); return 1; })()");
  await sleep(700);

  const view = await evaluate(`(() => {
    const dims = [...document.querySelectorAll('#auditDims .audit-dim')];
    const counts = [...document.querySelectorAll('#auditCounts .audit-stat')];
    const engine = AuditEngine.audit(App.state.resumeText, {
      jd: App.state.jdText, industry: App.industryLabel() || '', jobTitle: ''
    });
    const navVisible = [...document.querySelectorAll('.nav-item')].filter(i => !i.hidden && getComputedStyle(i).display !== 'none').length;
    return {
      tab: document.querySelector('.panel.is-active').dataset.panel,
      bodyShown: !document.getElementById('auditBody').hidden,
      emptyShown: !document.getElementById('auditEmpty').hidden,
      navVisible: navVisible,
      score: document.getElementById('auditScore').textContent,
      engineScore: String(engine.overall),
      level: document.getElementById('auditLevel').textContent,
      engineLevel: engine.level,
      capShown: !document.getElementById('auditCap').hidden,
      capText: document.getElementById('auditCap').textContent,
      capped: engine.capped,
      headline: document.getElementById('auditAdvice').textContent,
      tags: document.querySelectorAll('#auditTags .audit-tag').length,
      dimNames: dims.map(d => d.querySelector('.audit-dim-name').textContent),
      dimScores: dims.map(d => d.querySelector('.audit-dim-score').textContent),
      engineDims: engine.dims.map(d => d.score),
      countLabels: counts.map(c => c.querySelector('span').textContent),
      countValues: counts.map(c => c.querySelector('strong').textContent),
      engineCounts: engine.counts,
      rowCards: document.querySelectorAll('#auditRows .arow').length,
      engineRows: engine.rows.length,
      filters: document.querySelectorAll('#auditFilters .afilter').length,
      engineVersion: document.getElementById('auditEngineTag').textContent
    };
  })()`);

  check("深审页可进入且正文可见", view.tab === "audit" && view.bodyShown && !view.emptyShown, view.tab);
  check("放简历后六格导航全解锁", view.navVisible === 6, view.navVisible);
  check("总分与引擎一致", view.score === view.engineScore, [view.score, view.engineScore]);
  check("档位与引擎一致", view.level.indexOf(view.engineLevel) === 0, [view.level, view.engineLevel]);
  check("封顶说明只在该显示时显示", view.capShown === view.capped,
    { shown: view.capShown, capped: view.capped, text: view.capText.slice(0, 40) });
  check("七维顺序与分数都来自引擎",
    view.dimNames.length === 7 && view.dimNames[0] === "详细度" &&
    view.dimScores.join(",") === view.engineDims.join(","), view.dimNames);
  check("五个统计块与引擎计数一致",
    view.countLabels.join(",") === "会被追问,该删,该补,逻辑,语言命中" &&
    view.countValues[0] === String(view.engineCounts.asks) &&
    view.countValues[3] === String(view.engineCounts.logic), view.countValues);
  check("逐行卡片数 = 引擎行数", view.rowCards === view.engineRows && view.rowCards > 3, view.rowCards);
  check("筛选项八个（全部 + 七类）", view.filters === 8, view.filters);
  check("引擎版本打在标签上", /AuditEngine/.test(view.engineVersion), view.engineVersion);

  /* ---------- 2) 行锚定：卡片上的行号与原文来自同一行 ---------- */
  const anchor = await evaluate(`(() => {
    const lines = App.state.resumeText.split('\\n');
    const cards = [...document.querySelectorAll('#auditRows .arow')];
    const bad = cards.filter(c => {
      const no = parseInt(c.querySelector('.arow-no').textContent.replace(/\\D/g, ''), 10);
      const text = c.querySelector('.arow-text').textContent;
      return !lines[no - 1] || lines[no - 1].trim() !== text.trim();
    });
    const openCards = cards.filter(c => c.classList.contains('is-open'));
    const openHighRisk = openCards.every(c => /追问 ×[123]/.test(c.querySelector('.arow-flags').textContent));
    return { total: cards.length, bad: bad.length, open: openCards.length, openHighRisk: openHighRisk };
  })()`);
  check("每张卡的行号都指回原文", anchor.bad === 0, anchor);
  check("默认只展开被追问最狠的两行", anchor.open === 2 && anchor.openHighRisk, anchor);

  /* ---------- 3) 展开一行：七块里该有的都在 ---------- */
  const expanded = await evaluate(`(() => {
    const card = document.querySelectorAll('#auditRows .arow')[0];
    card.querySelector('.arow-head').click();
    const heads = [...card.querySelectorAll('.ablock h4')].map(h => h.textContent.trim().slice(0, 8));
    const askBlock = card.querySelector('.ablock--ask');
    const qs = [...card.querySelectorAll('.aask-q')].map(q => q.textContent);
    return {
      open: card.classList.contains('is-open'),
      bodyShown: !card.querySelector('.arow-body').hidden,
      heads: heads,
      hasSkeleton: card.querySelectorAll('.aask-sk').length === qs.length && qs.length > 0,
      dup: qs.length !== new Set(qs).size,
      silly: qs.filter(q => /为什么用「[用做」]」/.test(q)).length,
      aria: card.querySelector('.arow-head').getAttribute('aria-expanded'),
      stripShown: !!card.querySelector('.atone-strip'),
      footNote: !!card.querySelector('.arow-foot-note')
    };
  })()`);
  check("点行头能展开", expanded.open && expanded.bodyShown && expanded.aria === "true", expanded.heads);
  check("展开后按 ①②③… 编号给判断", expanded.heads[0] && expanded.heads[0].startsWith("①"), expanded.heads);
  check("每条追问都有答法骨架", expanded.hasSkeleton, expanded.hasSkeleton);
  check("同一行不出现重复追问", expanded.dup === false, expanded.dup);
  check("没有「为什么用「用」」这类废问题", expanded.silly === 0, expanded.silly);
  check("卡片底部提醒「不替你编事实」", expanded.footNote, expanded.footNote);

  /* ---------- 3.5) 先动这三条 + 可填句式 ---------- */
  const top = await evaluate(`(() => {
    const engine = AuditEngine.audit(App.state.resumeText, { jd: App.state.jdText, industry: App.industryLabel() || '' });
    const items = [...document.querySelectorAll('#auditTopList .atop')];
    return {
      n: items.length, engineN: engine.topActions.length,
      counter: document.getElementById('auditTopCount').textContent,
      titles: items.map(i => i.querySelector('b').textContent),
      gains: items.map(i => i.querySelector('.atop-gain').textContent),
      hasWhy: items.every(i => i.querySelector('.atop-why').textContent.length > 6),
      hasDo: items.every(i => i.querySelector('.atop-do').textContent.length > 10),
      jumps: items.filter(i => i.querySelector('[data-jump]')).length
    };
  })()`);
  check("先动这三条 ≤3 且与引擎一致", top.n === top.engineN && top.n > 0 && top.n <= 3, { n: top.n, e: top.engineN });
  check("每条都给收益估算与具体做法", top.gains.every(g => /估/.test(g)) && top.hasDo && top.hasWhy, top.gains);
  check("可跳行的动作带跳转按钮", top.jumps > 0, top.jumps);

  const jump = await evaluate(`(() => {
    const btn = document.querySelector('#auditTopList [data-jump]');
    if (!btn) return { skipped: true };
    const line = btn.dataset.jump;
    btn.click();
    const card = document.querySelector('#auditRows .arow[data-line="' + line + '"]');
    return { line: line, found: !!card, open: card ? card.classList.contains('is-open') : false };
  })()`);
  check("点「跳到这一行」会展开对应卡片", jump.found && jump.open, jump);

  const pat = await evaluate(`(() => {
    const card = [...document.querySelectorAll('#auditRows .arow')].find(c => c.querySelector('.apat'));
    if (!card) return { skipped: true };
    card.querySelector('.arow-head').click();
    const s = card.querySelector('.apat-sentence').textContent;
    return {
      sentence: s,
      hasBracket: /\\[/.test(s),
      slots: card.querySelectorAll('.apat-slots li').length,
      holes: card.querySelectorAll('.apat-slots li.is-hole').length,
      copy: !!card.querySelector('[data-copy-pat]')
    };
  })()`);
  check("每条正文行给可填句式（四槽 + 占位）", pat.hasBracket && pat.slots === 4 && pat.copy, pat.sentence);

  /* ---------- 4) 筛选 ---------- */
  const filtered = await evaluate(`(() => {
    const engine = AuditEngine.audit(App.state.resumeText, { jd: App.state.jdText, industry: App.industryLabel() || '' });
    const expectCut = engine.rows.filter(x => x.cut.length > 0).length;
    const expectThin = engine.rows.filter(x => x.kind === 'bullet' && (x.detail.verdict === '太薄' || x.detail.verdict === '太空')).length;
    const btn = [...document.querySelectorAll('#auditFilters .afilter')].find(b => b.dataset.filter === 'cut');
    btn.click();
    const after = document.querySelectorAll('#auditRows .arow').length;
    const active = document.querySelectorAll('#auditFilters .afilter.is-active').length;
    const thinBtn = [...document.querySelectorAll('#auditFilters .afilter')].find(b => b.dataset.filter === 'thin');
    thinBtn.click();
    const thinAfter = document.querySelectorAll('#auditRows .arow').length;
    [...document.querySelectorAll('#auditFilters .afilter')].find(b => b.dataset.filter === 'all').click();
    return { expectCut, after, active, expectThin, thinAfter, all: document.querySelectorAll('#auditRows .arow').length };
  })()`);
  check("筛选「该删」只留带删点的行", filtered.after === filtered.expectCut && filtered.expectCut > 0, filtered);
  check("筛选「写得太薄」命中数正确", filtered.thinAfter === filtered.expectThin && filtered.expectThin > 0, filtered);
  check("筛选单选、切回全部恢复", filtered.active === 1 && filtered.all > filtered.after, filtered);

  /* ---------- 5) 追问总表 + 备答留存 ---------- */
  const asks = await evaluate(`(() => {
    const engine = AuditEngine.audit(App.state.resumeText, { jd: App.state.jdText, industry: App.industryLabel() || '' });
    const items = [...document.querySelectorAll('#auditAskList .aask')];
    const risks = items.map(i => i.querySelector('.aask-risk').className);
    const sorted = items.map(i => /is-high/.test(i.querySelector('.aask-risk').className) ? 3 :
      (/is-mid/.test(i.querySelector('.aask-risk').className) ? 2 : 1));
    const desc = sorted.every((v, i) => i === 0 || sorted[i - 1] >= v);
    items[0].querySelector('.aask-done').click();
    const tag = document.getElementById('auditAskCount').textContent;
    const bar = document.getElementById('auditAskBar').style.width;
    const stored = JSON.parse(localStorage.getItem('resume-opt.audit.v1') || '{}');
    const again = [...document.querySelectorAll('#auditAskList .aask')];
    return {
      count: items.length, engineAsks: engine.asks.length,
      tag: tag, bar: bar, desc: desc,
      doneClass: again[0].classList.contains('is-done'),
      storedN: stored.map ? Object.keys(stored.map).length : 0,
      hasSrc: items[0].querySelector('.aask-src').textContent.length > 5,
      hasSkeleton: items[0].querySelector('.aask-sk').textContent.length > 10
    };
  })()`);
  check("追问条数 = 引擎条数", asks.count === asks.engineAsks && asks.count > 10, asks.count);
  check("追问按风险从高到低排", asks.desc, asks.desc);
  check("每条带原文与答法", asks.hasSrc && asks.hasSkeleton, asks);
  check("标记已备答有反馈且落盘", asks.doneClass && /1 \//.test(asks.tag) && asks.storedN === 1,
    { tag: asks.tag, stored: asks.storedN });

  /* 重新载入后「已备答」还在 */
  await evaluate("(() => { App.setTab('audit'); AuditView.recompute(); return 1; })()");
  await sleep(400);
  const persisted = await evaluate(`(() => {
    const stored = JSON.parse(localStorage.getItem('resume-opt.audit.v1') || '{}');
    return { tag: document.getElementById('auditAskCount').textContent, mapped: stored.map ? Object.keys(stored.map).length : 0 };
  })()`);
  check("重算后备答进度仍在", /1 \//.test(persisted.tag) && persisted.mapped === 1, persisted);

  /* ---------- 6) 报告导出 ---------- */
  const md = await evaluate(`(() => {
    const e = AuditEngine.audit(App.state.resumeText, { jd: App.state.jdText, industry: App.industryLabel() || '' });
    const t = e.markdown();
    const secs = (t.match(/^## /gm) || []).length;
    const lines = (t.match(/第 \\d+ 行/g) || []).length;
    const btn = document.getElementById('auditExportMd');
    btn.click();
    return { len: t.length, secs: secs, lineRefs: lines, heads: t.split('\\n').filter(l => l.startsWith('## ')).map(l => l.slice(3, 9)), clicked: !!btn };
  })()`);
  check("报告十节齐全", md.secs === 10, md.heads);
  check("报告每条带行号", md.len > 2000 && md.lineRefs > 20, { len: md.len, refs: md.lineRefs });
  check("导出按钮可点（不抛错）", md.clicked, md.clicked);

  /* ---------- 6.3) 职能族 / JD 落位 / 答案判定 / 今日清单 ---------- */
  const fam = await evaluate(`(() => {
    const el = document.getElementById('auditFam');
    return { hidden: el.hidden, text: el.textContent };
  })()`);
  check("职能族口径可见（非通用时给出该族看什么）", fam.hidden || /型/.test(fam.text), fam);

  const jd = await evaluate(`(() => {
    const card = document.getElementById('auditJdCard');
    const groups = [...document.querySelectorAll('#auditJdBody .ajd-group')];
    const n = document.getElementById('auditJdCount').textContent;
    const sum = groups.reduce((a, g) => {
      const m = g.querySelector('h4').textContent.match(/·\\s*(\\d+)/);
      return a + (m ? Number(m[1]) : 0);
    }, 0);
    return {
      hidden: card.hidden, groups: groups.length, sum: sum,
      declared: Number((n.match(/\\d+/) || [0])[0])
    };
  })()`);
  check("JD 逐条落位三档齐全且数目对得上", !jd.hidden && jd.groups === 3 && jd.sum === jd.declared, jd);

  const ans = await evaluate(`(() => {
    const items = [...document.querySelectorAll('#auditAskList .aask')];
    const last = items[items.length - 1];
    if (!last) return { skipped: true };
    const box = last.querySelector('.aans-input');
    box.value = '3 个群 1200 人，但从多少提到多少我记不清了';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    last.querySelector('[data-check]').click();
    const re = [...document.querySelectorAll('#auditAskList .aask')].pop();
    return {
      grade: re.querySelector('.aask-grade') ? re.querySelector('.aask-grade').textContent : '',
      note: re.querySelector('.aans-note') ? re.querySelector('.aans-note').textContent : '',
      flags: re.querySelectorAll('.aans-flag').length,
      persisted: !!localStorage.getItem('resume-opt.audit.answers.v1')
    };
  })()`);
  check("答案判定给出分数、缺口与落盘", /分/.test(ans.grade) && ans.note.length > 4 && ans.persisted, ans);

  const todo = await evaluate(`(() => {
    const card = document.getElementById('auditTodoCard');
    const items = [...document.querySelectorAll('#auditTodoList .atodo')];
    const before = document.getElementById('auditTodoCount').textContent;
    items[0].querySelector('input').click();
    const after = document.getElementById('auditTodoCount').textContent;
    return {
      hidden: card.hidden, n: items.length, before: before, after: after,
      persisted: !!localStorage.getItem('resume-opt.audit.todo.v1'),
      strike: document.querySelector('#auditTodoList .atodo').classList.contains('is-done'),
      printBtn: !!document.getElementById('auditPrint')
    };
  })()`);
  check("今日清单可勾选、划线并落盘", !todo.hidden && todo.n > 0 && todo.persisted &&
    todo.before !== todo.after && todo.strike && todo.printBtn, todo);

  /* 清掉这一节留下的存档，别影响后面截图 */
  await evaluate(`(() => {
    localStorage.removeItem('resume-opt.audit.answers.v1');
    localStorage.removeItem('resume-opt.audit.todo.v1');
    localStorage.removeItem('resume-opt.audit.v1');
    AuditView.recompute();
    return 1;
  })()`);
  await sleep(400);

  /* ---------- 6.4) 几何量：溢出 / 零高 / 栅格 ---------- */
  const geom = await evaluate(`(() => {
    const bad = [];
    document.querySelectorAll('#panel-audit .card, #panel-audit .ablock, #panel-audit .arow, #panel-audit .atop, #panel-audit .apat, #panel-audit .aask').forEach(e => {
      if (e.scrollWidth > e.clientWidth + 2) bad.push((e.className || e.tagName) + ' ' + e.scrollWidth + '>' + e.clientWidth);
    });
    const zero = [...document.querySelectorAll('#panel-audit .card, #panel-audit .ablock')]
      .filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 8).length;
    return {
      overflowN: bad.length, overflow: bad.slice(0, 4), zero: zero,
      dims: getComputedStyle(document.getElementById('auditDims')).gridTemplateColumns.split(' ').length,
      grid: getComputedStyle(document.querySelector('.audit-grid')).gridTemplateColumns.split(' ').length
    };
  })()`);
  check("深审页零横向溢出、无零高块", geom.overflowN === 0 && geom.zero === 0, geom);
  check("桌面 4 列维度 / 2 列内容", geom.dims === 4 && geom.grid === 2, geom);

  /* ---------- 6.5) 改前改后：改一句 → 重新深审 ---------- */
  const diff = await evaluate(`(() => {
    const before = document.getElementById('auditDiff').hidden;
    const t = App.state.resumeText + "\\n- 用企业微信做社群分层运营，覆盖 8 个群 2400 人，30 日留存从 21% 提到 34%";
    App.setResume(t, App.state.resumeMeta || null);
    App.setTab('audit');
    AuditView.recompute();
    const el = document.getElementById('auditDiff');
    return { before, hidden: el.hidden, text: el.textContent, cls: el.className };
  })()`);
  check("改完重审能看见改前改后", diff.before === true && diff.hidden === false && /总分/.test(diff.text), diff.text);
  check("分数变化有方向（涨/跌不同色）", /is-up|is-down/.test(diff.cls), diff.cls);

  /* 还原成示例原文，避免影响后续截图 */
  await evaluate("(() => { App.setResume(window.DEMO_RESUME.text, null); App.setTab('audit'); return 1; })()");
  await sleep(500);

  /* ---------- 7) 截图 ---------- */
  await evaluate("(() => { App.setTab('audit'); window.scrollTo(0, 0); return 1; })()");
  await sleep(400);
  let shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage4-audit.png"), Buffer.from(shot.data, "base64"));

  await evaluate("(() => { document.getElementById('auditExpandAll').click(); return 1; })()");
  await sleep(400);
  shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage4-audit-expanded.png"), Buffer.from(shot.data, "base64"));

  /* ---------- 8) 窄屏 ---------- */
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await evaluate('(window.dispatchEvent(new Event("resize")), 1)');
  await sleep(600);
  const mobile = await evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    cols: getComputedStyle(document.querySelector('#auditRows .arow-grid')).gridTemplateColumns.split(' ').length,
    dimCols: getComputedStyle(document.getElementById('auditDims')).gridTemplateColumns.split(' ').length
  }))()`);
  check("390 宽无横向溢出", mobile.overflow <= 1, mobile);
  check("小屏逐行七块塌成单列", mobile.cols === 1 && mobile.dimCols === 1, mobile);
  shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage4-audit-mobile.png"), Buffer.from(shot.data, "base64"));
  await client.send("Emulation.clearDeviceMetricsOverride");

  /* ---------- 9) 清空简历 → 回到空状态 ---------- */
  const cleared = await evaluate(`(() => {
    App.setResume('', null);
    return {
      emptyShown: !document.getElementById('auditEmpty').hidden,
      bodyHidden: document.getElementById('auditBody').hidden,
      note: document.getElementById('auditEmptyNote').textContent.slice(0, 20),
      tabs: [...document.querySelectorAll('.nav-item')].filter(i => !i.hidden).length
    };
  })()`);
  check("清空简历后深审回到空状态", cleared.emptyShown && cleared.bodyHidden && cleared.note.length > 5, cleared);
  check("清空后导航重新上锁", cleared.tabs === 2, cleared.tabs);

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