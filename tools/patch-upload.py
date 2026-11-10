# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\js\upload.js"
s = io.open(p, encoding="utf-8").read()

# 1) PDF：收集字号
s = s.replace(
'''    var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    var out = [];''',
'''    var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    var out = [];
    var sizes = [];''', 1)

s = s.replace(
'''      content.items.forEach(function (item) {
        if (typeof item.str !== "string") return;
        current += item.str;''',
'''      content.items.forEach(function (item) {
        if (typeof item.str !== "string") return;
        var tr = item.transform || [1, 0, 0, 1, 0, 0];
        var size = Math.round(Math.sqrt(tr[2] * tr[2] + tr[3] * tr[3]) * 2) / 2;
        if (size >= 5 && size <= 40 && sizes.indexOf(size) === -1) sizes.push(size);
        current += item.str;''', 1)

s = s.replace(
'''    return { text: text, pages: pdf.numPages };''',
'''    return {
      text: text,
      pages: pdf.numPages,
      format: { kind: "pdf", pages: pdf.numPages, fontSizes: sizes, fonts: [], textLayer: true }
    };''', 1)

# 2) DOCX：mammoth 取文本 + JSZip 读 document.xml 取格式信号
s = s.replace(
'''  async function extractDocx(file) {
    await ensureLib("docx");
    var buf = await file.arrayBuffer();
    var result = await window.mammoth.extractRawText({ arrayBuffer: buf });
    var text = normalizeText(result.value);
    if (!text) throw new Error("这份 DOCX 没有提取到文字（可能是图片排版），请改用粘贴正文");
    return { text: text };
  }''',
'''  async function extractDocx(file) {
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
        (xml.match(/<w:sz w:val="(\\d+)"/g) || []).forEach(function (tag) {
          var n = parseInt(tag.replace(/\\D/g, ""), 10) / 2;
          if (n >= 5 && n <= 40 && sizes.indexOf(n) === -1) sizes.push(n);
        });
        var fonts = [];
        (xml.match(/<w:rFonts[^>]*w:ascii="([^"]+)"/g) || []).forEach(function (tag) {
          var m = tag.match(/w:ascii="([^"]+)"/);
          if (m && fonts.indexOf(m[1]) === -1) fonts.push(m[1]);
        });
        var blocks = xml.split(/<w:p[ >]/).slice(1);
        var empty = blocks.filter(function (b) { return b.indexOf("<w:t") === -1; }).length;
        format = {
          kind: "docx",
          fontSizes: sizes,
          fonts: fonts,
          paragraphs: blocks.length,
          emptyParagraphs: empty,
          estimatedPages: Math.max(1, Math.ceil(text.replace(/\\s/g, "").length / 1500))
        };
      }
    } catch (err) {
      console.warn("[upload] DOCX 格式信号提取失败（不影响文本）", err);
    }

    return { text: text, format: format };
  }''', 1)

# 3) PPTX：字号 / 字体
s = s.replace(
'''    var out = [];
    for (var i = 0; i < slides.length; i++) {
      var xml = await zip.file(slides[i].path).async("text");''',
'''    var out = [];
    var sizes = [];
    var fonts = [];
    for (var i = 0; i < slides.length; i++) {
      var xml = await zip.file(slides[i].path).async("text");
      (xml.match(/<a:rPr[^>]*sz="(\\d+)"/g) || []).forEach(function (tag) {
        var n = parseInt(tag.replace(/\\D/g, ""), 10) / 100;
        if (n >= 5 && n <= 80 && sizes.indexOf(n) === -1) sizes.push(n);
      });
      (xml.match(/<a:latin typeface="([^"]+)"/g) || []).forEach(function (tag) {
        var m = tag.match(/typeface="([^"]+)"/);
        if (m && fonts.indexOf(m[1]) === -1) fonts.push(m[1]);
      });''', 1)

s = s.replace(
'''    return { text: text, pages: slides.length };''',
'''    return {
      text: text,
      pages: slides.length,
      format: { kind: "pptx", pages: slides.length, fontSizes: sizes, fonts: fonts, estimatedPages: slides.length }
    };''', 1)

# 4) extractText 透传 format
s = s.replace(
'''    if (kind === "pdf") {
      var r = await extractPdf(file);
      return { text: r.text, pages: r.pages, kind: kind };
    }
    if (kind === "docx") {
      var d = await extractDocx(file);
      return { text: d.text, kind: kind };
    }
    return extractPptx(file);''',
'''    if (kind === "pdf") {
      var r = await extractPdf(file);
      return { text: r.text, pages: r.pages, kind: kind, format: r.format };
    }
    if (kind === "docx") {
      var d = await extractDocx(file);
      return { text: d.text, kind: kind, format: d.format };
    }
    return extractPptx(file);''', 1)

# 5) meta 带上 format
s = s.replace(
'''      var meta = {
        source: "file",
        filename: file.name,
        kind: pickKind(file),
        pages: result.pages || 0
      };''',
'''      var meta = {
        source: "file",
        filename: file.name,
        kind: pickKind(file),
        pages: result.pages || 0,
        format: result.format || null
      };''', 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched upload.js", len(s))