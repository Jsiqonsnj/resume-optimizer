/* =========================================================
 * scan.js — 功能 6 + 7：HR 逐行扫描、圈画疑问点、追问清单
 * ---------------------------------------------------------
 * 核心约束：
 *   - 动画全部由 requestAnimationFrame 驱动，行位置只在渲染后计算一次；
 *   - 正常行快速扫过，接近疑问行时减速，敲两下才圈；
 *   - 圈是手绘风 SVG 路径，用 stroke-dashoffset 描边；
 *   - 颜色严格按 type 映射（vague 灰 / data-doubt 红 / timeline 橙 /
 *     jd-mismatch 蓝 / empty-desc 黄）；
 *   - 上传后自动进入本页并开跑（resume:change 事件）。
 * ========================================================= */

(function () {
  "use strict";

  var SCAN_STORE = "resume-opt.scan.v1";

  var el = {};
  var lines = [];
  var lineEls = [];
  var issueByLine = {};
  var issues = [];
  var circles = {};
  var text = "";
  var running = false;
  var cancelled = false;
  var speed = 1;
  var resolved = {};
  var scanned = false;

  /* ------------------------------ 工具 ------------------------------ */

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hashText(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function keyOf(issue) {
    return hashText(text) + ":" + issue.lineIndex + ":" + issue.excerpt;
  }

  function typeMeta(type) {
    var meta = (window.Engine && Engine.ISSUE_TYPE_META) || {};
    return meta[type] || { label: type, color: "#8A9099" };
  }

  function avatarSvg() {
    return '' +
      '<svg class="hr-avatar" viewBox="0 0 64 64" role="img" aria-label="HR 形象">' +
        '<circle cx="32" cy="32" r="30" fill="#F3F5F7" stroke="#1B3A57" stroke-width="2"/>' +
        '<path d="M14 46c4-8 12-11 18-11s14 3 18 11" fill="#DDE5EC" stroke="#1B3A57" stroke-width="2"/>' +
        '<circle cx="32" cy="26" r="12" fill="#FFF" stroke="#1B3A57" stroke-width="2"/>' +
        '<path d="M22 24h8M34 24h8" stroke="#1B3A57" stroke-width="2"/>' +
        '<circle cx="26" cy="27" r="2.2" fill="#1B3A57"/>' +
        '<circle cx="38" cy="27" r="2.2" fill="#1B3A57"/>' +
        '<path d="M28 32q4 3 8 0" stroke="#1B3A57" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        '<path d="M20 22a12 12 0 0 1 24 0" fill="none" stroke="#1B3A57" stroke-width="2" opacity=".35"/>' +
      '</svg>';
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function renderPaper() {
    el.paperLines.innerHTML = "";
    el.inkLayer.innerHTML = "";

    issueByLine = {};
    issues.forEach(function (issue, i) {
      var arr = issueByLine[issue.lineIndex] || (issueByLine[issue.lineIndex] = []);
      arr.push({ index: i, issue: issue });
    });

    lines.forEach(function (line, idx) {
      var div = document.createElement("div");
      div.className = "line";
      div.dataset.line = String(idx);

      var items = (issueByLine[idx] || []).slice().sort(function (a, b) {
        return line.indexOf(a.issue.excerpt) - line.indexOf(b.issue.excerpt);
      });

      var cursor = 0;
      items.forEach(function (item) {
        var pos = line.indexOf(item.issue.excerpt, cursor);
        if (pos === -1) pos = line.indexOf(item.issue.excerpt);
        if (pos === -1) return;
        if (pos > cursor) div.appendChild(document.createTextNode(line.slice(cursor, pos)));
        var mark = document.createElement("mark");
        mark.className = "excerpt excerpt--" + item.issue.type;
        mark.dataset.issue = String(item.index);
        mark.textContent = item.issue.excerpt;
        div.appendChild(mark);
        cursor = pos + item.issue.excerpt.length;
      });
      if (cursor < line.length) div.appendChild(document.createTextNode(line.slice(cursor)));
      if (!line.length) div.innerHTML = "&nbsp;";

      el.paperLines.appendChild(div);
    });

    lineEls = Array.prototype.slice.call(el.paperLines.querySelectorAll(".line"));
    // SVG 必须与 paperInner 的 padding box 严格 1:1，否则 viewBox 缩放会让圈错位
    var layerW = el.paperInner.clientWidth;
    var layerH = Math.max(el.paperInner.scrollHeight, el.paperInner.clientHeight);
    el.inkLayer.setAttribute("viewBox", "0 0 " + layerW + " " + layerH);
    el.inkLayer.style.width = layerW + "px";
    el.inkLayer.style.height = layerH + "px";
  }

  function renderQuestions() {
    el.questionsEmpty.hidden = issues.length > 0;
    el.questionList.innerHTML = "";

    issues.forEach(function (issue, i) {
      var meta = typeMeta(issue.type);
      var li = document.createElement("li");
      li.className = "q-item";
      li.id = "q-" + i;
      li.style.setProperty("--q-color", meta.color);
      li.innerHTML = '' +
        '<div class="q-head">' +
          '<span class="q-type"><i class="dot"></i>' + escapeHtml(meta.label) + '</span>' +
          '<span class="q-line">第 ' + (issue.lineIndex + 1) + ' 行</span>' +
          '<span class="q-state" hidden>已处理</span>' +
        '</div>' +
        '<p class="q-excerpt">「' + escapeHtml(issue.excerpt) + '」</p>' +
        '<p class="q-question">HR：' + escapeHtml(issue.question) + '</p>' +
        '<div class="q-actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-act="detail">细化这一条</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-act="proof">提供真实性证明</button>' +
        '</div>' +
        '<div class="q-form" hidden>' +
          '<textarea class="textarea textarea--sm" rows="3"></textarea>' +
          '<div class="row row--tight">' +
            '<button type="button" class="btn btn--primary btn--sm" data-act="generate">生成改写建议</button>' +
            '<button type="button" class="btn btn--ghost btn--sm" data-act="cancel">收起</button>' +
          '</div>' +
        '</div>' +
        '<div class="q-result" hidden>' +
          '<p class="q-rewritten"></p>' +
          '<p class="q-advice"></p>' +
        '</div>';
      el.questionList.appendChild(li);

      var saved = resolved[keyOf(issue)];
      if (saved) applyResolved(li, saved);
    });

    updateProgress();
  }

  function renderFormat(formatIssues) {
    var meta = App.state.resumeMeta;
    var isDoc = meta && meta.source === "file";
    if (!isDoc) {
      el.formatCard.hidden = true;
      return;
    }

    var list = formatIssues || [];
    el.formatCard.hidden = false;
    el.formatCount.textContent = list.length ? list.length + " 条" : "没抓到明显问题";

    if (!list.length) {
      el.formatNotes.innerHTML = '<p class="empty-text">这份文档在字号、页数、联系方式、分区上没有明显格式问题。</p>';
      return;
    }

    el.formatNotes.innerHTML = list.map(function (f) {
      return '' +
        '<div class="format-note format-note--' + (f.level || "info") + '">' +
          '<div class="format-avatar">' + avatarSvg() + '</div>' +
          '<div class="format-body">' +
            '<span class="format-label">' + escapeHtml(f.label) + '</span>' +
            '<p class="format-thought">（' + escapeHtml(f.thought) + '）</p>' +
          '</div>' +
        '</div>';
    }).join("");
  }

  /* ------------------------------ 状态 ------------------------------ */

  function setStatus(msg, kind) {
    el.scanStatus.textContent = msg;
    el.scanStatus.className = "scan-status" + (kind ? " is-" + kind : "");
  }

  function updateProgress() {
    var total = issues.length;
    var done = issues.filter(function (it) { return !!resolved[keyOf(it)]; }).length;
    el.questionsProgress.textContent = "已解决 " + done + " / " + total;
    el.progressBar.style.width = total ? (done / total * 100) + "%" : "0%";
    el.progressBar.parentNode.classList.toggle("is-done", total > 0 && done === total);
  }

  function applyResolved(li, saved) {
    li.classList.add("is-resolved");
    var badge = li.querySelector(".q-state");
    if (badge) badge.hidden = false;
    var result = li.querySelector(".q-result");
    result.hidden = false;
    result.querySelector(".q-rewritten").textContent = "改写：" + saved.rewritten;
    result.querySelector(".q-advice").textContent = "面试呈现：" + saved.advice;
  }

  /* ------------------------------ 笔与圈 ------------------------------ */

  function penPoint(x, y) {
    el.pen.style.transform = "translate3d(" + x + "px," + y + "px,0)";
  }

  // 统一换算到 paperInner 的本地坐标（与 SVG 的 user unit 一致）
  function localRect(node) {
    var base = el.paperInner.getBoundingClientRect();
    var r = node.getBoundingClientRect();
    return {
      left: r.left - base.left,
      top: r.top - base.top,
      width: r.width,
      height: r.height
    };
  }

  function lineBox(lineEl) { return localRect(lineEl); }
  function markBox(mark) { return localRect(mark); }

  function tween(ms, onUpdate) {
    return new Promise(function (resolve) {
      var start = performance.now();
      function frame(now) {
        if (cancelled) return resolve(false);
        var p = Math.min(1, (now - start) / (ms / speed));
        onUpdate(p);
        if (p < 1) requestAnimationFrame(frame);
        else resolve(true);
      }
      requestAnimationFrame(frame);
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      var timer = setTimeout(resolve, ms / speed);
      el.scanTimers.push(timer);
    });
  }

  function handEllipse(cx, cy, rx, ry, seed) {
    var n = 22;
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2 - 0.25;
      var wob = 1 + Math.sin(i * 1.8 + seed) * 0.035 + Math.cos(i * 0.7 + seed * 0.5) * 0.02;
      pts.push([
        cx + Math.cos(a) * rx * wob + Math.sin(i * 2.3 + seed) * 0.8,
        cy + Math.sin(a) * ry * wob + Math.cos(i * 1.9 + seed) * 0.6
      ]);
    }
    return "M" + pts.map(function (p) {
      return p[0].toFixed(1) + " " + p[1].toFixed(1);
    }).join(" L");
  }

  function createCircle(issue, mark, animate) {
    var box = markBox(mark);
    var padX = 12;
    var padY = 8;
    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var rx = box.width / 2 + padX;
    var ry = Math.max(box.height / 2 + padY, 15);
    var color = typeMeta(issue.type).color;
    var seed = Math.random() * 6;

    var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "ink-circle");
    g.dataset.issue = String(issue.lineIndex + ":" + issue.excerpt);

    var d1 = handEllipse(cx, cy, rx, ry, seed);
    var d2 = handEllipse(cx + 1, cy + 1.5, rx + 2.5, ry + 1.5, seed + 1.3);

    [d1, d2].forEach(function (d, idx) {
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", idx === 0 ? "2.1" : "1.1");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("opacity", idx === 0 ? "0.95" : "0.55");
      g.appendChild(path);
    });

    el.inkLayer.appendChild(g);

    if (animate) {
      var paths = Array.prototype.slice.call(g.querySelectorAll("path"));
      paths.forEach(function (path) {
        var len = path.getTotalLength();
        path.style.strokeDasharray = len + " " + len;
        path.style.strokeDashoffset = String(len);
        path.style.transition = "stroke-dashoffset " + Math.round(620 / speed) + "ms cubic-bezier(.3,.7,.4,1)";
      });
      void el.inkLayer.getBoundingClientRect();
      paths.forEach(function (path) { path.style.strokeDashoffset = "0"; });
    }

    circles[issue.lineIndex + ":" + issue.excerpt] = g;
    return g;
  }

  function showBubble(issue, mark, lineEl) {
    var box = markBox(mark);
    var lineTop = lineEl.offsetTop;
    var width = Math.min(300, el.paperInner.clientWidth - 40);
    var left = box.left + box.width / 2 - width / 2;
    left = clamp(left, 10, el.paperInner.clientWidth - width - 10);
    var top = lineTop - 92;
    if (top < 6) top = lineTop + lineEl.offsetHeight + 10;

    el.bubbleText.textContent = "（" + issue.question + "）";
    el.hrBubble.style.width = width + "px";
    el.hrBubble.style.left = left + "px";
    el.hrBubble.style.top = top + "px";
    el.hrBubble.dataset.issue = String(issue.lineIndex + ":" + issue.excerpt);
    el.hrBubble.hidden = false;
  }

  function hideBubble() {
    el.hrBubble.hidden = true;
  }

  function ripple(x, y) {
    var r = document.createElement("span");
    r.className = "tap-ripple";
    r.style.left = x + "px";
    r.style.top = y + "px";
    el.paperInner.appendChild(r);
    setTimeout(function () { r.remove(); }, 620);
  }

  /* ------------------------------ 动画主流程 ------------------------------ */

  async function animateLine(lineEl) {
    var box = lineBox(lineEl);
    var y = box.top + box.height * 0.55;
    await tween(110, function (p) {
      penPoint(4 + (box.width - 8) * p, y);
    });
  }

  async function tapPen(x, y) {
    el.pen.classList.add("is-tap");
    ripple(x, y);
    setTimeout(function () { el.pen.classList.remove("is-tap"); }, 130);
    await wait(150);
    el.pen.classList.add("is-tap");
    ripple(x + 3, y + 2);
    el.paperLines.classList.add("is-shake");
    setTimeout(function () { el.pen.classList.remove("is-tap"); }, 130);
    setTimeout(function () { el.paperLines.classList.remove("is-shake"); }, 170);
    await wait(170);
  }

  async function animateIssue(issue, i) {
    var lineEl = lineEls[issue.lineIndex];
    if (!lineEl) return;
    var mark = lineEl.querySelector('mark[data-issue="' + i + '"]');
    if (!mark) return;

    var lineBoxV = lineBox(lineEl);
    var box = markBox(mark);
    var y = lineBoxV.top + lineBoxV.height * 0.55;
    var targetX = box.left + Math.min(10, box.width * 0.2);

    await tween(180, function (p) {
      var startX = box.left * 0.15;
      penPoint(startX + (targetX - startX) * p, y);
    });
    if (cancelled) return;

    await tapPen(targetX, y);
    if (cancelled) return;
    el.pen.classList.add("is-drawing");
    createCircle(issue, mark, true);
    await wait(680);
    el.pen.classList.remove("is-drawing");
    if (cancelled) return;

    showBubble(issue, mark, lineEl);
    await wait(1500);
    hideBubble();
  }

  async function runScan() {
    if (!issues.length) return;
    if (running) return;

    running = true;
    cancelled = false;
    el.scanTimers = [];
    el.pen.hidden = false;
    hideBubble();
    el.inkLayer.innerHTML = "";
    circles = {};
    el.btnScanStart.disabled = true;
    el.btnScanSkip.hidden = false;
    el.btnScanStart.textContent = "扫描中…";
    setStatus("HR 正在逐行看…", "run");

    for (var i = 0; i < lines.length; i++) {
      if (cancelled) break;
      var item = (issueByLine[i] || [])[0];
      if (item) {
        await animateIssue(item.issue, item.index);
      } else {
        await animateLine(lineEls[i]);
      }
    }

    running = false;
    scanned = true;
    el.btnScanStart.disabled = false;
    el.btnScanSkip.hidden = true;

    if (cancelled) {
      drawAllInstant();
      setStatus("已跳到结果：圈出 " + issues.length + " 处", "done");
    } else {
      setStatus("审阅完成：圈出 " + issues.length + " 处，下面逐条处理", "done");
    }
    el.btnScanStart.textContent = "重新审阅";
    el.pen.hidden = true;
  }

  function drawAllInstant() {
    scanned = true;
    hideBubble();
    el.inkLayer.innerHTML = "";
    circles = {};
    issues.forEach(function (issue, i) {
      var lineEl = lineEls[issue.lineIndex];
      if (!lineEl) return;
      var mark = lineEl.querySelector('mark[data-issue="' + i + '"]');
      if (mark) createCircle(issue, mark, false);
    });
  }

  /* ------------------------------ 分析与自动审阅 ------------------------------ */

  async function analyzeNow(autoRun) {
    text = App.state.resumeText || "";
    lines = text.split(/\r\n|\r|\n/);
    if (!text.trim()) {
      setStatus("先在上传页放一份简历", "warn");
      el.btnScanStart.disabled = true;
      return null;
    }

    el.btnScanStart.disabled = true;
    setStatus("正在分析…", "run");

    try {
      var context = (App.state.resumeMeta && App.state.resumeMeta.format) || null;
      var result = await window.analyze(text, App.state.jdText || "", App.industryLabel() || "", context);
      window.__lastResult = result; // 调试与联调脚本用（只读，不参与渲染）

      issues = (result.issues || []).filter(function (it) {
        return Number.isInteger(it.lineIndex) && lines[it.lineIndex] !== undefined &&
          lines[it.lineIndex].indexOf(it.excerpt) !== -1;
      });

      resolved = loadResolutions();
      renderPaper();
      renderQuestions();
      renderFormat(result.formatIssues || []);
      renderLevel(result);
      if (window.ReportView) window.ReportView.render(result.professional || null);
      el.scoreValue.textContent = result.score;
      el.issueCount.textContent = issues.length + " 处";
      if (scanned) drawAllInstant(); // 换行业后重算，已看完的情况下直接补圈
      var note = (result._meta && result._meta.note) || "";
      if (!issues.length && note) {
        setStatus(note, "warn");
      } else {
        setStatus("已分析：圈出 " + issues.length + " 处，共 " + lines.length + " 行", "done");
      }
      el.btnScanStart.disabled = false;
      el.btnScanStart.textContent = "开始 HR 审阅";

      if (autoRun) {
        await new Promise(function (r) { setTimeout(r, 260); });
        runScan();
      }
      return result;
    } catch (err) {
      console.error(err);
      setStatus("分析失败：" + (err && err.message ? err.message : err), "warn");
      el.btnScanStart.disabled = false;
      return null;
    }
  }

  function renderLevel(result) {
    var pro = result && result.professional;
    if (!el.levelValue) return;
    if (pro && pro.level) {
      el.levelValue.hidden = false;
      el.levelValue.textContent = pro.level + " 档";
      el.levelValue.className = "scan-level is-" + String(pro.level).toLowerCase();
      el.levelValue.title = pro.capped
        ? ("原始分 " + pro.rawTotal + "，因 " + pro.nFatal + " 处致命问题压到 " + pro.cap)
        : "五维分相加，无致命问题封顶";
    } else {
      el.levelValue.hidden = true;
    }
  }

  function loadResolutions() {
    try {
      var raw = localStorage.getItem(SCAN_STORE);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && parsed.hash === hashText(text) ? (parsed.map || {}) : {};
    } catch (err) {
      return {};
    }
  }

  function saveResolutions() {
    try {
      localStorage.setItem(SCAN_STORE, JSON.stringify({ hash: hashText(text), map: resolved }));
    } catch (err) { /* 忽略配额错误 */ }
  }

  /* ------------------------------ 追问交互 ------------------------------ */

  function bindQuestions() {
    el.questionList.addEventListener("click", async function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;

      var li = btn.closest(".q-item");
      var index = parseInt(li.id.replace("q-", ""), 10);
      var issue = issues[index];
      if (!issue) return;

      var act = btn.dataset.act;

      if (act === "detail" || act === "proof") {
        li.dataset.mode = act;
        var form = li.querySelector(".q-form");
        var ta = form.querySelector("textarea");
        form.hidden = false;
        ta.placeholder = act === "detail"
          ? issue.followUp.hint + "。可以直接写：背景 / 我的动作 / 结果数据。"
          : "数据从哪来？测试报告、监控截图、GitHub 链接、复盘文档都可以说。";
        ta.focus();
        return;
      }

      if (act === "cancel") {
        li.querySelector(".q-form").hidden = true;
        return;
      }

      if (act === "generate") {
        var formEl = li.querySelector(".q-form");
        var value = formEl.querySelector("textarea").value.trim();
        if (!value) {
          App.toast("先写点具体内容，再生成改写", "warn");
          return;
        }
        btn.disabled = true;
        btn.textContent = "生成中…";
        try {
          var mode = li.dataset.mode === "proof" ? "proof" : "detail";
          var payload = mode === "proof" ? { proof: value, original: issue.excerpt } : { detail: value };
          var out = await window.refine(issue, payload);
          resolved[keyOf(issue)] = { rewritten: out.rewritten, advice: out.advice };
          saveResolutions();
          li.querySelector(".q-form").hidden = true;
          applyResolved(li, out);
          updateProgress();
          App.toast("已生成改写建议");
        } catch (err) {
          console.error(err);
          App.toast("生成失败，可再试一次", "warn");
        } finally {
          btn.disabled = false;
          btn.textContent = "生成改写建议";
        }
      }
    });

    el.questionList.addEventListener("click", function (e) {
      var state = e.target.closest(".q-state");
      if (!state) return;
      var li = state.closest(".q-item");
      li.classList.remove("is-resolved");
      var index = parseInt(li.id.replace("q-", ""), 10);
      var issue = issues[index];
      if (issue) {
        delete resolved[keyOf(issue)];
        saveResolutions();
        updateProgress();
        li.querySelector(".q-result").hidden = true;
        state.hidden = true;
        App.toast("已取消该条的处理状态");
      }
    });
  }

  function bindCircles() {
    el.inkLayer.addEventListener("mouseover", function (e) {
      var g = e.target.closest(".ink-circle");
      if (!g) return;
      g.classList.add("is-hover");
    });
    el.inkLayer.addEventListener("mouseout", function (e) {
      var g = e.target.closest(".ink-circle");
      if (g) g.classList.remove("is-hover");
    });
    el.inkLayer.addEventListener("click", function (e) {
      var g = e.target.closest(".ink-circle");
      if (!g) return;
      var key = g.dataset.issue;
      var idx = issues.findIndex(function (it) { return it.lineIndex + ":" + it.excerpt === key; });
      if (idx === -1) return;
      var li = document.getElementById("q-" + idx);
      if (!li) return;
      li.scrollIntoView({ behavior: "smooth", block: "center" });
      li.classList.add("is-flash");
      setTimeout(function () { li.classList.remove("is-flash"); }, 1200);
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  function init() {
    el = {
      paperInner: document.getElementById("paperInner"),
      paperLines: document.getElementById("paperLines"),
      inkLayer: document.getElementById("inkLayer"),
      pen: document.getElementById("pen"),
      hrBubble: document.getElementById("hrBubble"),
      bubbleText: document.getElementById("bubbleText"),
      scanStatus: document.getElementById("scanStatus"),
      btnScanStart: document.getElementById("btnScanStart"),
      btnScanSkip: document.getElementById("btnScanSkip"),
      speedGroup: document.getElementById("scanSpeed"),
      questionList: document.getElementById("questionList"),
      questionsEmpty: document.getElementById("questionsEmpty"),
      questionsProgress: document.getElementById("questionsProgress"),
      progressBar: document.getElementById("progressBar"),
      formatCard: document.getElementById("formatCard"),
      formatNotes: document.getElementById("formatNotes"),
      formatCount: document.getElementById("formatCount"),
      scoreValue: document.getElementById("scanScore"),
      levelValue: document.getElementById("scanLevel"),
      issueCount: document.getElementById("scanIssueCount"),
      scanTimers: []
    };
    if (!el.paperLines) return;

    el.hrBubble.innerHTML = avatarSvg() + '<div class="bubble-text" id="bubbleText"></div>';
    el.bubbleText = document.getElementById("bubbleText");

    el.btnScanStart.addEventListener("click", function () {
      analyzeNow(true);
    });

    el.btnScanSkip.addEventListener("click", function () {
      cancelled = true;
      App.toast("已跳过动画");
    });

    el.speedGroup.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-speed]");
      if (!btn) return;
      speed = Number(btn.dataset.speed) || 1;
      Array.prototype.forEach.call(el.speedGroup.querySelectorAll("[data-speed]"), function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      App.toast("速度 " + speed + "x");
    });

    bindQuestions();
    bindCircles();

    // 窗口尺寸变化后行位置会变，重排一次圈的位置
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (!issues.length || running) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        renderPaper();
        if (scanned) drawAllInstant();
      }, 180);
    });

    document.addEventListener("resume:change", async function () {
      // 上传后自动审阅
      text = App.state.resumeText || "";
      if (!text.trim()) return;
      if (running) {
        cancelled = true;
        await new Promise(function (r) { setTimeout(r, 220); });
      }
      App.setTab("scan");
      analyzeNow(true);
    });

    document.addEventListener("industry:change", function () {
      if (!running && App.state.resumeText) {
        // 行业变了，重新分析但不自动播放
        analyzeNow(false);
      }
    });

    document.addEventListener("jd:change", function () {
      // JD 换了，关键词覆盖 / 该投不该投 / 缺词清单全要重算，但不重播动画
      if (!running && App.state.resumeText) {
        analyzeNow(false);
      }
    });

    if (App.state.resumeText) {
      text = App.state.resumeText;
      analyzeNow(false);
    } else {
      setStatus("先在上传页放一份简历", "warn");
      el.btnScanStart.disabled = true;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();