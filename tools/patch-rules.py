# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\js\engine-rules.js"
s = io.open(p, encoding="utf-8").read()

reps = [
    ("            excerpt: later.raw,\n", "            excerpt: later.raw.trim(),\n"),
    ('if (/技能|熟练掌握|熟悉|精通|技术栈|专业能力/.test(lines[i]) && !usedLines[i]) { anchor = i; break; }',
     'if (/技能|熟练掌握|熟悉|精通|技术栈|专业能力/.test(lines[i]) && !usedLines[i] && trim(lines[i]).length >= 8) { anchor = i; break; }'),
    ("        for (var j = 0; j < lines.length; j++) {\n          if (trim(lines[j]) && !usedLines[j]) { anchor = j; break; }\n        }",
     "        for (var j = 0; j < lines.length; j++) {\n          if (trim(lines[j]).length >= 8 && !usedLines[j]) { anchor = j; break; }\n        }\n        if (anchor === -1) {\n          for (var k = 0; k < lines.length; k++) {\n            if (trim(lines[k]) && !usedLines[k]) { anchor = k; break; }\n          }\n        }"),
    ('var phone = /(1[3-9]\\d{9})/.test(text);',
     'var phone = /1[3-9]\\d[\\s-]?\\d{4}[\\s-]?\\d{4}/.test(text);'),
    ('if (s.length >= 2 && s.length <= 12 && STOP.indexOf(s) === -1) out.push(s);',
     'if (s.length >= 2 && s.length <= 12 && STOP.indexOf(s) === -1 && !/^(要求|熟悉|精通|掌握|具备|拥有|具有|优先|相关)/.test(s)) out.push(s);'),
]

for old, new in reps:
    if old not in s:
        print("MISS:", old[:50].replace("\n", "\\n"))
    s = s.replace(old, new)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("ok")