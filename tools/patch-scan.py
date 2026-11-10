# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\js\scan.js"
s = io.open(p, encoding="utf-8").read()

reps = [
    # paperInner 引用
    ('    el.paperLines = document.getElementById("paperLines");',
     '    el.paperInner = document.getElementById("paperInner");\n    el.paperLines = document.getElementById("paperLines");'),
    ('    el.inkLayer = document.getElementById("inkLayer");',
     '    el.paperInner = document.getElementById("paperInner");\n    el.inkLayer = document.getElementById("inkLayer");'),
    # viewBox 用 paperInner
    ('    el.inkLayer.setAttribute("viewBox", "0 0 " + el.paperLines.clientWidth + " " + el.paperLines.scrollHeight);\n    el.inkLayer.setAttribute("width", el.paperLines.clientWidth);\n    el.inkLayer.setAttribute("height", el.paperLines.scrollHeight);',
     '    el.inkLayer.setAttribute("viewBox", "0 0 " + el.paperInner.clientWidth + " " + el.paperInner.scrollHeight);\n    el.inkLayer.setAttribute("width", el.paperInner.clientWidth);\n    el.inkLayer.setAttribute("height", el.paperInner.scrollHeight);'),
    # 笔起点
    ('      penPoint(8 + (box.width - 16) * p, y);',
     '      penPoint(4 + (box.width - 8) * p, y);'),
    # 气泡宽度基于 paperInner
    ('    var width = Math.min(300, el.paperLines.clientWidth - 40);',
     '    var width = Math.min(300, el.paperInner.clientWidth - 40);'),
    ('    left = clamp(left, 10, el.paperLines.clientWidth - width - 10);',
     '    left = clamp(left, 10, el.paperInner.clientWidth - width - 10);'),
    # 气泡附到 paperInner 下也没问题（当前 append 在 paperLines）——改到 paperInner
    ('    el.paperLines.appendChild(r);',
     '    el.paperInner.appendChild(r);'),
    # 分析顺序：先读 resolutions 再渲染
    ('      renderPaper();\n      renderQuestions();\n      renderFormat(result.formatIssues || []);',
     '      resolved = loadResolutions();\n      renderPaper();\n      renderQuestions();\n      renderFormat(result.formatIssues || []);'),
    ('      resolved = loadResolutions();\n      renderQuestions();\n\n      if (autoRun)',
     '      if (autoRun)'),
    # 重跑前清计时器
    ('    running = true;\n    cancelled = false;',
     '    running = true;\n    cancelled = false;\n    el.scanTimers = [];\n    el.pen.hidden = false;'),
]

for old, new in reps:
    if old not in s:
        print("MISS:", old[:70].replace("\n", " | "))
    s = s.replace(old, new, 1)

# animateIssue 增加取消守卫
s = s.replace(
'''    await tween(180, function (p) {
      var startX = box.left * 0.15;
      penPoint(startX + (targetX - startX) * p, y);
    });

    await tapPen(targetX, y);
    el.pen.classList.add("is-drawing");
    createCircle(issue, mark, true);
    await wait(680);
    el.pen.classList.remove("is-drawing");

    showBubble(issue, mark, lineEl);
    await wait(1500);
    hideBubble();''',
'''    await tween(180, function (p) {
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
    hideBubble();''', 1)

# resume:change 时若正在跑，先取消
s = s.replace(
'''    document.addEventListener("resume:change", function () {
      // 上传后自动审阅
      text = App.state.resumeText || "";
      if (!text.trim()) return;
      App.setTab("scan");
      analyzeNow(true);
    });''',
'''    document.addEventListener("resume:change", async function () {
      // 上传后自动审阅
      text = App.state.resumeText || "";
      if (!text.trim()) return;
      if (running) {
        cancelled = true;
        await new Promise(function (r) { setTimeout(r, 220); });
      }
      App.setTab("scan");
      analyzeNow(true);
    });''', 1)

# 去重：init 里 paperInner 只保留一处
s = s.replace(
'''    el.paperInner = document.getElementById("paperInner");
    el.paperLines = document.getElementById("paperLines");
    el.paperInner = document.getElementById("paperInner");
    el.inkLayer = document.getElementById("inkLayer");''',
'''    el.paperInner = document.getElementById("paperInner");
    el.paperLines = document.getElementById("paperLines");
    el.inkLayer = document.getElementById("inkLayer");''', 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched scan.js", len(s))