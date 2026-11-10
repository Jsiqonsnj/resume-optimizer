/* =========================================================
 * pdf-export.js — 标准模板 PDF 导出（自己画 + 自己写 PDF 容器）
 * ---------------------------------------------------------
 * 为什么这么做：
 *   1. file:// 下不能保证拿到 jsPDF / pdf-lib；
 *   2. 中文字体嵌进 PDF 需要子集化，纯手写不现实；
 *   3. 所以走「canvas 排好版 → JPEG → 图片型 PDF」。真 PDF、真中文、
 *      任何阅读器都打得开，不联网、不依赖任何库。
 * 代价：文字不可选中（A4 150dpi，打印清楚）。
 * ========================================================= */

(function (global) {
  "use strict";

  var PAGE_W = 1240;      // A4 逻辑尺寸（排版坐标系）
  var PAGE_H = 1754;
  var SCALE = 2;          // 实际画布放大 2 倍（约 300dpi），打印与 OCR 都清楚
  var JPEG_Q = 0.92;
  var PT_W = 595.28;
  var PT_H = 841.89;
  var MARGIN = 96;
  var FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif';

  var INK = "#1B3A57";
  var BODY = "#3A3A34";
  var MUTED = "#8A8A80";
  var LINE = "#E7E7E2";

  /* ---------------- 画布排版 ---------------- */

  function Painter() {
    this.pages = [];
    this.page = null;
    this.y = 0;
  }

  Painter.prototype.newPage = function () {
    var cv = document.createElement("canvas");
    cv.width = PAGE_W * SCALE;
    cv.height = PAGE_H * SCALE;
    var ctx = cv.getContext("2d");
    // 坐标系仍用逻辑像素，绘制时统一放大
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = "alphabetic";
    this.page = { canvas: cv, ctx: ctx };
    this.pages.push(this.page);
    this.y = MARGIN;
  };

  Painter.prototype.ensure = function (h) {
    if (!this.page) this.newPage();
    if (this.y + h > PAGE_H - MARGIN - 30) this.newPage();
  };

  Painter.prototype.font = function (size, weight) {
    this.page.ctx.font = (weight || 400) + " " + size + "px " + FONT;
  };

  /* 按字符换行：中文没有空格，只能逐字量宽 */
  Painter.prototype.wrap = function (text, size, weight, maxW) {
    this.font(size, weight);
    var ctx = this.page.ctx;
    var out = [];
    var buf = "";
    var str = String(text == null ? "" : text);
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === "\n") {
        out.push(buf);
        buf = "";
        continue;
      }
      if (ctx.measureText(buf + ch).width > maxW && buf) {
        out.push(buf);
        buf = ch;
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out.length ? out : [""];
  };

  Painter.prototype.text = function (str, opt) {
    var o = opt || {};
    var size = o.size || 15;
    var weight = o.weight || 400;
    var lh = o.lh || Math.round(size * 1.62);
    var color = o.color || BODY;
    var indent = o.indent || 0;
    var maxW = PAGE_W - MARGIN * 2 - indent - (o.right || 0);

    var lines = this.wrap(str, size, weight, maxW);
    for (var i = 0; i < lines.length; i++) {
      this.ensure(lh);
      var ctx = this.page.ctx;
      ctx.fillStyle = color;
      this.font(size, weight);
      ctx.fillText(lines[i], MARGIN + indent, this.y + size);
      this.y += lh;
    }
  };

  Painter.prototype.gap = function (h) {
    this.y += h;
  };

  Painter.prototype.rule = function (color) {
    this.ensure(14);
    var ctx = this.page.ctx;
    ctx.strokeStyle = color || LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, Math.round(this.y) + 0.5);
    ctx.lineTo(PAGE_W - MARGIN, Math.round(this.y) + 0.5);
    ctx.stroke();
    this.y += 14;
  };

  /* 小节标题：一条短竖线 + 标题 */
  Painter.prototype.section = function (title, tag) {
    this.ensure(52);
    this.gap(10);
    var ctx = this.page.ctx;
    ctx.fillStyle = INK;
    ctx.fillRect(MARGIN, this.y + 3, 3, 16);
    ctx.fillStyle = INK;
    this.font(17, 700);
    ctx.fillText(title, MARGIN + 12, this.y + 17);
    if (tag) {
      this.font(12, 400);
      var tw = ctx.measureText(tag).width;
      ctx.fillStyle = MUTED;
      ctx.fillText(tag, PAGE_W - MARGIN - tw, this.y + 16);
    }
    this.y += 34;
  };

  Painter.prototype.bar = function (ratio, color) {
    this.ensure(16);
    var ctx = this.page.ctx;
    var w = PAGE_W - MARGIN * 2;
    ctx.fillStyle = "#F1F1EC";
    ctx.fillRect(MARGIN, this.y, w, 6);
    ctx.fillStyle = color || INK;
    ctx.fillRect(MARGIN, this.y, Math.max(2, Math.round(w * Math.max(0, Math.min(1, ratio)))), 6);
    this.y += 14;
  };

  Painter.prototype.footer = function () {
    var total = this.pages.length;
    for (var i = 0; i < total; i++) {
      var ctx = this.pages[i].ctx;
      ctx.fillStyle = MUTED;
      ctx.font = "400 12px " + FONT;
      ctx.fillText("简历审视报告 · 离线引擎生成 · 数字与原文均来自你的简历，未做润色以外的新增",
        MARGIN, PAGE_H - 52);
      var label = "第 " + (i + 1) + " / " + total + " 页";
      ctx.fillText(label, PAGE_W - MARGIN - ctx.measureText(label).width, PAGE_H - 52);
    }
  };

  /* ---------------- 报告内容 ---------------- */

  function savedRewrites(pro) {
    var map = {};
    try {
      var raw = JSON.parse(localStorage.getItem("resume-opt.opt.v1") || "null");
      if (raw && raw.items) map = raw.items;
    } catch (e) { /* 忽略 */ }
    return map;
  }

  function renderPages(pro) {
    var P = new Painter();
    P.newPage();

    var meta = (global.App && App.state && App.state.resumeMeta) || {};
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var dateStr = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

    /* 页眉 */
    P.text("简历审视报告", { size: 30, weight: 700, color: INK, lh: 44 });
    P.text((meta.filename || "粘贴文本") + "　·　" + dateStr + "　·　引擎 resume_engine " +
      (pro.version || "2.0"), { size: 12.5, color: MUTED, lh: 20 });
    P.gap(6);
    P.rule();

    /* 总评 */
    P.gap(14);
    var ctx = P.page.ctx;
    ctx.fillStyle = INK;
    P.font(56, 700);
    ctx.fillText(String(pro.total), MARGIN, P.y + 44);
    var scoreW = ctx.measureText(String(pro.total)).width;
    ctx.fillStyle = MUTED;
    P.font(15, 400);
    ctx.fillText("/100", MARGIN + scoreW + 4, P.y + 44);

    var tag = (pro.kind || "") + " · " + (pro.level || "") + " 档 · " + (pro.industry || "") +
      " · " + (pro.family || "");
    ctx.fillStyle = INK;
    P.font(14, 600);
    ctx.fillText(tag, MARGIN + scoreW + 62, P.y + 24);
    ctx.fillStyle = MUTED;
    P.font(12.5, 400);
    var jdLine = pro.jd && pro.jd.has_jd
      ? "JD 覆盖 " + Math.round((pro.jd.coverage || 0) * 100) + "% · 裁决 " + (pro.jd.verdict || "")
      : "未录 JD（不参与对岗计算）";
    ctx.fillText(jdLine, MARGIN + scoreW + 62, P.y + 44);
    P.y += 58;

    P.text(pro.advice || "", { size: 14, color: BODY, lh: 24 });
    if (pro.capped) {
      P.text("原始分 " + pro.rawTotal + "，因 " + pro.nFatal + " 处致命问题压到 " + pro.cap +
        " —— 有硬伤时维度相加是假分。", { size: 12.5, color: "#8A5326", lh: 22 });
    }

    /* 五维分 */
    P.section("五维分", "条越长越接近该维度满分");
    (pro.dimensions || []).forEach(function (dim) {
      var pct = dim.max ? dim.score / dim.max : 0;
      var color = pct >= 0.7 ? "#4C8A67" : (pct >= 0.4 ? "#C79A3F" : "#C4664F");
      P.text(dim.name + "　" + dim.score + " / " + dim.max, { size: 13, weight: 600, color: INK, lh: 21 });
      P.bar(pct, color);
      if (dim.issues && dim.issues[0]) {
        P.text(dim.issues[0], { size: 11.5, color: MUTED, lh: 19 });
      }
      P.gap(4);
    });

    /* 四层诊断 */
    P.section("四层诊断", "每层只给最狠的一条");
    var order = ["内容无效", "读不下去", "对岗不投", "面试会挨打"];
    order.forEach(function (name) {
      var top = (pro.tops || {})[name];
      P.text(name, { size: 12, weight: 700, color: MUTED, lh: 20 });
      if (!top) {
        P.text("这一层没抓到硬伤。", { size: 13, color: MUTED, lh: 21 });
        return;
      }
      P.text("[" + top.level + "] " + top.title, { size: 13.5, weight: 600, color: INK, lh: 22 });
      if (top.why) P.text(top.why, { size: 12, color: BODY, lh: 20 });
      if (top.fix) P.text("怎么改：" + top.fix, { size: 12, color: "#2D5C7E", lh: 20 });
      P.gap(6);
    });

    /* 亮点 */
    var strengths = pro.strengths || [];
    if (strengths.length) {
      P.section("你手上真有的东西", strengths.length + " 条");
      strengths.slice(0, 3).forEach(function (s) {
        P.text("· " + s.point, { size: 12.5, color: INK, lh: 21 });
        if (s.why) P.text("　" + s.why, { size: 11.5, color: MUTED, lh: 19 });
      });
    }

    /* 追问预演 */
    var probes = pro.probes || [];
    if (probes.length) {
      P.section("面试会被这么问", probes.length + " 问");
      probes.slice(0, 6).forEach(function (x, i) {
        P.text((i + 1) + ". [" + x.kind + "] " + x.question, { size: 12.5, weight: 600, color: INK, lh: 21 });
        P.text("答法：" + x.answer_skeleton, { size: 11.5, color: BODY, lh: 20, indent: 18 });
      });
    }

    /* 逐句改写 */
    var rewrites = pro.rewrites || [];
    if (rewrites.length) {
      var saved = savedRewrites(pro);
      P.section("逐句改写", rewrites.length + " 句");
      rewrites.forEach(function (r, i) {
        P.text((i + 1) + ". 原句", { size: 11.5, weight: 600, color: MUTED, lh: 19 });
        P.text(r.original, { size: 12, color: BODY, lh: 20, indent: 12 });
        var s = saved[i];
        if (s && s.rewritten) {
          P.text("改写", { size: 11.5, weight: 600, color: "#2F6B4F", lh: 19 });
          P.text(s.rewritten, { size: 12.5, weight: 600, color: INK, lh: 21, indent: 12 });
        } else {
          P.text("骨架", { size: 11.5, weight: 600, color: "#2D5C7E", lh: 19 });
          P.text(r.skeleton, { size: 11.5, color: BODY, lh: 20, indent: 12 });
          P.text("要补：" + (r.ask || []).join("；"), { size: 11, color: MUTED, lh: 19, indent: 12 });
        }
        P.gap(6);
      });
    }

    /* 规划摘要 */
    var PD = global.PLAN_DATA;
    if (PD && global.PlanView) {
      var b = global.PlanView.build(pro, (App.state && App.state.resumeText) || "");
      P.section("往哪补（规划摘要）", b.family + " / " + b.industry);
      P.text(global.PlanView.pitchOf(b), { size: 13, weight: 600, color: INK, lh: 22 });
      if (b.gaps.length) {
        P.text("关键词缺口：" + b.gaps.join("、"), { size: 12, color: "#A33B3B", lh: 21 });
      }
      (b.evidences || []).slice(0, 3).forEach(function (e) {
        P.text("· " + e.do + "（产出：" + e.proof + "，约 " + e.weeks + " 周）",
          { size: 12, color: BODY, lh: 20 });
      });
      (b.certs || []).slice(0, 3).forEach(function (c) {
        P.text("· " + c.name + " —— " + c.why + "（约 " + c.months + " 个月）",
          { size: 12, color: BODY, lh: 20 });
      });
      (b.ladder || []).forEach(function (l) {
        P.text(l.key + "　" + l.title + "：" + l.how, { size: 11.5, color: MUTED, lh: 20 });
      });
    }

    P.footer();
    return P.pages.map(function (p) { return p.canvas; });
  }

  /* ---------------- PDF 容器 ---------------- */

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }

  function jpegBytesOf(canvas, quality) {
    var url = canvas.toDataURL("image/jpeg", quality || 0.9);
    return { data: base64ToBytes(url.split(",")[1]), w: canvas.width, h: canvas.height };
  }

  /* 最小可用 PDF：每页一张 DCTDecode 图，不嵌字体 */
  function buildPdf(images) {
    var enc = new TextEncoder();
    var parts = [];
    var len = 0;
    var offsets = [];

    function push(chunk) {
      var bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
      parts.push(bytes);
      len += bytes.length;
    }

    function mark(id) { offsets[id] = len; }

    push("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n");

    var n = images.length;
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((3 + i * 3) + " 0 R");

    mark(1);
    push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    mark(2);
    push("2 0 obj\n<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>\nendobj\n");

    for (var k = 0; k < n; k++) {
      var pageId = 3 + k * 3;
      var contentId = pageId + 1;
      var imageId = pageId + 2;
      var stream = "q\n" + PT_W.toFixed(2) + " 0 0 " + PT_H.toFixed(2) + " 0 0 cm\n/Im0 Do\nQ\n";

      mark(pageId);
      push(pageId + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
        PT_W.toFixed(2) + " " + PT_H.toFixed(2) + "] /Resources << /XObject << /Im0 " +
        imageId + " 0 R >> >> /Contents " + contentId + " 0 R >>\nendobj\n");

      mark(contentId);
      push(contentId + " 0 obj\n<< /Length " + stream.length + " >>\nstream\n" + stream + "endstream\nendobj\n");

      mark(imageId);
      push(imageId + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + images[k].w +
        " /Height " + images[k].h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode" +
        " /Length " + images[k].data.length + " >>\nstream\n");
      push(images[k].data);
      push("\nendstream\nendobj\n");
    }

    var total = 2 + n * 3 + 1;
    var xref = len;
    var rows = ["xref\n0 " + total + "\n", "0000000000 65535 f \n"];
    for (var id = 1; id < total; id++) {
      var off = offsets[id] || 0;
      rows.push(("0000000000" + off).slice(-10) + " 00000 n \n");
    }
    push(rows.join(""));
    push("trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");

    var out = new Uint8Array(len);
    var pos = 0;
    parts.forEach(function (b) {
      out.set(b, pos);
      pos += b.length;
    });
    return out;
  }

  /* ---------------- 对外 ---------------- */

  async function build(pro) {
    if (!pro) throw new Error("没有可导出的结果");
    var canvases = renderPages(pro);
    var images = canvases.map(function (cv) { return jpegBytesOf(cv, JPEG_Q); });
    var bytes = buildPdf(images);
    return {
      bytes: bytes,
      pages: canvases.length,
      size: bytes.length,
      head: String.fromCharCode.apply(null, bytes.subarray(0, 8))
    };
  }

  async function download(pro) {
    var res = await build(pro);
    var meta = (global.App && App.state && App.state.resumeMeta) || {};
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var base = meta.filename ? String(meta.filename).replace(/\.[^.]+$/, "") : "简历";
    var name = base + "-审视报告-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".pdf";

    var blob = new Blob([res.bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    return res;
  }

  global.PdfExport = { build: build, download: download, renderPages: renderPages, buildPdf: buildPdf };

  /* 绑定按钮（按钮在优化页的导出卡里） */
  function init() {
    var btn = document.getElementById("btnExportPdf");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var pro = global.__lastResult && global.__lastResult.professional;
      if (!pro) {
        if (App.toast) App.toast("先跑一次审阅再导出", "warn");
        return;
      }
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = "正在生成…";
      download(pro).then(function (res) {
        btn.disabled = false;
        btn.textContent = old;
        if (App.toast) App.toast("PDF 已生成（" + res.pages + " 页 / " + Math.round(res.size / 1024) + "KB）");
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = old;
        if (App.toast) App.toast("PDF 生成失败：" + err.message, "warn");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);