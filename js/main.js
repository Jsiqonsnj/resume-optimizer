/* =========================================================
 * main.js — 应用外壳（阶段 0）
 *   - 五个 Tab 的切换与 hash 同步
 *   - 本地状态（行业 / 设置 / 文本）持久化
 *   - 顶栏行业常驻标签
 *   - 设置弹窗
 *   - 审阅页：引擎契约自检（唯一可用功能）
 * 后续阶段：upload.js / knowledge.js / scan.js / optimize.js / plan.js
 * 都在这里注册，不互相直接依赖。
 * ========================================================= */

(function () {
  "use strict";

  var STORE_KEY = "resume-opt.state.v1";
  var TABS = ["upload", "knowledge", "scan", "audit", "optimize", "plan"];

  var DEFAULT_STATE = {
    tab: "upload",
    industry: null,              // { category, sub, label }
    settings: { baseUrl: "", apiKey: "", model: "" },
    resumeText: "",
    resumeMeta: null,            // { source: 'paste'|'file', filename, kind, lines, chars, pages }
    jdText: ""
  };

  /* ------------------------------ 状态 ------------------------------ */

  var state = loadState();

  function loadState() {
    var base = JSON.parse(JSON.stringify(DEFAULT_STATE));
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return base;
      if (saved.industry && typeof saved.industry === "object") base.industry = saved.industry;
      if (saved.settings && typeof saved.settings === "object") {
        base.settings.baseUrl = saved.settings.baseUrl || "";
        base.settings.apiKey = saved.settings.apiKey || "";
        base.settings.model = saved.settings.model || "";
      }
      if (typeof saved.resumeText === "string") base.resumeText = saved.resumeText;
      if (saved.resumeMeta && typeof saved.resumeMeta === "object") base.resumeMeta = saved.resumeMeta;
      if (typeof saved.jdText === "string") base.jdText = saved.jdText;
      if (TABS.indexOf(saved.tab) !== -1) base.tab = saved.tab;
    } catch (err) {
      console.warn("[state] 读取失败，使用默认值", err);
    }
    return base;
  }

  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[state] 保存失败", err);
    }
  }

  /* ------------------------------ 元素 ------------------------------ */

  var el = {
    nav: document.querySelector(".nav-group"),
    navHint: document.getElementById("navHint"),
    navItems: Array.prototype.slice.call(document.querySelectorAll(".nav-item")),
    panels: Array.prototype.slice.call(document.querySelectorAll(".panel")),
    industryChip: document.getElementById("industryChip"),
    industryChipValue: document.getElementById("industryChipValue"),
    industryCurrentValue: document.getElementById("industryCurrentValue"),
    btnSettings: document.getElementById("btnSettings"),
    settingsModal: document.getElementById("settingsModal"),
    setBaseUrl: document.getElementById("setBaseUrl"),
    setApiKey: document.getElementById("setApiKey"),
    setModel: document.getElementById("setModel"),
    btnSettingsSave: document.getElementById("btnSettingsSave"),
    btnContractRun: document.getElementById("btnContractRun"),
    btnContractClear: document.getElementById("btnContractClear"),
    contractSummary: document.getElementById("contractSummary"),
    contractOutput: document.getElementById("contractOutput"),
    toastStack: document.getElementById("toastStack")
  };

  /* ------------------------------ Tab ------------------------------ */

  var GATED = ["scan", "audit", "optimize", "plan"];

  /* 有没有「已经跑过一趟审阅」—— 有简历就算解锁，导航里才出现后面四个 Tab */
  function isUnlocked() {
    return !!(state.resumeText && String(state.resumeText).trim().length >= 20);
  }

  function applyGate() {
    var open = isUnlocked();
    el.navItems.forEach(function (item) {
      if (GATED.indexOf(item.dataset.tab) === -1) return;
      if (open) {
        item.removeAttribute("hidden");
        item.removeAttribute("locked");
        item.disabled = false;
      } else {
        item.setAttribute("hidden", "");
        item.setAttribute("locked", "");
        item.disabled = true;
      }
    });
    if (el.navHint) el.navHint.hidden = open;
    return open;
  }

  function navHintText() {
    return "先在上传页放一份简历，审阅 / 深审 / 优化 / 规划会自动出现";
  }

  function tabFromHash() {
    var hash = String(location.hash || "").replace(/^#\/?/, "").trim();
    if (TABS.indexOf(hash) === -1) return null;
    if (GATED.indexOf(hash) !== -1 && !isUnlocked()) return null;
    return hash;
  }

  function setTab(name, opts) {
    if (TABS.indexOf(name) === -1) return;
    var options = opts || {};

    // 锁着的 Tab 点了不跳，只提示
    if (GATED.indexOf(name) !== -1 && !isUnlocked()) {
      if (!options.silent) toast(navHintText(), "warn");
      name = "upload";
    }

    el.navItems.forEach(function (item) {
      var active = item.dataset.tab === name;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
      item.tabIndex = active ? 0 : -1;
    });

    el.panels.forEach(function (panel) {
      var active = panel.dataset.panel === name;
      panel.classList.toggle("is-active", active);
      if (active) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "");
      }
    });

    state.tab = name;
    saveState();

    if (!options.silentHash) {
      try {
        history.replaceState(null, "", "#" + name);
      } catch (err) {
        location.hash = name;
      }
    }

    document.title = panelTitle(name) + " · 简历优化工作台";
    if (!options.noScroll) window.scrollTo({ top: 0, behavior: "auto" });
  }

  function panelTitle(name) {
    var map = {
      upload: "上传",
      knowledge: "知识库",
      scan: "审阅",
      audit: "深审",
      optimize: "优化",
      plan: "规划"
    };
    return map[name] || "简历优化工作台";
  }

  function bindTabs() {
    el.navItems.forEach(function (item) {
      item.addEventListener("click", function () {
        setTab(item.dataset.tab);
      });
      item.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        var dir = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1 : -1;
        var idx = TABS.indexOf(item.dataset.tab);
        var next = TABS[(idx + dir + TABS.length) % TABS.length];
        setTab(next);
        var target = el.navItems.filter(function (n) { return n.dataset.tab === next; })[0];
        if (target) target.focus();
      });
    });

    // 任何元素上的 data-goto="tab" 都能跳转
    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-goto]");
      if (!trigger) return;
      e.preventDefault();
      setTab(trigger.dataset.goto);
    });

    window.addEventListener("hashchange", function () {
      var next = tabFromHash();
      if (next && next !== state.tab) setTab(next, { silentHash: true });
    });
  }

  /* ------------------------------ 行业 ------------------------------ */

  function industryLabel() {
    var ind = state.industry;
    if (!ind) return "";
    if (ind.label) return ind.label;
    return [ind.category, ind.sub].filter(Boolean).join("-");
  }

  function renderIndustry() {
    var label = industryLabel();
    el.industryChipValue.textContent = label || "未选择";
    el.industryChipValue.classList.toggle("is-empty", !label);

    if (el.industryCurrentValue) {
      el.industryCurrentValue.textContent = label || "未选择";
    }
  }

  /* 供阶段 1 的知识库模块调用：App.setIndustry({category, sub}) */
  function setIndustry(industry) {
    state.industry = industry && (industry.label || industry.category)
      ? {
          category: industry.category || "",
          sub: industry.sub || "",
          label: industry.label || [industry.category, industry.sub].filter(Boolean).join("-")
        }
      : null;
    saveState();
    renderIndustry();
    document.dispatchEvent(new CustomEvent("industry:change", { detail: { industry: state.industry } }));
    return state.industry;
  }

  /* 供阶段 1 起的所有模块调用：写简历正文并广播事件 */
  function setResume(text, meta) {
    var wasLocked = !isUnlocked();
    state.resumeText = String(text == null ? "" : text);
    state.resumeMeta = meta ? Object.assign({}, meta, {
      lines: state.resumeText ? state.resumeText.split(/\r\n|\r|\n/).length : 0,
      chars: state.resumeText.replace(/\s/g, "").length
    }) : null;
    saveState();
    if (applyGate() && wasLocked) {
      toast("简历已载入，审阅 / 深审 / 优化 / 规划已解锁");
    }
    document.dispatchEvent(new CustomEvent("resume:change", {
      detail: { text: state.resumeText, meta: state.resumeMeta }
    }));
    return state.resumeText;
  }

  /* ------------------------------ 设置弹窗 ------------------------------ */

  var lastFocus = null;

  function openSettings() {
    lastFocus = document.activeElement;
    el.setBaseUrl.value = state.settings.baseUrl || "";
    el.setApiKey.value = state.settings.apiKey || "";
    el.setModel.value = state.settings.model || "";
    el.settingsModal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { el.setBaseUrl.focus(); }, 30);
  }

  function closeSettings() {
    el.settingsModal.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function bindSettings() {
    el.btnSettings.addEventListener("click", openSettings);

    el.settingsModal.addEventListener("click", function (e) {
      if (e.target.closest("[data-close-modal]")) closeSettings();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el.settingsModal.hidden) closeSettings();
      if (e.key === "Tab" && !el.settingsModal.hidden) trapFocus(e);
    });

    el.btnSettingsSave.addEventListener("click", function () {
      state.settings.baseUrl = el.setBaseUrl.value.trim();
      state.settings.apiKey = el.setApiKey.value.trim();
      state.settings.model = el.setModel.value.trim();
      saveState();
      closeSettings();
      toast("设置已保存到本机浏览器");
    });
  }

  function trapFocus(e) {
    var focusables = el.settingsModal.querySelectorAll(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------ Toast ------------------------------ */

  function toast(message, kind) {
    var node = document.createElement("div");
    node.className = "toast" + (kind === "warn" ? " toast--warn" : "");
    node.textContent = message;
    el.toastStack.appendChild(node);

    setTimeout(function () {
      node.classList.add("toast--out");
      setTimeout(function () { node.remove(); }, 220);
    }, 2600);
  }

  /* --------------------------- 契约自检 --------------------------- */

  function runContractCheck() {
    if (!window.Engine || typeof window.analyze !== "function") {
      toast("engine.js 未加载", "warn");
      return;
    }

    el.btnContractRun.disabled = true;
    el.btnContractRun.textContent = "运行中…";

    Engine.selfTest({ industry: industryLabel() || "互联网-后端" })
      .then(function (report) {
        renderContract(report);
        toast(report.ok ? "契约自检通过" : "契约自检未通过，见页面详情", report.ok ? "" : "warn");
      })
      .catch(function (err) {
        console.error(err);
        toast("自检异常：" + (err && err.message ? err.message : err), "warn");
      })
      .then(function () {
        el.btnContractRun.disabled = false;
        el.btnContractRun.textContent = "重新运行";
      });
  }

  function renderContract(report) {
    var result = report.result || {};
    var issues = Array.isArray(result.issues) ? result.issues : [];
    var lines = Engine.helpers.splitLines(report.input.resume);
    var types = {};
    issues.forEach(function (it) { types[it.type] = (types[it.type] || 0) + 1; });

    var covered = Object.keys(types);
    var missing = (Engine.ISSUE_TYPES || []).filter(function (t) { return covered.indexOf(t) === -1; });

    var checks = [
      {
        ok: report.resultCheck.ok,
        text: "analyze 返回值符合 schema" +
          (report.resultCheck.ok ? "" : "：" + report.resultCheck.errors.slice(0, 3).join("；"))
      },
      { ok: issues.length > 0, text: "issues 非空（" + issues.length + " 条）" },
      {
        ok: issues.every(function (it) {
          return Number.isInteger(it.lineIndex) && it.lineIndex >= 0 && it.lineIndex < lines.length;
        }),
        text: "lineIndex 全部落在 0 ~ " + Math.max(0, lines.length - 1) + " 行内"
      },
      {
        ok: issues.every(function (it) {
          var line = lines[it.lineIndex];
          return typeof line === "string" && line.indexOf(it.excerpt) !== -1;
        }),
        text: "excerpt 与原文逐字匹配（圈画可定位）"
      },
      {
        ok: missing.length === 0,
        text: missing.length === 0
          ? "5 种 type 全部覆盖"
          : "缺少 type：" + missing.join("、")
      },
      { ok: report.refineCheck.ok, text: "refine 返回 { rewritten, advice }" }
    ];

    var cellCount = issues.length;
    var summary = "" +
      '<div class="summary-head">' +
        '<span class="status ' + (report.ok ? "status--ok" : "status--bad") + '">' +
          '<span class="status-dot"></span>' + (report.ok ? "通过" : "未通过") +
        "</span>" +
        '<span class="summary-meta">engine ' + Engine.VERSION + " · 模式 " + Engine.MODE + "</span>" +
      "</div>" +
      '<div class="summary-grid">' +
        cell("问题数", cellCount) +
        cell("评分", result.score) +
        cell("JD 缺口", (result.jdGaps || []).length) +
        cell("改写建议", (result.suggestions || []).length) +
        cell("简历行数", lines.length) +
      "</div>" +
      '<ul class="check-list">' +
        checks.map(function (c) {
          return '<li><span class="ck ' + (c.ok ? "ck--ok" : "ck--bad") + '">' +
            (c.ok ? "✓" : "✕") + "</span><span>" + escapeHtml(c.text) + "</span></li>";
        }).join("") +
      "</ul>";

    el.contractSummary.innerHTML = summary;
    el.contractSummary.hidden = false;

    el.contractOutput.textContent = JSON.stringify(
      { analyze: report.result, refine: report.refined },
      null,
      2
    );
    el.contractOutput.hidden = false;
  }

  function cell(k, v) {
    return '<div class="summary-cell"><span class="k">' + k + '</span><span class="v">' + v + "</span></div>";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindContract() {
    if (!el.btnContractRun) return;

    el.btnContractRun.addEventListener("click", runContractCheck);

    el.btnContractClear.addEventListener("click", function () {
      el.contractSummary.hidden = true;
      el.contractSummary.innerHTML = "";
      el.contractOutput.hidden = true;
      el.contractOutput.textContent = "";
      el.btnContractRun.textContent = "运行自检";
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  function init() {
    bindTabs();
    bindSettings();
    bindContract();
    renderIndustry();
    applyGate();

    el.industryChip.addEventListener("click", function () { setTab("knowledge"); });

    setTab(tabFromHash() || state.tab, { silentHash: false, noScroll: true, silent: true });

    // 首次落地只提示一次，直接告诉他下一步该做什么
    var hinted = null;
    try { hinted = sessionStorage.getItem("resume-opt:hinted"); } catch (err) { hinted = null; }
    if (!hinted) {
      try { sessionStorage.setItem("resume-opt:hinted", "1"); } catch (err) { /* 隐私模式忽略 */ }
      setTimeout(function () {
        toast(isUnlocked() ? "简历已在本地，可以直接去「审阅」或「深审」" : "先放一份简历：审阅 / 深审 / 优化 / 规划会自动出现");
      }, 650);
    }

    console.info("[app] 已启动 · Engine " + (window.Engine ? Engine.VERSION : "未加载") +
      " · 解锁=" + isUnlocked());
  }

  /* 供 JD 模块调用：目标岗位 JD 变了，全站的匹配结果跟着变 */
  function setJd(text) {
    state.jdText = String(text || "");
    saveState();
    document.dispatchEvent(new CustomEvent("jd:change", { detail: { jdText: state.jdText } }));
    return state.jdText;
  }

  /* 供后续模块复用（阶段 1 起的 upload.js / knowledge.js 等） */
  window.App = {
    state: state,
    saveState: saveState,
    setTab: setTab,
    setIndustry: setIndustry,
    setResume: setResume,
    setJd: setJd,
    industryLabel: industryLabel,
    isUnlocked: isUnlocked,
    applyGate: applyGate,
    toast: toast,
    el: el
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();