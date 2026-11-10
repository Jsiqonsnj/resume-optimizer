/* =========================================================
 * jd.js — 目标岗位 JD 的录入
 * ---------------------------------------------------------
 * 引擎里最值钱的三样判断都依赖 JD：关键词覆盖、硬门槛核查、
 * 该投/别投。没有 JD 时只能退化成「按行业通用标准估」。
 * ========================================================= */

(function () {
  "use strict";

  var ta, count, btnSave, btnClear;

  function updateCount() {
    if (!count) return;
    var v = ta.value.trim();
    count.textContent = v.length + " 字" + (v ? " · 已录入" : " · 还没录入");
  }

  function sync() {
    if (!ta) return;
    var cur = (window.App && App.state.jdText) || "";
    if (ta.value !== cur) {
      ta.value = cur;
      updateCount();
    }
  }

  function save() {
    var v = ta.value.trim();
    if (window.App) App.setJd(v);
    updateCount();
    if (window.App) {
      App.toast(v ? "JD 已保存，正在按它重新审视" : "JD 已清空，按行业通用标准估分");
      if (v && App.state.resumeText) App.setTab("scan");
    }
  }

  function init() {
    ta = document.getElementById("jdText");
    if (!ta) return;
    count = document.getElementById("jdCount");
    btnSave = document.getElementById("btnJdSave");
    btnClear = document.getElementById("btnJdClear");

    sync();
    ta.addEventListener("input", updateCount);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    });
    if (btnSave) btnSave.addEventListener("click", save);
    if (btnClear) {
      btnClear.addEventListener("click", function () {
        ta.value = "";
        if (window.App) {
          App.setJd("");
          App.toast("JD 已清空");
        }
        updateCount();
      });
    }
    document.addEventListener("jd:change", sync);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();