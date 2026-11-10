# -*- coding: utf-8 -*-
import io

# ---------- scan.js：统一用 rect 局部坐标 + SVG 显式尺寸 ----------
p = r"D:\简历优化\resume-optimizer\js\scan.js"
s = io.open(p, encoding="utf-8").read()

s = s.replace(
'''    el.inkLayer.setAttribute("viewBox", "0 0 " + el.paperInner.clientWidth + " " + el.paperInner.scrollHeight);
    el.inkLayer.setAttribute("width", el.paperInner.clientWidth);
    el.inkLayer.setAttribute("height", el.paperInner.scrollHeight);''',
'''    // SVG 必须与 paperInner 的 padding box 严格 1:1，否则 viewBox 缩放会让圈错位
    var layerW = el.paperInner.clientWidth;
    var layerH = Math.max(el.paperInner.scrollHeight, el.paperInner.clientHeight);
    el.inkLayer.setAttribute("viewBox", "0 0 " + layerW + " " + layerH);
    el.inkLayer.style.width = layerW + "px";
    el.inkLayer.style.height = layerH + "px";''', 1)

s = s.replace(
'''  function lineBox(lineEl) {
    return {
      top: lineEl.offsetTop,
      left: lineEl.offsetLeft,
      width: lineEl.offsetWidth,
      height: lineEl.offsetHeight
    };
  }

  function markBox(mark) {
    return {
      left: mark.offsetLeft,
      top: mark.offsetTop,
      width: mark.offsetWidth,
      height: mark.offsetHeight
    };
  }''',
'''  // 统一换算到 paperInner 的本地坐标（与 SVG 的 user unit 一致）
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
  function markBox(mark) { return localRect(mark); }''', 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("scan ok")

# ---------- CSS：让 SVG 尺寸由内联 px 决定 ----------
p2 = r"D:\简历优化\resume-optimizer\css\style.css"
c = io.open(p2, encoding="utf-8").read()
c = c.replace('''.ink-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 3;
  overflow: visible;
}''', '''.ink-layer {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 3;
  overflow: visible;
}''', 1)
io.open(p2, "w", encoding="utf-8", newline="\n").write(c)
print("css ok")

# ---------- upload.js：DOCX 没有显式字号时读 styles.xml 默认值 ----------
p3 = r"D:\简历优化\resume-optimizer\js\upload.js"
u = io.open(p3, encoding="utf-8").read()
u = u.replace(
'''        var blocks = xml.split(/<w:p[ >]/).slice(1);''',
'''        if (!sizes.length) {
          var stylesFile = zip.file("word/styles.xml");
          if (stylesFile) {
            var stylesXml = await stylesFile.async("text");
            (stylesXml.match(/<w:sz w:val="(\\d+)"/g) || []).forEach(function (tag) {
              var n2 = parseInt(tag.replace(/\\D/g, ""), 10) / 2;
              if (n2 >= 5 && n2 <= 40 && sizes.indexOf(n2) === -1) sizes.push(n2);
            });
          }
        }
        var blocks = xml.split(/<w:p[ >]/).slice(1);''', 1)
io.open(p3, "w", encoding="utf-8", newline="\n").write(u)
print("upload ok")