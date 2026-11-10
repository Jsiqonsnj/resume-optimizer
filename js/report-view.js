/* =========================================================
 * report-view.js — 审阅页：把引擎结论画成「问题」与「会被怎么问」
 * ---------------------------------------------------------
 * 页面分工（别再混）：
 *   审阅（本文件）= 总评 + 四层诊断 + 面试会怎么问 + 亮点
 *   优化（optimize.js）= 逐句改，我问你答
 *   规划（plan.js）= 按行业自动生成的拔高路线
 * 这里只做展示，不做任何判断 —— 判断全在引擎里。
 * ========================================================= */

(function (global) {
  "use strict";

  var el = {};
  var pro = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var LEVEL_CLASS = { "致命": "fatal", "重要": "major", "次要": "minor" };
  var KIND_CLASS = { "校招": "campus", "转行": "change", "管理": "manager" };

  /* ---------------- 总评 ---------------- */
  function renderSummary(p) {
    el.proScore.textContent = p.total;
    el.proAdvice.textContent = p.advice || "";

    if (p.capped) {
      el.proCapNote.hidden = false;
      el.proCapNote.textContent = "原始分 " + p.rawTotal + "，因 " + p.nFatal +
        " 处致命问题，得分上限压到 " + p.cap + " —— 有硬伤时维度相加是假分。";
    } else {
      el.proCapNote.hidden = true;
    }

    var tags = [
      '<span class="pro-tag pro-tag--' + (KIND_CLASS[p.kind] || "normal") + '">' + esc(p.kind) + "</span>",
      p.level ? '<span class="pro-tag pro-tag--level">' + esc(p.level) + " 档</span>" : "",
      '<span class="pro-tag">' + esc(p.industry) + "</span>",
      '<span class="pro-tag">' + esc(p.family) + "</span>"
    ];
    var prof = p.profile || {};
    if (prof.exp_months) {
      tags.push('<span class="pro-tag pro-tag--dim">约 ' + Math.floor(prof.exp_months / 12) +
        " 年 " + (prof.exp_months % 12) + " 个月 · " + prof.n_jobs + " 段经历</span>");
    }
    el.proTags.innerHTML = tags.filter(Boolean).join("");

    var flags = prof.flags || [];
    el.proFlags.innerHTML = flags.length
      ? flags.map(function (f) {
        return '<p class="pro-flag"><i></i>' + esc(f.note) + "</p>";
      }).join("")
      : '<p class="pro-flag pro-flag--none">画像上没有需要特别提醒的坑。</p>';

    el.proDims.innerHTML = (p.dimensions || []).map(function (d) {
      var pct = d.max ? Math.round(d.score / d.max * 100) : 0;
      var tone = pct >= 70 ? "good" : (pct >= 40 ? "mid" : "bad");
      return '' +
        '<div class="pro-dim">' +
          '<div class="pro-dim-head">' +
            '<span class="pro-dim-name">' + esc(d.name) + "</span>" +
            '<span class="pro-dim-score">' + d.score + "<i>/" + d.max + "</i></span>" +
          "</div>" +
          '<div class="pro-dim-bar"><span class="pro-dim-fill is-' + tone + '" style="width:' + pct + '%"></span></div>' +
          (d.issues && d.issues.length
            ? '<p class="pro-dim-note">' + esc(d.issues[0]) + "</p>" : "") +
        "</div>";
    }).join("");

    /* 五维雷达：纯 SVG 现算，不拉图床也不引图表库 */
    if (el.proRadar) {
      var svg = global.Radar ? global.Radar.svg(p.dimensions || []) : "";
      el.proRadar.innerHTML = svg;
      el.proRadar.hidden = !svg;
    }

    var jd = p.jd || {};
    if (jd.has_jd) {
      el.proJd.hidden = false;
      var cover = Math.round((jd.coverage || 0) * 100);
      var hard = (jd.hard || []).filter(function (h) { return h.ok !== true; });
      el.proJd.innerHTML = '' +
        '<div class="pro-jd-head">' +
          '<span class="pro-jd-verdict is-' + (jd.verdict === "该投" ? "ok" : (jd.verdict === "勉强" ? "mid" : "bad")) + '">' +
            esc(jd.verdict) + "</span>" +
          '<span class="pro-jd-cover">关键词覆盖 <strong>' + cover + "%</strong></span>" +
        "</div>" +
        '<p class="pro-jd-advice">' + esc(jd.advice) + "</p>" +
        (jd.missing && jd.missing.length
          ? '<p class="pro-jd-miss">缺：' + jd.missing.slice(0, 10).map(function (w) {
            return '<span class="kw">' + esc(w) + "</span>";
          }).join("") + "</p>" : "") +
        (hard.length
          ? '<ul class="pro-jd-hard">' + hard.map(function (h) {
            return '<li class="' + (h.ok === false ? "is-bad" : "is-warn") + '">' +
              (h.ok === false ? "✕ " : "? ") + esc(h.item) +
              (h.note ? "　" + esc(h.note) : "") + "</li>";
          }).join("") + "</ul>" : "");
    } else {
      el.proJd.hidden = true;
    }

    var ss = p.sixSecond || {};
    el.proSix.innerHTML = '' +
      '<div class="six-head">' +
        '<span class="six-badge ' + (ss.pass ? "is-pass" : "is-fail") + '">' +
          (ss.pass ? "6 秒测试：过" : "6 秒测试：不过") + "</span>" +
        '<span class="six-note">只看前 420 字，能不能抓到「做什么 + 最强一件事」</span>' +
      "</div>" +
      '<div class="six-rows">' +
        (ss.saw || []).map(function (s) {
          return '<span class="six-chip is-saw">✓ ' + esc(s) + "</span>";
        }).join("") +
        (ss.missing || []).map(function (s) {
          return '<span class="six-chip is-missing">✕ ' + esc(s) + "</span>";
        }).join("") +
      "</div>";
  }

  /* ---------------- 四层诊断 ---------------- */
  function renderLayers(p) {
    var layers = p.layers || {};
    var tops = p.tops || {};
    var order = ["内容无效", "读不下去", "对岗不投", "面试会挨打"];
    var total = 0;
    order.forEach(function (k) { total += (layers[k] || []).length; });
    el.layerCount.textContent = total ? total + " 条 / 4 层" : "无";

    el.layerList.innerHTML = order.map(function (name) {
      var top = tops[name];
      var all = layers[name] || [];
      if (!top) {
        return '' +
          '<div class="layer layer--clean">' +
            '<div class="layer-head"><span class="layer-name">' + esc(name) + "</span>" +
            '<span class="layer-level">没问题</span></div>' +
            '<p class="layer-title">这一层没抓到硬伤 —— 但这不代表它是加分项。</p>' +
          "</div>";
      }
      var rest = all.filter(function (f) { return f.title !== top.title; });
      return '' +
        '<div class="layer layer--' + (LEVEL_CLASS[top.level] || "minor") + '">' +
          '<div class="layer-head">' +
            '<span class="layer-name">' + esc(name) + "</span>" +
            '<span class="layer-level">' + esc(top.level) + "</span>" +
          "</div>" +
          '<p class="layer-title">' + esc(top.title) + "</p>" +
          (top.why ? '<p class="layer-why">' + esc(top.why) + "</p>" : "") +
          (top.fix ? '<p class="layer-fix"><b>怎么改</b>' + esc(top.fix) + "</p>" : "") +
          (top.evidence && top.evidence.length
            ? '<div class="layer-evidence">' + top.evidence.map(function (e) {
              return "<span>原文： " + esc(e) + "</span>";
            }).join("") + "</div>" : "") +
          (rest.length
            ? '<details class="layer-more"><summary>同层还有 ' + rest.length + " 条</summary>" +
              rest.map(function (f) {
                return '<div class="layer-sub layer-sub--' + (LEVEL_CLASS[f.level] || "minor") + '">' +
                  '<span class="layer-sub-level">' + esc(f.level) + "</span>" +
                  "<p>" + esc(f.title) + "</p>" +
                  (f.fix ? '<p class="layer-sub-fix">' + esc(f.fix) + "</p>" : "") +
                "</div>";
              }).join("") + "</details>"
            : "") +
        "</div>";
    }).join("");
  }

  /* ---------------- 亮点 ---------------- */
  function renderStrengths(p) {
    var list = p.strengths || [];
    el.strengthCount.textContent = list.length ? list.length + " 条" : "无";
    el.strengthList.innerHTML = list.length
      ? list.map(function (x) {
        return '<div class="strength">' +
          '<p class="strength-point">' + esc(x.point) + "</p>" +
          '<p class="strength-why">' + esc(x.why) + "</p>" +
          "</div>";
      }).join("")
      : '<p class="empty-text">暂无可指认的强项 —— 这本身就是结论：现在没有能被筛选到的证据。</p>';
  }

  /* ---------------- 面试会怎么问 ---------------- */
  function renderProbes(p) {
    var list = p.probes || [];
    el.probeCount.textContent = list.length ? list.length + " 问" : "无";
    var KIND = { "亮点": "strong", "疑点": "doubt", "稳定": "stable" };
    el.probeList.innerHTML = list.map(function (x, i) {
      return '' +
        '<div class="probe probe--' + (KIND[x.kind] || "stable") + '" data-probe="' + i + '">' +
          '<div class="probe-head">' +
            '<span class="probe-kind">' + esc(x.kind) + "</span>" +
            '<p class="probe-q">' + esc(x.question) + "</p>" +
            '<button class="probe-done" type="button" aria-label="标记已准备">已备答</button>' +
          "</div>" +
          '<p class="probe-answer">答法：' + esc(x.answer_skeleton) + "</p>" +
          (x.source ? '<p class="probe-source">对应：' + esc(x.source) + "</p>" : "") +
        "</div>";
    }).join("");
  }

  /* ---------------- 交互 ---------------- */
  function bind() {
    el.probeList.addEventListener("click", function (e) {
      var btn = e.target.closest(".probe-done");
      if (!btn) return;
      var box = btn.closest(".probe");
      var on = box.classList.toggle("is-done");
      btn.textContent = on ? "已备答 ✓" : "已备答";
    });
  }

  /* ---------------- 对外 ---------------- */
  function render(professional) {
    if (!el.proWrap) return;

    var has = !!professional;
    el.proWrap.hidden = !has;
    if (el.proHead) el.proHead.hidden = !has;
    if (el.optWrap) el.optWrap.hidden = !has;
    if (el.planWrap) el.planWrap.hidden = !has;

    if (!has) {
      pro = null;
      if (global.OptimizeView) global.OptimizeView.render(null);
      if (global.PlanView) global.PlanView.render(null);
      return;
    }

    pro = professional;
    el.proEngineTag.textContent = "resume_engine " + (professional.version || "2.0") +
      " · " + (professional.kind || "") + "/" + (professional.family || "");

    renderSummary(professional);
    renderLayers(professional);
    renderStrengths(professional);
    renderProbes(professional);

    // 另外两页：各自渲染自己的部分（这里只负责通知）
    if (global.OptimizeView) global.OptimizeView.render(professional);
    if (global.PlanView) global.PlanView.render(professional);
  }

  function init() {
    el = {
      proHead: document.getElementById("proHead"),
      proWrap: document.getElementById("proWrap"),
      optWrap: document.getElementById("optWrap"),
      planWrap: document.getElementById("planWrap"),
      proEngineTag: document.getElementById("proEngineTag"),
      proScore: document.getElementById("proScore"),
      proAdvice: document.getElementById("proAdvice"),
      proCapNote: document.getElementById("proCapNote"),
      proTags: document.getElementById("proTags"),
      proFlags: document.getElementById("proFlags"),
      proRadar: document.getElementById("proRadar"),
      proDims: document.getElementById("proDims"),
      proJd: document.getElementById("proJd"),
      proSix: document.getElementById("proSix"),
      layerCount: document.getElementById("layerCount"),
      layerList: document.getElementById("layerList"),
      strengthCount: document.getElementById("strengthCount"),
      strengthList: document.getElementById("strengthList"),
      probeCount: document.getElementById("probeCount"),
      probeList: document.getElementById("probeList")
    };
    if (!el.proWrap) return;
    bind();
  }

  global.ReportView = { init: init, render: render };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);