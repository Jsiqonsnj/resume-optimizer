/* =========================================================
 * audit-view.js — 「深审」面板：把 AuditEngine 的结果画出来
 * ---------------------------------------------------------
 * 页面结构：
 *   七项体检（总分 + 7 条分维 + 统计）
 *   → 逐行过堂（可筛选、可展开：每行七件事）
 *   → 追问总表（可标「已备答」，带进度）
 *   → AI 味词表 / 该删 / 该补 / 逻辑 / 没数字怎么补
 *   → 导出 Markdown
 *
 * 这一层不判断，只负责把引擎的结论排得能读、能点、能复制。
 * 判断全部在 engine-audit.js 里，改判断别改这里。
 * ========================================================= */

(function (global) {
  "use strict";

  var STORE = "resume-opt.audit.v1";
  var el = {};
  var cur = null;      // 当前审计结果
  var filter = "all";
  var openSet = {};    // 展开了哪几行（按行号）
  var doneMap = {};    // 已备答的追问
  var hashOf = "";

  var FILTERS = [
    { key: "all", label: "全部", test: function () { return true; } },
    {
      key: "ask", label: "高危追问", test: function (x) {
        return x.ask.some(function (a) { return a.risk >= 3; });
      }
    },
    {
      key: "thin", label: "写得太薄", test: function (x) {
        return x.kind === "bullet" && (x.detail.verdict === "太薄" || x.detail.verdict === "太空");
      }
    },
    { key: "truth", label: "真实性", test: function (x) { return x.truth.risks.length > 0; } },
    { key: "cut", label: "该删", test: function (x) { return x.cut.length > 0; } },
    { key: "add", label: "该补", test: function (x) { return x.add.length > 0; } },
    { key: "tone", label: "AI 味", test: function (x) { return x.tone.hits.length > 0; } },
    { key: "logic", label: "逻辑", test: function (x) { return x.logic.length > 0; } }
  ];

  /* ------------------------------ 工具 ------------------------------ */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function hashText(t) {
    var h = 5381, i;
    for (i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function askKey(a) {
    return a.lineNo + "|" + a.kind + "|" + a.question.slice(0, 24);
  }

  function riskLabel(r) {
    return r >= 3 ? "必问" : (r === 2 ? "很可能" : "可能");
  }

  function riskClass(r) {
    return r >= 3 ? "is-high" : (r === 2 ? "is-mid" : "is-low");
  }

  function toastOnly(msg) {
    if (global.App && App.toast) App.toast(msg);
  }

  function copyText(text, okMsg) {
    if (global.ReportView && global.ReportView.copy) return global.ReportView.copy(text, okMsg);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        if (global.App && App.toast) App.toast(okMsg || "已复制");
      });
    }
    if (global.App && App.toast) App.toast("复制失败，请手动选中", "warn");
  }

  /* --------------------------- 已备答存档 --------------------------- */

  function loadDone() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (obj && obj.hash === hashOf && obj.map) doneMap = obj.map;
    } catch (err) { /* 忽略 */ }
  }

  function saveDone() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ hash: hashOf, map: doneMap }));
    } catch (err) { /* 忽略配额 */ }
  }

  /* --------------------------- 答案存档 --------------------------- */
  /* 用户自己写的答案。只做判定，不生成内容；换简历自动失效 */

  var ANS_STORE = "resume-opt.audit.answers.v1";
  var answersMap = {};

  function loadAnswers(hash) {
    answersMap = {};
    try {
      var raw = JSON.parse(localStorage.getItem(ANS_STORE) || "{}");
      if (raw && raw.hash === hash && raw.map) answersMap = raw.map;
    } catch (err) { /* 忽略损坏 */ }
  }

  function saveAnswers(hash) {
    try {
      localStorage.setItem(ANS_STORE, JSON.stringify({ hash: hash, map: answersMap }));
    } catch (err) { /* 忽略配额 */ }
  }

  /* 调用引擎判一句：只判缺口，不产出事实 */
  function checkAnsFor(a, ans) {
    var row = (cur.rows || []).filter(function (x) { return x.lineNo === a.lineNo; })[0];
    return global.AuditEngine.checkAnswer({
      answer: ans,
      kind: a.kind,
      rowText: row ? row.text : (a.excerpt || ""),
      arch: (cur.meta && cur.meta.familyArch) || "通用"
    });
  }

  /* ------------------------------ 职能族 / JD / 清单 ------------------------------ */

  function renderFam(r) {
    var m = r.meta || {};
    if (!m.familyArch || m.familyArch === "通用") {
      el.fam.hidden = true;
      return;
    }
    el.fam.hidden = false;
    el.fam.innerHTML = "<b>" + esc(m.family) + " · " + esc(m.familyArch) + "型</b>" +
      " 这一类看的是：" + esc(m.familyLook) +
      "；盘子口径写 " + esc(m.familyScale) + "。" +
      (m.familyGate ? '<i class="audit-fam-gate">硬门槛：' + esc(m.familyGate) + "</i>" : "");
  }

  function renderJd(r) {
    var jd = r.jdMap;
    if (!jd || !jd.total) {
      el.jdCard.hidden = true;
      return;
    }
    el.jdCard.hidden = false;
    el.jdCount.textContent = jd.total + " 个岗位词";

    function group(title, list, cls, note) {
      if (!list.length) {
        return '<section class="ajd-group"><h4 class="' + cls + '">' + title + " · 0</h4>" +
          '<p class="ajd-empty">' + note + "</p></section>";
      }
      return '<section class="ajd-group"><h4 class="' + cls + '">' + title + " · " + list.length + "</h4>" +
        '<ul class="ajd-list">' + list.slice(0, 14).map(function (x) {
          return "<li>" + esc(x.word) +
            (x.lines && x.lines.length ? '<span class="ajd-lines">第 ' + x.lines.join("/") + " 行</span>" : "") +
            (x.via ? '<span class="ajd-via">同义：' + esc(x.via) + "</span>" : "") +
            "</li>";
        }).join("") + "</ul></section>";
    }

    el.jdBody.innerHTML =
      group("正文有人接", jd.strong, "is-good", "一个都没接上") +
      group("只在技能区躺着", jd.skillOnly, "is-mid", "没有这种情况") +
      group("全文没提", jd.absent, "is-bad", "JD 的词都找到了落点");
  }

  /* ------------------------------ 今日清单 ------------------------------ */

  var TODO_STORE = "resume-opt.audit.todo.v1";
  var todoMap = {};

  function loadTodo(hash) {
    todoMap = {};
    try {
      var raw = JSON.parse(localStorage.getItem(TODO_STORE) || "{}");
      if (raw && raw.hash === hash && raw.map) todoMap = raw.map;
    } catch (err) { /* 忽略损坏 */ }
  }

  function saveTodo() {
    try {
      localStorage.setItem(TODO_STORE, JSON.stringify({ hash: hashOf, map: todoMap }));
    } catch (err) { /* 忽略配额 */ }
  }

  function renderTodo(r) {
    var list = r.checklist || [];
    if (!list.length) {
      el.todoCard.hidden = true;
      return;
    }
    el.todoCard.hidden = false;
    var done = list.filter(function (c) { return todoMap[c.id]; }).length;
    el.todoCount.textContent = done + " / " + list.length + " 已完成";
    el.todoBar.style.width = (list.length ? Math.round(done / list.length * 100) : 0) + "%";

    el.todoList.innerHTML = list.map(function (c) {
      var on = !!todoMap[c.id];
      return '<li class="atodo' + (on ? " is-done" : "") + '">' +
        '<label class="atodo-label">' +
          '<input type="checkbox" data-todo="' + esc(c.id) + '"' + (on ? " checked" : "") + ">" +
          "<span>" + esc(c.text) + (c.lineNo ? '<i class="atodo-line">第 ' + c.lineNo + " 行</i>" : "") + "</span>" +
        "</label>" +
        (c.detail ? '<p class="atodo-detail">' + esc(c.detail) + "</p>" : "") +
        "</li>";
    }).join("");
  }
  /* 只存指纹不存全文：总分、七维、追问键、文本 hash。
     用户改完再点「重新深审」，就能看到这一趟到底动了什么。 */

  /* --------------------------- 改前改后 --------------------------- */
  var HIST = "resume-opt.audit.history.v1";
  var curText = "";

  function snapOf(r, text) {
    var dims = {};
    r.dims.forEach(function (d) { dims[d.key] = d.score; });
    return {
      at: new Date().toISOString(),
      hash: hashText(text),
      overall: r.overall,
      level: r.level,
      chars: r.meta.chars,
      dims: dims,
      asks: r.asks.map(askKey)
    };
  }

  function loadHist() {
    try {
      var raw = JSON.parse(localStorage.getItem(HIST) || "{}");
      return Array.isArray(raw.list) ? raw.list : [];
    } catch (err) { return []; }
  }

  function saveHist(list) {
    try {
      localStorage.setItem(HIST, JSON.stringify({ list: list.slice(-6) }));
    } catch (err) { /* 忽略配额 */ }
  }

  function hhmm(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "上次";
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function signed(n) { return (n > 0 ? "+" : "") + n; }

  function renderDiff(r, text) {
    var list = loadHist();
    var prev = null, i;
    for (i = list.length - 1; i >= 0; i--) {
      if (list[i].hash !== hashOf) { prev = list[i]; break; }
    }

    var cur = snapOf(r, text);
    var exists = list.some(function (s) { return s.hash === cur.hash && s.overall === cur.overall; });
    if (!exists) {
      list.push(cur);
      saveHist(list);
    }

    if (!prev) {
      el.diff.hidden = true;
      return;
    }

    var dScore = cur.overall - prev.overall;
    var fixed = prev.asks.filter(function (k) { return cur.asks.indexOf(k) === -1; }).length;
    var added = cur.asks.filter(function (k) { return prev.asks.indexOf(k) === -1; }).length;
    var keys = Object.keys(cur.dims);
    var mover = keys.map(function (k) {
      return { k: k, d: cur.dims[k] - (prev.dims[k] || 0), was: prev.dims[k], now: cur.dims[k] };
    }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); })[0];

    var nameOf = {};
    r.dims.forEach(function (d) { nameOf[d.key] = d.name; });

    var bits = [];
    bits.push("较上次（" + hhmm(prev.at) + "）：总分 " + prev.overall + " → " + cur.overall +
      "（" + signed(dScore) + "）");
    bits.push("追问 " + prev.asks.length + " → " + cur.asks.length +
      "（消掉 " + fixed + " / 新增 " + added + "）");
    if (mover && mover.d !== 0) {
      bits.push((nameOf[mover.k] || mover.k) + " " + mover.was + " → " + mover.now + "（" + signed(mover.d) + "）");
    }

    el.diff.hidden = false;
    el.diff.className = "audit-diff" + (dScore > 0 ? " is-up" : (dScore < 0 ? " is-down" : ""));
    el.diff.textContent = bits.join(" · ");
  }

  /* ------------------------------ 先动这三条 ------------------------------ */

  function renderTop(r) {
    var list = (r.topActions || []).slice();
    if (!list.length) {
      el.topCard.hidden = true;
      return;
    }
    el.topCard.hidden = false;
    el.topCount.textContent = list.length + " 处";
    el.topList.innerHTML = list.map(function (a) {
      return '<li class="atop">' +
        '<div class="atop-head">' +
          '<span class="atop-rank">' + a.rank + "</span>" +
          "<b>" + esc(a.title) + "</b>" +
          '<span class="atop-gain">' + esc(a.impactText) + "</span>" +
        "</div>" +
        (a.excerpt ? '<p class="atop-src">' + (a.lineNo ? "第 " + a.lineNo + " 行 · " : "整份 · ") + esc(a.excerpt) + "</p>" : "") +
        '<p class="atop-why">' + esc(a.why) + "</p>" +
        '<p class="atop-do"><b>怎么做</b>' + esc(a.doThis) + "</p>" +
        (a.lineNo
          ? '<button class="btn btn--ghost btn--sm" type="button" data-jump="' + (a.lineNo - 1) + '">跳到这一行</button>'
          : "") +
        "</li>";
    }).join("");
  }

  /* ------------------------------ 七项体检 ------------------------------ */

  function renderSummary(r) {
    el.score.textContent = r.overall;
    el.level.textContent = r.level + " 档";
    el.level.className = "audit-level is-" + String(r.level).toLowerCase();
    el.advice.textContent = r.headline;

    if (r.capped) {
      el.cap.hidden = false;
      el.cap.textContent = "原始分 " + r.rawOverall + "，因「" + r.capReason + "」压到 " + r.cap + " —— 有硬伤时维度相加是假分。";
    } else {
      el.cap.hidden = true;
    }

    var meta = r.meta;
    var tags = [
      meta.kind ? '<span class="audit-tag">' + esc(meta.kind) + "</span>" : "",
      meta.family ? '<span class="audit-tag">' + esc(meta.family) + "</span>" : "",
      '<span class="audit-tag">' + meta.rows + " 行 / " + meta.chars + " 字</span>"
    ];
    if (meta.hasJD) {
      tags.push('<span class="audit-tag audit-tag--jd">JD 覆盖 ' + meta.coverage + "% · " + esc(meta.verdict) + "</span>");
    } else {
      tags.push('<span class="audit-tag audit-tag--dim">未填 JD</span>');
    }
    el.tags.innerHTML = tags.filter(Boolean).join("");

    el.dims.innerHTML = r.dims.map(function (d) {
      var tone = d.score >= 80 ? "good" : (d.score >= 55 ? "mid" : "bad");
      return '' +
        '<div class="audit-dim" data-dim="' + d.key + '">' +
          '<div class="audit-dim-head">' +
            '<span class="audit-dim-name">' + esc(d.name) + "</span>" +
            '<span class="audit-dim-score is-' + tone + '">' + d.score + "</span>" +
          "</div>" +
          '<div class="audit-dim-bar"><span class="is-' + tone + '" style="width:' + d.score + '%"></span></div>' +
          '<p class="audit-dim-note">' + esc(d.note) + "</p>" +
        "</div>";
    }).join("");

    el.counts.innerHTML = '' +
      stat("会被追问", r.counts.asks, "其中必答 " + r.counts.highAsks) +
      stat("该删", r.counts.cuts, "废话 / 隐私 / 重复") +
      stat("该补", r.counts.adds, "要素与板块缺口") +
      stat("逻辑", r.counts.logic, "时间线与结构") +
      stat("语言命中", r.counts.toneHits, "行话 / AI 句式");
  }

  function stat(k, v, note) {
    return '<div class="audit-stat"><strong>' + v + "</strong><span>" + k + "</span>" +
      (note ? '<i>' + esc(note) + "</i>" : "") + "</div>";
  }

  /* ------------------------------ 逐行 ------------------------------ */

  function rowFlags(x) {
    var out = [];
    var high = x.ask.filter(function (a) { return a.risk >= 3; }).length;
    if (high) out.push('<span class="aflag aflag--ask">追问 ×' + high + "</span>");
    if (x.kind === "bullet" && (x.detail.verdict === "太薄" || x.detail.verdict === "太空")) {
      out.push('<span class="aflag aflag--thin">' + x.detail.verdict + "</span>");
    }
    if (x.truth.risks.length) out.push('<span class="aflag aflag--truth">真实 ×' + x.truth.risks.length + "</span>");
    if (x.cut.length) out.push('<span class="aflag aflag--cut">删 ' + x.cut.length + "</span>");
    if (x.add.length) out.push('<span class="aflag aflag--add">补 ' + x.add.length + "</span>");
    if (x.tone.hits.length) out.push('<span class="aflag aflag--tone">AI 味 ×' + x.tone.n + "</span>");
    if (x.logic.length) out.push('<span class="aflag aflag--logic">逻辑 ' + x.logic.length + "</span>");
    return out.join("");
  }

  function blockAsk(x) {
    if (!x.ask.length) return "";
    return '' +
      '<section class="ablock ablock--ask">' +
        '<h4>① 会被这么问</h4>' +
        '<ul class="aask-list">' +
        x.ask.map(function (a) {
          return '<li>' +
            '<span class="aask-risk ' + riskClass(a.risk) + '">' + a.kind + " · " + riskLabel(a.risk) + "</span>" +
            '<p class="aask-q">' + esc(a.question) + "</p>" +
            '<p class="aask-sk"><b>答法</b>' + esc(a.skeleton) + "</p>" +
          "</li>";
        }).join("") +
        "</ul>" +
      "</section>";
  }

  function blockDetail(x) {
    var d = x.detail;
    if (x.kind !== "bullet") {
      return '<section class="ablock"><h4>② 够不够细</h4><p class="ablock-note">' + esc(d.note || "这类行不评五要素。") + "</p></section>";
    }
    var parts = ["对象", "动作", "方法", "规模", "结果"].map(function (k) {
      var on = d.got[k];
      return '<span class="aelem ' + (on ? "is-on" : "is-off") + '">' + (on ? "✓ " : "✗ ") + k + "</span>";
    }).join("");
    return '' +
      '<section class="ablock">' +
        '<h4>② 够不够细 <span class="ablock-badge is-' + (d.score >= 80 ? "good" : (d.score >= 50 ? "mid" : "bad")) + '">' +
          esc(d.verdict) + " · " + d.score + "</span></h4>" +
        '<div class="aelems">' + parts + "</div>" +
        '<p class="ablock-note">' + esc(d.note || "") + "</p>" +
        (d.missing.length ? '<p class="ablock-miss">缺：' + esc(d.missing.join("、")) + "</p>" : "") +
        patternHtml(x) +
      "</section>";
  }

  /* 可填句式：能照着填的那一句。括号里全是用户没写的信息，引擎不替他填 */
  function patternHtml(x) {
    var p = x.pattern;
    if (!p) return "";
    return '' +
      '<div class="apat">' +
        '<p class="apat-label">照这个结构填</p>' +
        '<p class="apat-sentence" data-pat="' + x.line + '">' + esc(p.sentence) + "</p>" +
        '<ul class="apat-slots">' +
        p.parts.map(function (s) {
          return '<li class="' + (s.filled ? "is-filled" : "is-hole") + '">' +
            "<b>" + esc(s.key) + "</b>" +
            (s.filled ? "原文已有" : esc(s.hint || "要靠你补")) +
            "</li>";
        }).join("") +
        "</ul>" +
        (p.verbFix ? '<p class="apat-verb">动词：' + esc(p.verbFix) + "</p>" : "") +
        '<p class="apat-note">' + esc(p.note) + "</p>" +
        '<button class="btn btn--ghost btn--sm" type="button" data-copy-pat="' + x.line + '">复制这句句式</button>' +
      "</div>";
  }

  function blockTruth(x) {
    if (!x.truth.risks.length) {
      return '<section class="ablock"><h4>③ 真不真实</h4><p class="ablock-note is-ok">没有发现口径或极端表述风险。</p></section>';
    }
    return '' +
      '<section class="ablock">' +
        '<h4>③ 真不真实 <span class="ablock-badge is-' + (x.truth.level === "high" ? "bad" : "mid") + '">' +
          (x.truth.level === "high" ? "会被拆穿" : "要补口径") + "</span></h4>" +
        '<ul class="arisk-list">' +
        x.truth.risks.map(function (t) {
          return "<li><b>" + esc(t.name) + "</b>" + esc(t.why) +
            '<p class="arisk-fix">改法：' + esc(t.fix) + "</p></li>";
        }).join("") +
        "</ul>" +
      "</section>";
  }

  function blockAdd(x) {
    if (!x.add.length) return "";
    return '' +
      '<section class="ablock">' +
        "<h4>④ 该补什么</h4>" +
        '<ul class="aadd-list">' +
        x.add.map(function (a) {
          return "<li><b>" + esc(a.what) + "</b>" + esc(a.why) +
            '<p class="aadd-ex">' + esc(a.example) + "</p></li>";
        }).join("") +
        "</ul>" +
      "</section>";
  }

  function blockCut(x) {
    if (!x.cut.length) return "";
    return '' +
      '<section class="ablock">' +
        "<h4>⑤ 该删什么</h4>" +
        '<ul class="acut-list">' +
        x.cut.map(function (c) {
          return "<li><b>" + esc(c.what) + "</b>" + esc(c.why) +
            '<p class="acut-fix">怎么处理：' + esc(c.fix) + "</p></li>";
        }).join("") +
        "</ul>" +
      "</section>";
  }

  function blockTone(x) {
    if (!x.tone.hits.length) {
      return '<section class="ablock"><h4>⑥ 语言与 AI 味</h4><p class="ablock-note is-ok">这一行读起来是人写的。</p></section>';
    }
    return '' +
      '<section class="ablock ablock--tone">' +
        "<h4>⑥ 语言与 AI 味 <span class=\"ablock-badge is-" + (x.tone.score >= 70 ? "mid" : "bad") + "\">AI 味 " + (100 - x.tone.score) + "</span></h4>" +
        '<ul class="atone-list">' +
        x.tone.hits.map(function (h) {
          return '<li><span class="atone-word">' + esc(h.word) + "</span>" +
            '<span class="atone-group">' + esc(h.groupName) + "</span>" +
            '<p class="atone-fix">' + esc(h.fix) + "</p></li>";
        }).join("") +
        "</ul>" +
        (x.strip && x.strip !== x.text
          ? '<p class="atone-strip"><b>删词后近似</b>' + esc(x.strip) + "</p>" : "") +
      "</section>";
  }

  function blockLogic(x) {
    if (!x.logic.length) return "";
    return '' +
      '<section class="ablock">' +
        "<h4>⑦ 逻辑</h4>" +
        '<ul class="alogic-list">' +
        x.logic.map(function (l) {
          return "<li><b>" + esc(l.title) + "</b>" + esc(l.why) +
            '<p class="alogic-fix">怎么改：' + esc(l.fix) + "</p></li>";
        }).join("") +
        "</ul>" +
      "</section>";
  }

  function rowHtml(x) {
    var open = !!openSet[x.line];
    return '' +
      '<article class="arow' + (open ? " is-open" : "") + '" data-line="' + x.line + '">' +
        '<header class="arow-head" role="button" tabindex="0" aria-expanded="' + (open ? "true" : "false") + '">' +
          '<span class="arow-no">第 ' + x.lineNo + " 行</span>" +
          '<span class="arow-sec">' + esc(x.section) + "</span>" +
          '<span class="arow-text">' + esc(x.text) + "</span>" +
          (x.jd && x.jd.length
            ? '<span class="arow-jd" title="对上的 JD 词">' + x.jd.slice(0, 3).map(function (w) {
              return '<i>' + esc(w) + "</i>";
            }).join("") + "</span>"
            : "") +
          '<span class="arow-flags">' + rowFlags(x) + "</span>" +
          '<span class="arow-caret" aria-hidden="true">▾</span>' +
        "</header>" +
        '<div class="arow-body"' + (open ? "" : " hidden") + ">" +
          '<div class="arow-grid">' +
            blockAsk(x) + blockDetail(x) + blockTruth(x) +
            blockAdd(x) + blockCut(x) + blockTone(x) + blockLogic(x) +
          "</div>" +
          '<div class="arow-foot">' +
            '<button class="btn btn--ghost btn--sm" type="button" data-copy-row="' + x.line + '">复制这一行的处理要点</button>' +
            '<span class="arow-foot-note">只重排事实，不替你编事实 —— 括号里的示例都要换成你真做过的。</span>' +
          "</div>" +
        "</div>" +
      "</article>";
  }

  function renderRows(r) {
    var f = currentFilter();
    var rows = r.rows.filter(function (x) { return f.test(x); });
    el.rowsEmpty.hidden = rows.length > 0;
    if (!rows.length) {
      el.rows.innerHTML = "";
      el.rowsEmpty.textContent = "这个筛选下没有内容 —— 说明这一项你没踩坑，换一个筛选看。";
      return;
    }
    el.rows.innerHTML = rows.map(rowHtml).join("");
  }

  function currentFilter() {
    for (var i = 0; i < FILTERS.length; i++) {
      if (FILTERS[i].key === filter) return FILTERS[i];
    }
    return FILTERS[0];
  }

  function renderFilter() {
    el.filters.innerHTML = FILTERS.map(function (f) {
      var n = cur ? cur.rows.filter(function (x) { return f.test(x); }).length : 0;
      return '<button class="afilter' + (f.key === filter ? " is-active" : "") + '" type="button" data-filter="' + f.key + '">' +
        esc(f.label) + '<i>' + n + "</i></button>";
    }).join("");
  }

  /* 从「先动这三条」跳到对应行：被筛选挡住时先回到全部 */
  function jumpToLine(line) {
    var sel = '.arow[data-line="' + line + '"]';
    var card = el.rows.querySelector(sel);
    if (!card) {
      filter = "all";
      renderFilter();
      renderRows(cur);
      card = el.rows.querySelector(sel);
    }
    if (!card) return;
    card.classList.add("is-open");
    var body = card.querySelector(".arow-body");
    if (body) body.hidden = false;
    var head = card.querySelector(".arow-head");
    if (head) head.setAttribute("aria-expanded", "true");
    openSet[line] = 1;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("is-flash");
    setTimeout(function () { card.classList.remove("is-flash"); }, 1400);
  }

  /* ------------------------------ 追问总表 ------------------------------ */

  function renderAsks(r) {
    var list = r.asks;
    var done = list.filter(function (a) { return doneMap[askKey(a)]; }).length;
    el.askCount.textContent = done + " / " + list.length + " 已备答";
    var pct = list.length ? Math.round(done / list.length * 100) : 0;
    el.askBar.style.width = pct + "%";

    if (!list.length) {
      el.askList.innerHTML = '<li class="empty-text">没有生成追问点。</li>';
      return;
    }
    el.askList.innerHTML = list.map(function (a) {
      var k = askKey(a);
      var isDone = !!doneMap[k];
      var ans = answersMap[k] || "";
      var chk = ans ? checkAnsFor(a, ans) : null;
      return '' +
        '<li class="aask' + (isDone ? " is-done" : "") + '" data-ask="' + esc(k) + '">' +
          '<div class="aask-head">' +
            '<span class="aask-risk ' + riskClass(a.risk) + '">' + esc(a.kind) + " · " + riskLabel(a.risk) + "</span>" +
            '<span class="aask-line">第 ' + a.lineNo + " 行</span>" +
            (chk ? '<span class="aask-grade ' + gradeClass(chk.score) + '">' + chk.score + " 分 · " + esc(chk.verdict) + "</span>" : "") +
            '<button class="aask-done" type="button" data-done="' + esc(k) + '">' + (isDone ? "已备答 ✓" : "标记已备答") + "</button>" +
          "</div>" +
          '<p class="aask-q">' + esc(a.question) + "</p>" +
          '<p class="aask-src">原文：' + esc(a.excerpt) + "</p>" +
          '<p class="aask-sk"><b>答法骨架</b>' + esc(a.skeleton) + "</p>" +
          '<div class="aans">' +
            '<textarea class="aans-input" rows="2" data-ans="' + esc(k) + '" ' +
              'placeholder="用你自己的话说一遍（真事，别估）">' + esc(ans) + "</textarea>" +
            '<div class="aans-bar">' +
              '<button class="btn btn--ghost btn--sm" type="button" data-check="' + esc(k) + '">判一下</button>' +
              '<span class="aans-hint">只判还缺什么，不替你写答案</span>' +
            "</div>" +
            answerHtml(a, ans, chk) +
          "</div>" +
        "</li>";
    }).join("");
  }

  function answerHtml(a, ans, chk) {
    if (!chk) return "";
    var flags = (chk.flags || []).map(function (f) {
      return '<li class="aans-flag is-' + f.kind + '">' +
        (f.word ? "「" + esc(f.word) + "」：" : "") + esc(f.why) + "</li>";
    }).join("");
    var miss = (chk.missing || []).map(function (m) {
      return '<li class="aans-miss"><b>' + esc(m.key) + "</b>" + esc(m.why) +
        (m.ask ? '<i>追问：' + esc(m.ask) + "</i>" : "") + "</li>";
    }).join("");
    return '<div class="aans-out">' +
      '<p class="aans-note">' + esc(chk.note) + "</p>" +
      (miss ? '<ul class="aans-list">' + miss + "</ul>" : "") +
      (flags ? '<ul class="aans-list">' + flags + "</ul>" : "") +
      (chk.assembled && chk.score >= 55
        ? '<p class="aans-assembled"><b>这么写（只用你给的字）</b>' + esc(chk.assembled) + "</p>"
        : "") +
      "</div>";
  }

  function gradeClass(sc) { return sc >= 80 ? "is-good" : (sc >= 55 ? "is-mid" : "is-bad"); }

  /* ------------------------------ 两侧清单 ------------------------------ */

  function renderTone(r) {
    var bag = {};
    r.rows.forEach(function (x) {
      x.tone.hits.forEach(function (h) {
        var key = h.word;
        if (!bag[key]) bag[key] = { word: key, group: h.groupName, fix: h.fix, n: 0 };
        bag[key].n++;
      });
    });
    (r.toneDoc.hits || []).forEach(function (h) {
      if (!bag[h.word]) bag[h.word] = { word: h.word, group: h.groupName, fix: h.fix, n: 0 };
      bag[h.word].n += 2;
    });
    var list = Object.keys(bag).map(function (k) { return bag[k]; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, 14);

    el.toneCount.textContent = list.length ? "命中 " + r.counts.toneHits + " 处" : "干净";
    if (!list.length) {
      el.toneList.innerHTML = '<p class="empty-text">没有命中行话、软素质声明和 AI 句式。</p>';
      return;
    }
    el.toneList.innerHTML =
      '<div class="atone-chips">' + list.map(function (b) {
        return '<span class="atone-chip" title="' + esc(b.fix) + '">' + esc(b.word) +
          "<i>" + b.n + "</i></span>";
      }).join("") + "</div>" +
      '<ul class="atone-fixes">' + list.slice(0, 6).map(function (b) {
        return '<li><b>' + esc(b.word) + "</b>（" + esc(b.group) + "）" + esc(b.fix) + "</li>";
      }).join("") + "</ul>";
  }

  function renderCuts(r) {
    var docCuts = r.cuts.filter(function (c) { return !c.lineNo; });
    var rowCuts = r.cuts.filter(function (c) { return c.lineNo; });
    el.cutCount.textContent = r.cuts.length + " 处";
    if (!r.cuts.length) {
      el.cutList.innerHTML = '<p class="empty-text">没有明显该删的内容。</p>';
      return;
    }
    function item(c) {
      return '<li><div class="alist-head"><b>' + esc(c.what) + "</b>" +
        (c.lineNo ? '<span class="alist-line">第 ' + c.lineNo + " 行</span>" : '<span class="alist-line">全文</span>') +
        "</div>" +
        "<p>" + esc(c.why) + "</p>" +
        '<p class="alist-fix">怎么处理：' + esc(c.fix) + "</p></li>";
    }
    el.cutList.innerHTML = '<ul class="alist">' +
      docCuts.concat(rowCuts).slice(0, 20).map(item).join("") + "</ul>";
  }

  function renderAdds(r) {
    el.addCount.textContent = (r.addsDoc.length + r.adds.length) + " 处";
    var html = "";
    if (r.addsDoc.length) {
      html += '<div class="asub-title">板块与要素缺口</div><ul class="alist">' +
        r.addsDoc.map(function (a) {
          return "<li><div class=\"alist-head\"><b>" + esc(a.what) + "</b><span class=\"alist-line\">全局</span></div>" +
            "<p>" + esc(a.why) + "</p>" +
            '<p class="alist-fix">怎么写：' + esc(a.example) + "</p></li>";
        }).join("") + "</ul>";
    }
    if (r.adds.length) {
      html += '<div class="asub-title">逐条该补的要素</div><ul class="alist">' +
        r.adds.slice(0, 16).map(function (a) {
          return "<li><div class=\"alist-head\"><b>" + esc(a.what) + "</b>" +
            '<span class="alist-line">第 ' + a.lineNo + " 行</span></div>" +
            "<p>" + esc(a.why) + "</p>" +
            '<p class="alist-fix">' + esc(a.example) + "</p></li>";
        }).join("") + "</ul>";
      if (r.adds.length > 16) {
        html += '<p class="card-note card-note--dim">还有 ' + (r.adds.length - 16) + " 条在逐行卡片里，筛选「该补」看全部。</p>";
      }
    }
    el.addList.innerHTML = html || '<p class="empty-text">该有的板块和要素都在。</p>';
  }

  function renderLogic(r) {
    el.logicCount.textContent = r.logic.length + " 处";
    if (!r.logic.length) {
      el.logicList.innerHTML = '<p class="empty-text">时间线、主题、技能与经历之间没有发现冲突。</p>';
      return;
    }
    var LV = { fatal: "硬冲突", important: "重要", minor: "次要" };
    el.logicList.innerHTML = '<ul class="alist">' + r.logic.map(function (l) {
      return '<li class="is-' + (l.level || "minor") + '">' +
        '<div class="alist-head"><span class="alogic-level">' + (LV[l.level] || "次要") + "</span>" +
        "<b>" + esc(l.title) + "</b>" +
        (l.lineNo ? '<span class="alist-line">第 ' + l.lineNo + " 行</span>" : "") +
        "</div>" +
        "<p>" + esc(l.why) + "</p>" +
        '<p class="alist-fix">怎么改：' + esc(l.fix) + "</p></li>";
    }).join("") + "</ul>";
  }

  function renderLadder(r) {
    el.ladder.innerHTML = r.ladder.map(function (x, i) {
      return '<div class="aladder-item"><span class="aladder-no">' + (i + 1) + "</span>" +
        '<div><b>' + esc(x.name) + "</b><p>" + esc(x.ex) + "</p></div></div>";
    }).join("");
  }

  /* ------------------------------ 复制 ------------------------------ */

  function rowCopyText(x) {
    var L = [];
    L.push("第 " + x.lineNo + " 行（" + x.section + "）：" + x.text);
    if (x.ask.length) {
      L.push("\n【会被这么问】");
      x.ask.forEach(function (a) { L.push("- [" + a.kind + "/" + riskLabel(a.risk) + "] " + a.question + "　答法：" + a.skeleton); });
    }
    if (x.kind === "bullet") {
      L.push("\n【详细度】" + x.detail.verdict + "（" + x.detail.score + "）" +
        (x.detail.missing.length ? " 缺：" + x.detail.missing.join("、") : ""));
    }
    if (x.truth.risks.length) {
      L.push("\n【真实性】");
      x.truth.risks.forEach(function (t) { L.push("- " + t.name + "：" + t.why + "　改法：" + t.fix); });
    }
    if (x.add.length) {
      L.push("\n【该补】");
      x.add.forEach(function (a) { L.push("- " + a.what + "：" + a.why + "　" + a.example); });
    }
    if (x.cut.length) {
      L.push("\n【该删】");
      x.cut.forEach(function (c) { L.push("- " + c.what + "：" + c.why + "　" + c.fix); });
    }
    if (x.tone.hits.length) {
      L.push("\n【语言】");
      x.tone.hits.forEach(function (h) { L.push("- " + h.word + "（" + h.groupName + "）" + h.fix); });
      if (x.strip) L.push("删词后近似：" + x.strip);
    }
    if (x.logic.length) {
      L.push("\n【逻辑】");
      x.logic.forEach(function (l) { L.push("- " + l.title + "：" + l.why + "　" + l.fix); });
    }
    return L.join("\n");
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function fileName() {
    var meta = (global.App && App.state && App.state.resumeMeta) || {};
    var base = meta.filename ? String(meta.filename).replace(/\.[^.]+$/, "") : "简历";
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return base + "-深审报告-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".md";
  }

  /* ------------------------------ 主渲染 ------------------------------ */

  function render(r) {
    if (!el.panel) return;
    cur = r;
    if (!r || !r.ok) {
      el.body.hidden = true;
      el.empty.hidden = false;
      el.emptyNote.textContent = (r && r.error) || "还没有载入简历。到「上传」页粘贴或拖入一份，这里会逐行过堂。";
      return;
    }
    el.empty.hidden = true;
    el.body.hidden = false;

    el.engineTag.textContent = "AuditEngine " + r.version + " · 离线规则层";
    renderTop(r);
    renderFam(r);
    renderSummary(r);
    renderFilter();
    renderRows(r);
    renderAsks(r);
    renderTone(r);
    renderCuts(r);
    renderAdds(r);
    renderLogic(r);
    renderLadder(r);
    renderJd(r);
    renderTodo(r);
    renderDiff(r, curText);
  }

  function recompute() {
    var text = (global.App && App.state.resumeText) || "";
    curText = text;
    hashOf = hashText(text);
    loadDone();
    loadAnswers(hashOf);
    loadTodo(hashOf);
    openSet = {};
    if (!text.trim()) {
      render({ ok: false, error: "还没有载入简历。到「上传」页粘贴或拖入一份，这里会逐行过堂。" });
      return;
    }
    if (!global.AuditEngine) {
      render({ ok: false, error: "深审引擎没加载起来（js/engine-audit.js）。检查脚本引用顺序。" });
      return;
    }
    var opts = {
      jd: (global.App && App.state.jdText) || "",
      industry: (global.App && App.industryLabel && App.industryLabel()) || "",
      jobTitle: global.Engine ? Engine.mapJobTitle(App.industryLabel()) : ""
    };
    var r;
    try {
      r = global.AuditEngine.audit(text, opts);
    } catch (err) {
      console.error(err);
      render({ ok: false, error: "深审引擎异常：" + (err && err.message ? err.message : err) });
      return;
    }
    if (r.ok) {
      /* 默认展开：被追问最狠的前两行，其余收起 —— 一次全展开等于没给结论 */
      var firstWithAsk = r.rows.filter(function (x) {
        return x.ask.some(function (a) { return a.risk >= 3; });
      }).slice(0, 2);
      firstWithAsk.forEach(function (x) { openSet[x.line] = 1; });
    }
    render(r);
  }

  /* ------------------------------ 交互 ------------------------------ */

  function bind() {
    if (!el.panel) return;

    el.filters.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-filter]");
      if (!btn) return;
      filter = btn.dataset.filter;
      renderFilter();
      renderRows(cur);
    });

    el.rows.addEventListener("click", function (e) {
      var copyPat = e.target.closest("[data-copy-pat]");
      if (copyPat) {
        var pl = Number(copyPat.dataset.copyPat);
        var prow = (cur.rows || []).filter(function (x) { return x.line === pl; })[0];
        if (prow && prow.pattern) {
          copyText("第 " + prow.lineNo + " 行照这个填：\n" + prow.pattern.sentence +
            (prow.pattern.verbFix ? "\n动词：" + prow.pattern.verbFix : ""), "句式已复制，括号换成你真有的");
        }
        return;
      }
      var copyBtn = e.target.closest("[data-copy-row]");
      if (copyBtn) {
        var line = Number(copyBtn.dataset.copyRow);
        var row = (cur.rows || []).filter(function (x) { return x.line === line; })[0];
        if (row) copyText(rowCopyText(row), "第 " + row.lineNo + " 行的处理要点已复制");
        return;
      }
      var head = e.target.closest(".arow-head");
      if (!head) return;
      var card = head.closest(".arow");
      var line2 = Number(card.dataset.line);
      var body = card.querySelector(".arow-body");
      var open = card.classList.toggle("is-open");
      body.hidden = !open;
      head.setAttribute("aria-expanded", open ? "true" : "false");
      openSet[line2] = open ? 1 : 0;
    });

    el.rows.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var head = e.target.closest(".arow-head");
      if (!head) return;
      e.preventDefault();
      head.click();
    });

    document.getElementById("auditExpandAll").addEventListener("click", function () {
      var all = el.rows.querySelectorAll(".arow");
      Array.prototype.forEach.call(all, function (card) {
        card.classList.add("is-open");
        card.querySelector(".arow-body").hidden = false;
        card.querySelector(".arow-head").setAttribute("aria-expanded", "true");
        openSet[Number(card.dataset.line)] = 1;
      });
    });

    document.getElementById("auditCollapseAll").addEventListener("click", function () {
      var all = el.rows.querySelectorAll(".arow");
      Array.prototype.forEach.call(all, function (card) {
        card.classList.remove("is-open");
        card.querySelector(".arow-body").hidden = true;
        card.querySelector(".arow-head").setAttribute("aria-expanded", "false");
        openSet[Number(card.dataset.line)] = 0;
      });
    });

    /* 答案边写边存：换页回来还在 */
    el.askList.addEventListener("input", function (e) {
      var box = e.target.closest("[data-ans]");
      if (!box) return;
      var k = box.dataset.ans;
      var v = box.value.trim();
      if (v) answersMap[k] = v; else delete answersMap[k];
      saveAnswers(hashOf);
    });

    el.todoList.addEventListener("change", function (e) {
      var box = e.target.closest("[data-todo]");
      if (!box) return;
      if (box.checked) todoMap[box.dataset.todo] = 1; else delete todoMap[box.dataset.todo];
      saveTodo();
      renderTodo(cur);
    });

    el.todoReset.addEventListener("click", function () {
      todoMap = {};
      saveTodo();
      renderTodo(cur);
    });

    el.printBtn.addEventListener("click", function () { global.print(); });

    el.topList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-jump]");
      if (!btn) return;
      jumpToLine(Number(btn.dataset.jump));
    });

    el.askList.addEventListener("click", function (e) {
      var chk = e.target.closest("[data-check]");
      if (chk) {
        var key = chk.dataset.check;
        var box = el.askList.querySelector('[data-ans="' + key.replace(/"/g, '\\"') + '"]');
        /* 重新查询节点：判完会重绘，旧引用已脱离文档 */
        var val = box ? box.value : "";
        if (!val.trim()) { toastOnly("先写一句你自己的答案，再判"); return; }
        answersMap[key] = val.trim();
        saveAnswers(hashOf);
        var found = (cur.asks || []).filter(function (a) { return askKey(a) === key; })[0];
        if (found) {
          var res = checkAnsFor(found, val.trim());
          if (res.score >= 80 && !doneMap[key]) {
            doneMap[key] = 1;
            saveDone();
            toastOnly("这句能答了，已自动标为备答");
          }
        }
        renderAsks(cur);
        return;
      }
      var btn = e.target.closest("[data-done]");
      if (!btn) return;
      var k = btn.dataset.done;
      if (doneMap[k]) delete doneMap[k];
      else doneMap[k] = 1;
      saveDone();
      renderAsks(cur);
    });

    el.btnRecompute.addEventListener("click", function () {
      recompute();
      if (global.App && App.toast) App.toast("已按当前简历与 JD 重新深审");
    });

    el.btnCopyAll.addEventListener("click", function () {
      if (!cur || !cur.ok) return;
      var L = [];
      cur.asks.forEach(function (a, i) {
        L.push((i + 1) + ". [" + a.kind + "/" + riskLabel(a.risk) + "] " + a.question + "\n   原文：" + a.excerpt + "\n   答法：" + a.skeleton);
      });
      copyText(L.join("\n\n"), "追问清单已复制（" + cur.asks.length + " 条）");
    });

    el.btnExport.addEventListener("click", function () {
      if (!cur || !cur.ok) return;
      download(fileName(), cur.markdown());
      if (global.App && App.toast) App.toast("深审报告已开始下载");
    });

    el.btnCopyMd.addEventListener("click", function () {
      if (!cur || !cur.ok) return;
      copyText(cur.markdown(), "深审报告全文已复制");
    });

    document.addEventListener("resume:change", function () {
      /* 上传页载入后不抢视角：只重算，不跳 Tab。留在深审页的人会立刻看到新结果 */
      recompute();
    });
    document.addEventListener("jd:change", recompute);
    document.addEventListener("industry:change", recompute);
  }

  function init() {
    el = {
      panel: document.getElementById("panel-audit"),
      body: document.getElementById("auditBody"),
      empty: document.getElementById("auditEmpty"),
      emptyNote: document.getElementById("auditEmptyNote"),
      engineTag: document.getElementById("auditEngineTag"),
      fam: document.getElementById("auditFam"),
      jdCard: document.getElementById("auditJdCard"),
      jdCount: document.getElementById("auditJdCount"),
      jdBody: document.getElementById("auditJdBody"),
      todoCard: document.getElementById("auditTodoCard"),
      todoCount: document.getElementById("auditTodoCount"),
      todoBar: document.getElementById("auditTodoBar"),
      todoList: document.getElementById("auditTodoList"),
      todoReset: document.getElementById("auditTodoReset"),
      printBtn: document.getElementById("auditPrint"),
      diff: document.getElementById("auditDiff"),
      topCard: document.getElementById("auditTopCard"),
      topCount: document.getElementById("auditTopCount"),
      topList: document.getElementById("auditTopList"),
      score: document.getElementById("auditScore"),
      level: document.getElementById("auditLevel"),
      advice: document.getElementById("auditAdvice"),
      cap: document.getElementById("auditCap"),
      tags: document.getElementById("auditTags"),
      dims: document.getElementById("auditDims"),
      counts: document.getElementById("auditCounts"),
      filters: document.getElementById("auditFilters"),
      rows: document.getElementById("auditRows"),
      rowsEmpty: document.getElementById("auditRowsEmpty"),
      askCount: document.getElementById("auditAskCount"),
      askBar: document.getElementById("auditAskBar"),
      askList: document.getElementById("auditAskList"),
      toneCount: document.getElementById("auditToneCount"),
      toneList: document.getElementById("auditToneList"),
      cutCount: document.getElementById("auditCutCount"),
      cutList: document.getElementById("auditCutList"),
      addCount: document.getElementById("auditAddCount"),
      addList: document.getElementById("auditAddList"),
      logicCount: document.getElementById("auditLogicCount"),
      logicList: document.getElementById("auditLogicList"),
      ladder: document.getElementById("auditLadder"),
      btnRecompute: document.getElementById("auditRecompute"),
      btnCopyAll: document.getElementById("auditCopyAsks"),
      btnExport: document.getElementById("auditExportMd"),
      btnCopyMd: document.getElementById("auditCopyMd")
    };
    if (!el.panel) return;
    bind();
    if (global.App && App.state.resumeText) recompute();
    else render({ ok: false, error: "还没有载入简历。到「上传」页粘贴或拖入一份，这里会逐行过堂。" });
  }

  global.AuditView = { init: init, render: render, recompute: recompute };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);