/* =========================================================
 * upload.js — 功能 5：文档拖拽识别 + 粘贴正文
 * ---------------------------------------------------------
 * 入口有三种，互不依赖：
 *   1) 全页拖拽 PDF / DOCX / PPTX / TXT
 *   2) 点拖拽区选择文件
 *   3) 直接粘贴正文（离线可用，不需要任何 CDN）
 *
 * 解析库全部按需从 CDN 懒加载：
 *   pdf.js  → PDF 逐页取文字
 *   mammoth → DOCX 取纯文本
 *   JSZip   → PPTX 解压 slideN.xml 取文字，按页标注
 * CDN 不可用时只关闭文件入口的可用性，粘贴入口照常工作。
 * ========================================================= */

(function () {
  "use strict";

  var CDN = {
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
    jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
  };

  var MAX_BYTES = 20 * 1024 * 1024; // 20MB
  var ACCEPT = { pdf: "PDF", docx: "DOCX", pptx: "PPTX", txt: "TXT" };

  var libs = { pdf: "idle", docx: "idle", pptx: "idle" };
  var loading = {};
  var dragDepth = 0;
  var busy = false;

  var el = {};

  /* ------------------------------ CDN 加载 ------------------------------ */

  function loadScript(url, probe, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (probe()) return resolve();
      var s = document.createElement("script");
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        s.remove();
        reject(new Error("加载超时：" + url));
      }, timeoutMs || 15000);

      s.src = url;
      s.async = true;
      s.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (probe()) resolve();
        else reject(new Error("脚本已加载但未导出全局变量：" + url));
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        s.remove();
        reject(new Error("加载失败：" + url));
      };
      document.head.appendChild(s);
    });
  }

  function ensureLib(kind) {
    if (libs[kind] === "ok") return Promise.resolve();
    if (loading[kind]) return loading[kind];

    var task;
    if (kind === "pdf") {
      task = loadScript(CDN.pdf, function () { return !!window.pdfjsLib; })
        .then(function () {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
        });
    } else if (kind === "docx") {
      task = loadScript(CDN.mammoth, function () { return !!window.mammoth; });
    } else if (kind === "pptx") {
      task = loadScript(CDN.jszip, function () { return !!window.JSZip; });
    } else {
      task = Promise.resolve();
    }

    loading[kind] = task.then(function () {
      libs[kind] = "ok";
      renderCdnStatus();
    }, function (err) {
      libs[kind] = "fail";
      loading[kind] = null;
      renderCdnStatus();
      throw new Error("解析库加载失败，请检查网络后重试（粘贴正文不受影响）");
    });

    return loading[kind];
  }

  function renderCdnStatus() {
    if (!el.cdnStatus) return;
    var states = Object.keys(libs).map(function (k) { return libs[k]; });
    var text, cls;
    if (states.indexOf("fail") !== -1) {
      text = "解析库加载失败 · 仅粘贴可用";
      cls = "tag tag--warn";
    } else if (states.every(function (s) { return s === "ok"; })) {
      text = "解析库已就绪";
      cls = "tag tag--ok";
    } else if (states.indexOf("ok") !== -1) {
      text = "解析库按需加载中";
      cls = "tag";
    } else {
      text = "解析库点击时加载";
      cls = "tag";
    }
    el.cdnStatus.className = cls;
    el.cdnStatus.textContent = text;
  }

  /* ------------------------------ 文本清洗 ------------------------------ */

  function normalizeText(raw) {
    var text = String(raw == null ? "" : raw)
      .replace(/\r\n?/g, "\n")
      .replace(/\u0000/g, "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  }

  function countOf(text) {
    var lines = text ? text.split("\n") : [];
    return {
      lines: lines.length,
      chars: text.replace(/\s/g, "").length
    };
  }

  /* ------------------------------ 各格式解析 ------------------------------ */

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var buf = reader.result;
        var text = decodeBuffer(buf, "utf-8");
        // 中文 Windows 的 TXT 常见 GBK：UTF-8 解码出现大量替换符时回退
        var bad = (text.match(/\uFFFD/g) || []).length;
        if (bad > 3) {
          var gbk = decodeBuffer(buf, "gbk");
          if (gbk && (gbk.match(/\uFFFD/g) || []).length < bad) text = gbk;
        }
        resolve(text);
      };
      reader.onerror = function () { reject(new Error("文件读取失败：" + file.name)); };
      reader.readAsArrayBuffer(file);
    });
  }

  function decodeBuffer(buffer, encoding) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch (err) {
      return "";
    }
  }

  function splitSentences(line) {
    return line
      .split(/(?<=[。；;！!？?])\s*/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  async function extractPdf(file) {
    await ensureLib("pdf");
    var buf = await file.arrayBuffer();
    var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    var out = [];
    var sizes = [];

    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      var lines = [];
      var current = "";

      content.items.forEach(function (item) {
        if (typeof item.str !== "string") return;
        var tr = item.transform || [1, 0, 0, 1, 0, 0];
        var size = Math.round(Math.sqrt(tr[2] * tr[2] + tr[3] * tr[3]) * 2) / 2;
        if (size >= 5 && size <= 40 && sizes.indexOf(size) === -1) sizes.push(size);
        current += item.str;
        if (item.hasEOL) {
          lines.push(current);
          current = "";
        }
      });
      if (current.trim()) lines.push(current);

      lines = lines.map(function (s) { return s.trim(); }).filter(Boolean);

      // 有些 PDF 没有 EOL 信息：整页挤成一行时按句号切，避免行号全挤在一起
      if (lines.length === 1 && lines[0].length > 80) {
        lines = splitSentences(lines[0]);
      }

      if (lines.length) {
        out.push("【第 " + p + " 页】");
        out.push.apply(out, lines);
        out.push("");
      }
    }

    var text = normalizeText(out.join("\n"));
    if (!text) {
      throw new Error("这份 PDF 没有可提取的文字（可能是扫描件或纯图片），纯前端无法 OCR，请改用粘贴正文");
    }
    return {
      text: text,
      pages: pdf.numPages,
      format: { kind: "pdf", pages: pdf.numPages, fontSizes: sizes, fonts: [], textLayer: true }
    };
  }

  async function extractDocx(file) {
    await ensureLib("docx");
    var buf = await file.arrayBuffer();
    var result = await window.mammoth.extractRawText({ arrayBuffer: buf });
    var text = normalizeText(result.value);
    if (!text) throw new Error("这份 DOCX 没有提取到文字（可能是图片排版），请改用粘贴正文");

    // 格式信号是加分项：拿不到（离线 / JSZip 失败）也不影响文本解析
    var format = null;
    try {
      await ensureLib("pptx"); // JSZip
      var zip = await window.JSZip.loadAsync(buf.slice(0));
      var docFile = zip.file("word/document.xml");
      if (docFile) {
        var xml = await docFile.async("text");
        var sizes = [];
        (xml.match(/<w:sz w:val="(\d+)"/g) || []).forEach(function (tag) {
          var n = parseInt(tag.replace(/\D/g, ""), 10) / 2;
          if (n >= 5 && n <= 40 && sizes.indexOf(n) === -1) sizes.push(n);
        });
        var fonts = [];
        (xml.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/g) || []).forEach(function (tag) {
          var m = tag.match(/w:ascii="([^"]+)"/);
          if (m && fonts.indexOf(m[1]) === -1) fonts.push(m[1]);
        });
        if (!sizes.length) {
          // 正文没有显式字号时，只取 docDefaults 的默认字号（styles.xml 里的标题样式不代表实际使用）
          var stylesFile = zip.file("word/styles.xml");
          if (stylesFile) {
            var stylesXml = await stylesFile.async("text");
            var defaults = (stylesXml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/) || [""])[0];
            (defaults.match(/<w:sz w:val="(\d+)"/g) || []).forEach(function (tag) {
              var n2 = parseInt(tag.replace(/\D/g, ""), 10) / 2;
              if (n2 >= 5 && n2 <= 40 && sizes.indexOf(n2) === -1) sizes.push(n2);
            });
          }
        }
        var blocks = xml.split(/<w:p[ >]/).slice(1);
        var empty = blocks.filter(function (b) { return b.indexOf("<w:t") === -1; }).length;
        format = {
          kind: "docx",
          fontSizes: sizes,
          fonts: fonts,
          paragraphs: blocks.length,
          emptyParagraphs: empty,
          estimatedPages: Math.max(1, Math.ceil(text.replace(/\s/g, "").length / 1500))
        };
      }
    } catch (err) {
      console.warn("[upload] DOCX 格式信号提取失败（不影响文本）", err);
    }

    return { text: text, format: format };
  }

  var A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

  async function extractPptx(file) {
    await ensureLib("pptx");
    var buf = await file.arrayBuffer();
    var zip = await window.JSZip.loadAsync(buf);
    var slides = [];

    Object.keys(zip.files).forEach(function (name) {
      var m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      if (m) slides.push({ n: parseInt(m[1], 10), path: name });
    });
    slides.sort(function (a, b) { return a.n - b.n; });

    if (!slides.length) throw new Error("PPTX 结构异常：没有找到幻灯片");

    var out = [];
    var sizes = [];
    var fonts = [];
    for (var i = 0; i < slides.length; i++) {
      var xml = await zip.file(slides[i].path).async("text");
      (xml.match(/<a:rPr[^>]*sz="(\d+)"/g) || []).forEach(function (tag) {
        var n = parseInt(tag.replace(/\D/g, ""), 10) / 100;
        if (n >= 5 && n <= 80 && sizes.indexOf(n) === -1) sizes.push(n);
      });
      (xml.match(/<a:latin typeface="([^"]+)"/g) || []).forEach(function (tag) {
        var m = tag.match(/typeface="([^"]+)"/);
        if (m && fonts.indexOf(m[1]) === -1) fonts.push(m[1]);
      });
      var doc = new DOMParser().parseFromString(xml, "application/xml");
      var paragraphs = doc.getElementsByTagNameNS(A_NS, "p");
      var lines = [];

      for (var j = 0; j < paragraphs.length; j++) {
        var nodes = paragraphs[j].getElementsByTagNameNS(A_NS, "t");
        var line = "";
        for (var k = 0; k < nodes.length; k++) line += nodes[k].textContent || "";
        line = line.trim();
        if (line) lines.push(line);
      }

      out.push("【第 " + slides[i].n + " 页】");
      out.push.apply(out, lines.length ? lines : ["（本页无文字）"]);
      out.push("");
    }

    var text = normalizeText(out.join("\n"));
    if (!text) throw new Error("这份 PPTX 没有提取到文字（可能是图片版式）");
    return {
      text: text,
      pages: slides.length,
      format: { kind: "pptx", pages: slides.length, fontSizes: sizes, fonts: fonts, estimatedPages: slides.length }
    };
  }

  function pickKind(file) {
    var name = String(file.name || "").toLowerCase();
    var ext = name.indexOf(".") !== -1 ? name.split(".").pop() : "";
    if (ext === "doc") throw new Error("暂不支持旧版 .doc，请用 Word 另存为 .docx 后再拖入");
    if (ext === "pdf") return "pdf";
    if (ext === "docx") return "docx";
    if (ext === "pptx") return "pptx";
    if (ext === "txt" || ext === "md" || ext === "text") return "txt";
    // 没有扩展名时按 MIME 兜底
    var type = String(file.type || "");
    if (type === "application/pdf") return "pdf";
    if (type.indexOf("wordprocessingml") !== -1) return "docx";
    if (type.indexOf("presentationml") !== -1) return "pptx";
    if (type.indexOf("text/") === 0) return "txt";
    throw new Error("不支持的文件类型：" + (ext || type || "未知") + "。支持 PDF / DOCX / PPTX / TXT");
  }

  async function extractText(file) {
    var kind = pickKind(file);
    if (kind === "txt") return { text: normalizeText(await readFileAsText(file)) };
    if (kind === "pdf") {
      var r = await extractPdf(file);
      return { text: r.text, pages: r.pages, kind: kind, format: r.format };
    }
    if (kind === "docx") {
      var d = await extractDocx(file);
      return { text: d.text, kind: kind, format: d.format };
    }
    return extractPptx(file);
  }

  /* ------------------------------ 落盘与预览 ------------------------------ */

  function applyResume(text, meta) {
    if (!text || !text.trim()) {
      setStatus("没有解析到可用文字。", "warn");
      App.toast("没有解析到可用文字", "warn");
      return false;
    }
    App.setResume(text, meta);
    renderPreview();
    setStatus("已载入 " + metaLabel(meta) + "，可以去「审阅」页了。", "ok");
    return true;
  }

  function metaLabel(meta) {
    if (!meta) return "简历";
    if (meta.source === "file") return "文件「" + meta.filename + "」";
    return "粘贴正文";
  }

  function renderPreview() {
    var state = App.state;
    var card = el.resumePreview;
    if (!card) return;

    var text = state.resumeText || "";
    if (!text) {
      card.hidden = true;
      return;
    }

    var meta = state.resumeMeta || { source: "paste" };
    var count = countOf(text);

    el.previewSource.textContent = meta.source === "file" ? kindLabel(meta.kind) : "粘贴";
    el.previewSource.className = "tag tag--live";
    el.previewMeta.innerHTML =
      cell("行数", count.lines) +
      cell("字数", count.chars) +
      cell("来源", meta.source === "file" ? escapeHtml(meta.filename || "文件") : "粘贴正文") +
      (meta.pages ? cell("页数", meta.pages) : "");

    var previewLines = text.split("\n");
    var head = previewLines.slice(0, 12).join("\n");
    el.previewText.textContent = previewLines.length > 12
      ? head + "\n… 还有 " + (previewLines.length - 12) + " 行"
      : head;
    el.previewText.hidden = false;
    card.hidden = false;

    // 粘贴来源时把原文回填到编辑框，方便继续改
    if (meta.source !== "file" && el.resumePaste && !el.resumePaste.value.trim()) {
      el.resumePaste.value = text;
      updatePasteCount();
    }
  }

  function kindLabel(kind) {
    return (ACCEPT[kind] || "文件") + " 文件";
  }

  function cell(k, v) {
    return '<div class="summary-cell"><span class="k">' + k + '</span><span class="v">' + escapeHtml(v) + "</span></div>";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(msg, kind) {
    if (!el.uploadStatus) return;
    el.uploadStatus.textContent = msg || "";
    el.uploadStatus.className = "card-note upload-status" + (kind === "warn" ? " is-warn" : kind === "ok" ? " is-ok" : "");
  }

  /* ------------------------------ 文件入口 ------------------------------ */

  async function handleFiles(fileList) {
    if (busy) return;
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    if (files.length > 1) App.toast("一次只解析一份简历，已取第一个文件");

    var file = files[0];
    if (file.size > MAX_BYTES) {
      App.toast("文件超过 20MB，请压缩后再试", "warn");
      setStatus("文件超过 20MB，未解析。", "warn");
      return;
    }
    if (file.size === 0) {
      App.toast("这是一个空文件", "warn");
      return;
    }

    busy = true;
    el.dropzone.classList.add("is-busy");
    setStatus("正在解析「" + file.name + "」…");
    App.toast("开始解析：" + file.name);

    try {
      var result = await extractText(file);
      var meta = {
        source: "file",
        filename: file.name,
        kind: pickKind(file),
        pages: result.pages || 0,
        format: result.format || null
      };
      if (!applyResume(result.text, meta)) return;
      App.toast("解析完成：" + countOf(result.text).lines + " 行");
    } catch (err) {
      console.error("[upload]", err);
      setStatus((err && err.message ? err.message : "解析失败") + "。", "warn");
      App.toast((err && err.message) || "解析失败", "warn");
    } finally {
      busy = false;
      el.dropzone.classList.remove("is-busy");
    }
  }

  function bindDropzone() {
    el.dropzone.addEventListener("click", function () {
      el.fileInput.click();
    });
    el.dropzone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.fileInput.click();
      }
    });

    el.fileInput.addEventListener("change", function () {
      if (el.fileInput.files && el.fileInput.files.length) {
        handleFiles(el.fileInput.files);
      }
      el.fileInput.value = ""; // 允许连续选同一个文件
    });

    el.dropzone.addEventListener("dragenter", function (e) {
      e.preventDefault();
      el.dropzone.classList.add("is-over");
    });
    el.dropzone.addEventListener("dragover", function (e) {
      e.preventDefault();
      el.dropzone.classList.add("is-over");
    });
    el.dropzone.addEventListener("dragleave", function () {
      el.dropzone.classList.remove("is-over");
    });
    el.dropzone.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.dropzone.classList.remove("is-over");
      hideOverlay();
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
  }

  /* ------------------------------ 全页拖拽 ------------------------------ */

  function hasFiles(e) {
    var dt = e.dataTransfer;
    if (!dt) return false;
    if (dt.types && Array.prototype.indexOf.call(dt.types, "Files") !== -1) return true;
    return !!(dt.files && dt.files.length);
  }

  function showOverlay() {
    if (el.dropOverlay) el.dropOverlay.hidden = false;
  }

  function hideOverlay() {
    dragDepth = 0;
    if (el.dropOverlay) el.dropOverlay.hidden = true;
  }

  function bindGlobalDrag() {
    window.addEventListener("dragenter", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      showOverlay();
    });

    window.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    window.addEventListener("dragleave", function (e) {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideOverlay();
    });

    window.addEventListener("drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      hideOverlay();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  /* ------------------------------ 粘贴入口 ------------------------------ */

  function updatePasteCount() {
    if (!el.pasteCount) return;
    var text = el.resumePaste.value || "";
    var count = countOf(text.trim());
    el.pasteCount.textContent = count.chars + " 字 · " + (text.trim() ? count.lines : 0) + " 行";
  }

  function usePaste() {
    var text = normalizeText(el.resumePaste.value);
    if (!text) {
      App.toast("先粘贴或输入简历正文", "warn");
      el.resumePaste.focus();
      return;
    }
    applyResume(text, { source: "paste" });
    App.toast("已载入 " + countOf(text).lines + " 行正文");
  }

  function bindPaste() {
    el.resumePaste.addEventListener("input", updatePasteCount);

    el.btnUsePaste.addEventListener("click", usePaste);

    el.resumePaste.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        usePaste();
      }
    });

    el.btnClipboard.addEventListener("click", async function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        App.toast("这个浏览器不支持读取剪贴板，请直接 Ctrl+V", "warn");
        el.resumePaste.focus();
        return;
      }
      try {
        var text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          App.toast("剪贴板是空的", "warn");
          return;
        }
        el.resumePaste.value = text;
        updatePasteCount();
        App.toast("已从剪贴板读取 " + countOf(normalizeText(text)).lines + " 行，点「使用这段文本」生效");
      } catch (err) {
        App.toast("没有剪贴板读取权限，请手动 Ctrl+V", "warn");
        el.resumePaste.focus();
      }
    });

    el.btnClearResume.addEventListener("click", function () {
      App.setResume("", null);
      el.resumePaste.value = "";
      updatePasteCount();
      renderPreview();
      setStatus("已清空。拖入文件或粘贴正文开始。");
      App.toast("已清空简历");
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  function init() {
    el = {
      dropzone: document.getElementById("dropzone"),
      fileInput: document.getElementById("fileInput"),
      dropOverlay: document.getElementById("dropOverlay"),
      uploadStatus: document.getElementById("uploadStatus"),
      cdnStatus: document.getElementById("cdnStatus"),
      resumePaste: document.getElementById("resumePaste"),
      pasteCount: document.getElementById("pasteCount"),
      btnUsePaste: document.getElementById("btnUsePaste"),
      btnClipboard: document.getElementById("btnClipboard"),
      btnClearResume: document.getElementById("btnClearResume"),
      resumePreview: document.getElementById("resumePreview"),
      previewSource: document.getElementById("previewSource"),
      previewMeta: document.getElementById("previewMeta"),
      previewText: document.getElementById("previewText")
    };

    if (!el.dropzone) return;

    renderCdnStatus();
    bindDropzone();
    bindGlobalDrag();
    bindPaste();

    // 恢复已有内容
    if (App.state.resumeText) {
      renderPreview();
      setStatus("已恢复上次载入的简历（" + countOf(App.state.resumeText).lines + " 行）。", "ok");
    } else {
      setStatus("还没载入简历。拖入文件、点击选择，或直接粘贴正文。");
    }

    document.addEventListener("resume:change", function () {
      renderPreview();
    });
  }

  window.UploadModule = {
    handleFiles: handleFiles,
    extractText: extractText,
    normalizeText: normalizeText,
    state: function () { return { libs: libs, busy: busy }; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();