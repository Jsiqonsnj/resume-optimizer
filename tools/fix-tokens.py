# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\js\engine-rules.js"
lines = io.open(p, encoding="utf-8").read().split("\n")
target = '    var tokens = String(jdText || "").split(/[\\s,，、;；:：/|()（）【】\\[\\]<>《》"“”\'‘’]+/);'
for i, l in enumerate(lines):
    if l.strip().startswith("var tokens = String(jdText"):
        lines[i] = target
        print("fixed line", i + 1)
io.open(p, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print("done")