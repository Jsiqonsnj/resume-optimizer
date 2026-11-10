# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\js\scan.js"
s = io.open(p, encoding="utf-8").read()

s = s.replace(
'''  var resolved = {};''',
'''  var resolved = {};
  var scanned = false;''', 1)

s = s.replace(
'''    running = false;
    el.btnScanStart.disabled = false;''',
'''    running = false;
    scanned = true;
    el.btnScanStart.disabled = false;''', 1)

s = s.replace(
'''  function drawAllInstant() {
    hideBubble();''',
'''  function drawAllInstant() {
    scanned = true;
    hideBubble();''', 1)

s = s.replace(
'''    bindQuestions();
    bindCircles();''',
'''    bindQuestions();
    bindCircles();

    // 窗口尺寸变化后行位置会变，重排一次圈的位置
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (!issues.length || running) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        renderPaper();
        if (scanned) drawAllInstant();
      }, 180);
    });''', 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("ok", len(s))