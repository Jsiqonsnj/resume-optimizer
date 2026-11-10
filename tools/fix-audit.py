# -*- coding: utf-8 -*-
import io, re

p = r"D:\简历优化\resume-optimizer\tools\layout-audit.js"
s = io.open(p, encoding="utf-8").read()

pattern = re.compile(r"\n(\s*)const offenders = \[\.\.\.panel\.querySelectorAll\('\*'\)\]\.filter\(n => \{.*?cw: n\.clientWidth \}\)\);", re.S)
m = pattern.search(s)
if not m:
    print("MISS regex")
else:
    indent = m.group(1)
    new = (
        "\n" + indent + "// 装饰层（笔、墨迹、气泡、涟漪）允许溢出，不算内容溢出\n"
        + indent + "const DECOR = ['pen', 'ink-layer', 'hr-bubble', 'tap-ripple'];\n"
        + indent + "const isDecor = (n) => DECOR.some(c => n.classList && n.classList.contains(c));\n"
        + indent + "const offenders = [...panel.querySelectorAll('*')].filter(n => {\n"
        + indent + "  if (isDecor(n)) return false;\n"
        + indent + "  const cs = getComputedStyle(n);\n"
        + indent + "  if (cs.display === 'none' || cs.visibility === 'hidden') return false;\n"
        + indent + "  return n.scrollWidth > n.clientWidth + 2 && (cs.overflowX === 'visible');\n"
        + indent + "}).slice(0, 6).map(n => ({ cls: (n.className || n.tagName).toString().slice(0, 40),\n"
        + indent + "                          sw: n.scrollWidth, cw: n.clientWidth }));"
    )
    s = s[:m.start()] + new + s[m.end():]
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("ok")