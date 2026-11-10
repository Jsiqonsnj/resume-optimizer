/* =========================================================
 * optimize.js — 优化页：把可改的句子摘出来，用「我问你答」要材料
 * ---------------------------------------------------------
 * 和「审阅」的分工：
 *   审阅 = 我有问题（圈出来 + 追问清单 + 面试会怎么问），你只需要看
 *   优化 = 我们要改（逐句问你要料 → 按骨架拼成一句能直接替换的话）
 * 所以这一页不重复展示诊断，只做「一句话 → 一句话」的作业本。
 * ========================================================= */

(function (global) {
  "use strict";

  var STORE = "resume-opt.opt.v1";
  var el = {};
  var pro = null;
  var state = { hash: "", items: {} };

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function hashOf(text) {
    var t = String(text || "");
    var h = 5381;
    for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return t.length + ":" + (h >>> 0).toString(36);
  }

  function toast(msg, kind) {
    if (global.App && App.toast) App.toast(msg, kind);
  }

  function copy(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { toast(msg || "已复制"); })
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

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "null");
      if (raw && raw.hash === hashOf(App.state.resumeText)) {
        state = raw;
        state.items = state.items || {};
        return;
      }
    } catch (e) { /* 忽略坏数据 */ }
    state = { hash: hashOf(App.state.resumeText), items: {} };
  }

  function save() {
    try {
      state.hash = hashOf(App.state.resumeText);
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ---------------- 拼句子 ---------------- */

  /* 为什么不是「往骨架的【】里填空」：
     引擎骨架的槽位比问题多（比如 5 个槽对 3 个问题，还有「从 A 提到 B」
     这种非槽位占位），硬填空只会拼出「搭建/运营3 个社群共 1200 人社群/账号」
     这种句子。所以这里改用固定三段式：
         规模/对象（问1） → 我负责的动作（问2） → 结果（问3）
     骨架与范例仍然完整展示在下方，由用户自己调词序。 */
  var VERB_HEAD = /^(用|通过|负责|主导|推动|搭建|运营|优化|策划|对接|维护|管理|设计|开发|测试|带|做|把|将|独立|参与)/;

  function compose(item, answers) {
    var a = answers.map(function (s) { return String(s || "").trim(); });
    var filled = a.filter(Boolean);

    if (!filled.length) return item.example || "";

    if (filled.length >= 3) {
      var act = a[1];
      var head = VERB_HEAD.test(act) ? act : (act ? "负责" + act : "");
      var text = [a[0], head, a[2] ? "结果：" + a[2] : ""]
        .filter(Boolean).join("，");
      return /[。！？]$/.test(text) ? text : text + "。";
    }
    if (filled.length === 2) return filled[0] + "，" + filled[1];
    return filled[0];
  }

  function leftover(item, answers) {
    var missing = (item.ask || []).map(function (q, i) {
      return String(answers[i] || "").trim() ? "" : q;
    }).filter(Boolean);
    return { n: missing.length, ask: missing };
  }

  /* ---------------- 整份怎么重排（同一页的另一半活） ---------------- */
  function renderRestructure(p) {
    if (!el.planList) return;
    var list = (p && p.restructure) || [];
    el.planCount.textContent = list.length ? list.length + " 条" : "无";
    el.planList.innerHTML = list.length
      ? list.map(function (x, i) {
        return '<div class="plan-item">' +
          '<span class="plan-index">' + (i + 1) + "</span>" +
          "<div>" +
            '<p class="plan-do">' + esc(x.do) + "</p>" +
            '<p class="plan-why">' + esc(x.why) + "</p>" +
          "</div>" +
        "</div>";
      }).join("")
      : '<p class="empty-text">这份简历的顺序没有明显问题。</p>';
  }

  /* ---------------- 渲染 ---------------- */

  function render(professional) {
    if (!el.list) return;
    pro = professional || null;
    if (!pro) {
      el.wrap.hidden = true;
      return;
    }
    el.wrap.hidden = false;
    load();
    renderRestructure(pro);

    var list = pro.rewrites || [];
    el.count.textContent = list.length ? list.length + " 句待改" : "无";
    el.ready.textContent = countDone(list) + " / " + list.length + " 已改";

    if (!list.length) {
      el.list.innerHTML = '<p class="empty-text">没有可改写的句子 —— 先补一段带项目符号的工作 / 项目经历，再回来逐句改。</p>';
      return;
    }

    el.list.innerHTML = list.map(function (item, i) {
      var saved = state.items[i] || {};
      var answers = saved.answers || ["", "", ""];
      var done = !!saved.rewritten;

      return '' +
        '<div class="opt-item' + (done ? " is-done" : "") + '" data-item="' + i + '">' +
          '<div class="opt-head">' +
            '<span class="opt-index">#' + (i + 1) + "</span>" +
            '<span class="opt-family">' + esc(item.family) + "族骨架</span>" +
            '<span class="opt-badge">' + (done ? "已改 ✓" : "待你回答") + "</span>" +
          "</div>" +

          '<blockquote class="opt-quote">' + esc(item.original) + "</blockquote>" +
          '<p class="opt-why">我会这样问你：' + esc(item.problem) + "</p>" +

          '<div class="opt-asks">' +
            (item.ask || []).map(function (q, k) {
              return '' +
                '<label class="opt-ask">' +
                  '<span class="opt-ask-q">' + esc(q) + "</span>" +
                  '<input class="input input--ask" type="text" data-ask="' + k + '" ' +
                    'value="' + esc(answers[k] || "") + '" ' +
                    'placeholder="' + esc(placeholderOf(q)) + '" />' +
                "</label>";
            }).join("") +
          "</div>" +

          '<div class="opt-actions">' +
            '<button class="btn btn--primary btn--sm" type="button" data-act="gen">按骨架生成我这一句</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-act="copy"' + (done ? "" : " hidden") + ">复制改写句</button>" +
            '<button class="btn btn--ghost btn--sm" type="button" data-act="clear">清空</button>' +
            '<span class="opt-tip">数字不用编，填不出来就写「待补」，我不替你造</span>' +
          "</div>" +

          '<div class="opt-result"' + (done ? "" : " hidden") + ">" +
            '<p class="opt-rewritten">' + esc(saved.rewritten || "") + "</p>" +
            '<p class="opt-advice">' + esc(saved.advice || "") + "</p>" +
          "</div>" +

          '<details class="opt-skeleton"' + (done ? "" : " open") + ">" +
            "<summary>看骨架（结构比范文值钱）</summary>" +
            '<p class="opt-sk-line">' + esc(item.skeleton) + "</p>" +
            (item.example ? '<p class="opt-sk-example">照着写：' + esc(item.example) + "</p>" : "") +
          "</details>" +
        "</div>";
    }).join("");
  }

  function placeholderOf(q) {
    var s = String(q || "");
    if (/多大|多少/.test(s)) return "例如：3 个社群共 1200 人";
    if (/指标/.test(s)) return "例如：月活跃";
    if (/从多少|做到多少|前后/.test(s)) return "例如：从 18% 提到 41%";
    if (/动过|做了什么|哪一步/.test(s)) return "例如：改了主推款排布 + 关联搭配";
    if (/多久|多长时间/.test(s)) return "例如：6 个月";
    return "用你自己的话说，越具体越好";
  }

  function countDone(list) {
    var n = 0;
    Object.keys(state.items || {}).forEach(function (k) {
      if (state.items[k] && state.items[k].rewritten) n++;
    });
    return Math.min(n, list.length);
  }

  /* ---------------- 交互 ---------------- */

  function itemEl(node) {
    var box = node.closest ? node.closest(".opt-item") : null;
    return box;
  }

  function answersOf(box) {
    return Array.prototype.map.call(box.querySelectorAll("[data-ask]"), function (inp) {
      return inp.value;
    });
  }

  function generate(box, idx) {
    var list = (pro && pro.rewrites) || [];
    var item = list[idx];
    if (!item) return;
    var answers = answersOf(box);
    var text = compose(item, answers);
    var left = leftover(item, answers);

    var advice = [];
    if (left.n > 0) {
      advice.push("还有 " + left.n + " 个空没填" + (left.ask.length ? "：" + left.ask.join("；") : "") +
        "。空着的那格 HR 一定会问，先想好再填。");
    }
    if (!/[0-9]/.test(text)) {
      advice.push("这句里还没有数字 —— 至少给一个规模（人数 / 金额 / 次数），否则还是「描述」不是「证据」。");
    }
    if (!advice.length) {
      advice.push("结构到位了：先是规模、再是你的动作、最后是结果。放进简历时连同时间段一起写，别单独悬空。");
    }
    advice.push("词序按你自己的语感调；下面那张骨架只用来对照结构，不必逐字套。");
    advice.push("面试会追这一句：口径是什么、基线多少、你个人负责哪一段。");

    var rewritten = text || item.example || "";
    var adviceText = advice.join(" ");

    box.querySelector(".opt-result").hidden = false;
    box.querySelector(".opt-rewritten").textContent = rewritten;
    box.querySelector(".opt-advice").textContent = adviceText;
    box.querySelector('[data-act="copy"]').hidden = false;
    box.classList.add("is-done");
    box.querySelector(".opt-badge").textContent = "已改 ✓";

    state.items[idx] = { answers: answers, rewritten: rewritten, advice: adviceText };
    save();
    if (el.ready) el.ready.textContent = countDone((pro && pro.rewrites) || []) + " / " +
      ((pro && pro.rewrites) || []).length + " 已改";
    toast("已按骨架拼好这句");
  }

  function bind() {
    if (!el.list) return;

    el.list.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var box = itemEl(btn);
      if (!box) return;
      var idx = Number(box.dataset.item);
      var act = btn.dataset.act;

      if (act === "gen") return generate(box, idx);

      if (act === "copy") {
        var text = box.querySelector(".opt-rewritten").textContent;
        if (text) copy(text, "改写句已复制");
        return;
      }

      if (act === "clear") {
        Array.prototype.forEach.call(box.querySelectorAll("[data-ask]"), function (i) { i.value = ""; });
        box.querySelector(".opt-result").hidden = true;
        box.querySelector('[data-act="copy"]').hidden = true;
        box.classList.remove("is-done");
        box.querySelector(".opt-badge").textContent = "待你回答";
        delete state.items[idx];
        save();
        if (el.ready) el.ready.textContent = countDone((pro && pro.rewrites) || []) + " / " +
          ((pro && pro.rewrites) || []).length + " 已改";
      }
    });

    el.list.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var inp = e.target.closest("[data-ask]");
      if (!inp) return;
      e.preventDefault();
      var box = itemEl(inp);
      if (box) generate(box, Number(box.dataset.item));
    });

    if (el.btnExport) el.btnExport.addEventListener("click", function () {
      if (!pro) return;
      download(fileName(), pro.markdown());
      toast("报告已开始下载");
    });

    if (el.btnCopyMd) el.btnCopyMd.addEventListener("click", function () {
      if (!pro) return;
      copy(pro.markdown(), "报告全文已复制");
    });
  }

  function fileName() {
    var meta = (global.App && App.state && App.state.resumeMeta) || {};
    var base = meta.filename ? String(meta.filename).replace(/\.[^.]+$/, "") : "简历";
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return base + "-审视报告-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".md";
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

  function init() {
    el = {
      wrap: document.getElementById("optWrap"),
      list: document.getElementById("optList"),
      count: document.getElementById("optCount"),
      ready: document.getElementById("optReady"),
      planList: document.getElementById("planList"),
      planCount: document.getElementById("planCount"),
      btnExport: document.getElementById("btnExportMd"),
      btnCopyMd: document.getElementById("btnCopyMd")
    };
    if (!el.list) return;
    bind();
  }

  global.OptimizeView = { init: init, render: render, compose: compose };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);