/* =========================================================
 * plan.js — 规划页：简历一进来就自动生成「往哪补、补什么、多久」
 * ---------------------------------------------------------
 * 输入：引擎的 professional（行业 / 职能族 / 职级 / JD 缺口 / 诊断 / 追问）
 * 输出：定位 → 缺口 → 三档拔高建议 → 一周能做的 → 3/6/12 月阶梯 → 面试卖点
 * 用户不用点任何按钮，进页面就是已算好的结果（数据来自 plan-data.js + 引擎词表）。
 * ========================================================= */

(function (global) {
  "use strict";

  var el = {};
  var pro = null;
  var built = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function toast(msg, kind) {
    if (global.App && App.toast) App.toast(msg, kind);
  }

  function copy(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg || "已复制"); })
        .catch(function () { fallback(text, msg); });
      return;
    }
    fallback(text, msg);
  }

  function fallback(text, msg) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(msg || "已复制");
    } catch (e) {
      toast("复制失败，请手动选中", "warn");
    }
  }

  /* ---------------- 计算（纯函数，便于离线测试） ---------------- */

  function keywordFixFor(word, table) {
    if (!word) return "";
    if (table[word]) return table[word];
    var keys = Object.keys(table);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.length >= 2 && (word.indexOf(k) !== -1 || k.indexOf(word) !== -1)) return table[k];
    }
    return "";
  }

  function build(professional, resumeText) {
    var PD = global.PLAN_DATA || { evidence: {}, certs: {}, keywordFix: {}, ladder: [] };
    var D = global.RLData || {};
    var p = professional || {};
    var family = p.family || "通用";
    var industry = p.industry || "通用";
    var kb = (D.kb || {})[industry] || (D.kb || {})["通用"] || { keywords: [], tips: [], screen: [], pitfalls: [] };

    var evidences = PD.evidence[family] || PD.evidence["通用"] || [];
    var certs = PD.certs[industry] || PD.certs["通用"] || [];

    /* 缺口：JD 缺失词优先，其次行业特征词没在正文出现 */
    var raw = String(resumeText || "");
    var jdMissing = (p.jd && p.jd.has_jd && p.jd.missing) ? p.jd.missing.slice() : [];
    var kwMissing = (kb.keywords || []).filter(function (k) {
      return raw.indexOf(k) === -1 && jdMissing.indexOf(k) === -1;
    });
    var gaps = jdMissing.concat(kwMissing).slice(0, 8);

    /* 每个缺口配一个一周内能做的动作 */
    var quickFix = gaps.map(function (w) {
      return { word: w, how: keywordFixFor(w, PD.keywordFix) || ("把「" + w + "」相关的一次真实经历补成一行：做了什么 + 结果数") };
    });

    /* 致命诊断（每层最狠那一条） */
    var tops = p.tops || {};
    var fatal = Object.keys(tops).map(function (k) { return tops[k]; })
      .filter(function (t) { return t && (t.level === "致命" || t.level === "重要"); })
      .slice(0, 3);

    /* 面试疑点 → 补成亮点 */
    var probes = (p.probes || []).filter(function (x) { return x.kind === "疑点"; }).slice(0, 3);

    var months = (p.profile && p.profile.exp_months) || 0;
    var years = Math.floor(months / 12);

    return {
      industry: industry,
      family: family,
      kind: p.kind || "",
      level: p.level || "",
      total: p.total || 0,
      years: years,
      jobLabel: (global.App && App.industryLabel && App.industryLabel()) || "",
      gaps: gaps,
      quickFix: quickFix,
      evidences: evidences,
      certs: certs,
      tips: (kb.tips || []).slice(0, 4),
      pitfalls: (kb.pitfalls || []).slice(0, 3),
      screen: (kb.screen || []).slice(0, 3),
      fatal: fatal,
      probes: probes,
      strengths: (p.strengths || []).slice(0, 2),
      ladder: PD.ladder || [],
      verdict: (p.jd && p.jd.verdict) || "",
      coverage: (p.jd && p.jd.has_jd) ? Math.round((p.jd.coverage || 0) * 100) : null
    };
  }

  /* 一句能背下来的定位句。
     画像句（「2 段经历，平均 36 个月」）不能当卖点 —— 那是事实，不是优势，
     所以先剔掉，退到「你能做的事」，再退到职能族的第一条动作。 */
  var PROFILE_SENT = /段经历|平均|个月|无重复|可追溯/;

  function pitchOf(b) {
    var s = (b.strengths || []).filter(function (x) {
      return x && x.point && !PROFILE_SENT.test(x.point);
    })[0];

    var core;
    if (s) {
      core = s.point.replace(/^[、，。\s]+/, "").replace(/。$/, "");
      return "我是做" + b.family + "的，" + (b.years ? b.years + " 年经验，" : "") +
        "最拿得出手的是：" + core + "。";
    }

    /* 没有能指认的亮点时，别硬凑一句卖点 —— 说清「正在补什么」比编一句强 */
    var gap = b.gaps[0] || b.family;
    return "我是做" + b.family + "的" + (b.years ? "，" + b.years + " 年经验" : "") +
      "；目前缺一条能被核对的证据，正在把「" + gap + "」这件事补出来。";
  }

  /* ---------------- 渲染 ---------------- */

  function render(professional) {
    if (!el.body) return;
    pro = professional || null;
    if (!pro) {
      el.wrap.hidden = true;
      return;
    }
    el.wrap.hidden = false;

    var text = (global.App && App.state && App.state.resumeText) || "";
    var b = build(pro, text);
    built = b;

    el.tag.textContent = b.industry + " · " + b.family + (b.level ? " · " + b.level + " 档" : "");

    var html = "";

    /* 1) 定位 */
    html += '' +
      '<div class="plan-block">' +
        '<div class="plan-block-head"><h3>你现在站在哪</h3>' +
          '<span class="tag">' + esc(b.kind || "已识别") + "</span></div>" +
        '<div class="plan-meta">' +
          '<span>目标方向 <b>' + esc(b.jobLabel || b.industry) + "</b></span>" +
          "<span>职能族 <b>" + esc(b.family) + "</b></span>" +
          "<span>经验 <b>" + (b.years ? b.years + " 年" : "1 年内") + "</b></span>" +
          "<span>当前评分 <b>" + b.total + "</b>" +
            (b.coverage === null ? "" : " · JD 覆盖 <b>" + b.coverage + "%</b>") + "</span>" +
        "</div>" +
        '<p class="plan-line">' + esc(pitchOf(b)) + "</p>" +
        (b.verdict ? '<p class="plan-line plan-line--dim">对这份 JD 的裁决：' + esc(b.verdict) + "</p>" : "") +
      "</div>";

    /* 2) 缺什么 */
    html += '' +
      '<div class="plan-block">' +
        '<div class="plan-block-head"><h3>现在缺什么</h3>' +
          '<span class="tag">' + (b.gaps.length + b.fatal.length) + " 项</span></div>" +
        (b.gaps.length
          ? '<p class="plan-sub">关键词缺口（机筛按这个筛人）</p>' +
            '<div class="plan-kw">' + b.gaps.map(function (w) {
              return '<span class="kw kw--miss">' + esc(w) + "</span>";
            }).join("") + "</div>"
          : '<p class="plan-line plan-line--dim">关键词层面没有明显缺口 —— 接下来拼的是证据深度。</p>') +
        (b.fatal.length
          ? '<p class="plan-sub">必须先修的硬伤</p>' +
            '<ul class="plan-ul">' + b.fatal.map(function (f) {
              return "<li><b>" + esc(f.level) + "</b> " + esc(f.title) +
                (f.fix ? '<i>' + esc(f.fix) + "</i>" : "") + "</li>";
            }).join("") + "</ul>"
          : "") +
      "</div>";

    /* 3) 三档拔高 */
    html += '' +
      '<div class="plan-block">' +
        '<div class="plan-block-head"><h3>往哪拔高</h3><span class="tag">按' + esc(b.family) + "族 / " + esc(b.industry) + "行业</span></div>" +
        '<div class="plan-three">' +

          '<div class="plan-col">' +
            '<p class="plan-col-title">A · 补证据（最值钱）</p>' +
            '<p class="plan-col-note">招聘方只认能被追问的东西，不认证书名。</p>' +
            '<ol class="plan-steps">' + b.evidences.map(function (e) {
              return "<li><b>" + esc(e.do) + "</b><span>产出：" + esc(e.proof) +
                "　约 " + e.weeks + " 周</span></li>";
            }).join("") + "</ol>" +
          "</div>" +

          '<div class="plan-col">' +
            '<p class="plan-col-title">B · 补资质</p>' +
            '<p class="plan-col-note">只列真会卡人的证，不列"提升竞争力"。</p>' +
            '<ol class="plan-steps">' + b.certs.map(function (c) {
              return "<li><b>" + esc(c.name) + "</b><span>" + esc(c.why) +
                "　约 " + c.months + " 个月</span></li>";
            }).join("") + "</ol>" +
          "</div>" +

          '<div class="plan-col">' +
            '<p class="plan-col-title">C · 补表达</p>' +
            '<p class="plan-col-note">同一份经历，换个写法就过筛。</p>' +
            '<ul class="plan-ul">' + b.tips.map(function (t) {
              return "<li>" + esc(t) + "</li>";
            }).join("") +
            b.pitfalls.map(function (t) {
              return '<li class="is-bad">别这样：' + esc(t) + "</li>";
            }).join("") + "</ul>" +
          "</div>" +

        "</div>" +
      "</div>";

    /* 4) 一周内能补的 */
    if (b.quickFix.length) {
      html += '' +
        '<div class="plan-block">' +
          '<div class="plan-block-head"><h3>一周内能补上的</h3><span class="tag">' + b.quickFix.length + " 项</span></div>" +
          '<p class="plan-col-note">缺口词不用背，用一次真实动作把它变成证据。</p>' +
          '<ul class="plan-quick">' + b.quickFix.map(function (q) {
            return '<li><span class="kw kw--miss">' + esc(q.word) + "</span><span>" + esc(q.how) + "</span></li>";
          }).join("") + "</ul>" +
        "</div>";
    }

    /* 5) 3 / 6 / 12 月阶梯 */
    html += '' +
      '<div class="plan-block">' +
        '<div class="plan-block-head"><h3>3 / 6 / 12 个月怎么排</h3><span class="tag">自动挂上上面的动作</span></div>' +
        '<div class="plan-ladder">' + b.ladder.map(function (l, i) {
          var ev = b.evidences[i];
          var ce = b.certs[i];
          return '' +
            '<div class="plan-rung">' +
              '<span class="plan-rung-key">' + esc(l.key) + "</span>" +
              '<div class="plan-rung-body">' +
                '<p class="plan-rung-title">' + esc(l.title) + "</p>" +
                '<p class="plan-rung-how">' + esc(l.how) + "</p>" +
                (ev ? '<p class="plan-rung-do">本阶段动作：' + esc(ev.do) +
                  (ce ? "；同时考 " + esc(ce.name) : "") + "</p>" : "") +
              "</div>" +
            "</div>";
        }).join("") + "</div>" +
      "</div>";

    /* 6) 面试：把疑点补成亮点 */
    if (b.probes.length) {
      html += '' +
        '<div class="plan-block">' +
          '<div class="plan-block-head"><h3>面试前把这些疑点备好</h3><span class="tag">' + b.probes.length + " 条</span></div>" +
          '<ul class="plan-ul plan-ul--probe">' + b.probes.map(function (x) {
            return "<li><b>" + esc(x.question) + "</b>" +
              (x.answer_skeleton ? "<i>" + esc(x.answer_skeleton) + "</i>" : "") + "</li>";
          }).join("") + "</ul>" +
        "</div>";
    }

    el.body.innerHTML = html;
    el.pitch.textContent = pitchOf(b);
    if (el.intro) el.intro.textContent = pro.selfIntro || "";
  }

  /* ---------------- 交互 ---------------- */

  function bind() {
    if (el.btnCopyPitch) {
      el.btnCopyPitch.addEventListener("click", function () {
        if (!built) return;
        copy(pitchOf(built), "定位句已复制");
      });
    }
    if (el.btnCopyIntro) {
      el.btnCopyIntro.addEventListener("click", function () {
        copy((el.intro && el.intro.textContent) || "", "自我介绍已复制");
      });
    }
  }

  function init() {
    el = {
      wrap: document.getElementById("planWrap"),
      body: document.getElementById("planBody"),
      tag: document.getElementById("planTag"),
      pitch: document.getElementById("planPitch"),
      intro: document.getElementById("introText"),
      btnCopyPitch: document.getElementById("btnCopyPitch"),
      btnCopyIntro: document.getElementById("btnCopyIntro")
    };
    if (!el.body) return;
    bind();
  }

  global.PlanView = { init: init, render: render, build: build, pitchOf: pitchOf };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);