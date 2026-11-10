# -*- coding: utf-8 -*-
import io, re, sys

p = r"D:\简历优化\resume-optimizer\js\engine-rules.js"
s = io.open(p, encoding="utf-8").read()

pairs = [
    (r"(\\d+(?:\\.\\d+)?)\\s*", r"(\d+(?:\.\d+)?)\s*"),
    (r"var DATE_RANGE_RE = /(19|20)\\d{2}\\s*[.\\-\\/年]\\s*\\d{0,2}\\s*月?\\s*(?:-|–|—|~|至|到)\\s*(?:(19|20)\\d{2}\\s*[.\\-\\/年]?\\s*\\d{0,2}\\s*月?|至今|今)/g;",
     r"var DATE_RANGE_RE = /(19|20)\d{2}\s*[.\-\/年]\s*\d{0,2}\s*月?\s*(?:-|–|—|~|至|到)\s*(?:(19|20)\d{2}\s*[.\-\/年]?\s*\d{0,2}\s*月?|至今|今)/g;"),
    (r".split(/\\r\\n|\\r|\\n/)", r".split(/\r\n|\r|\n/)"),
    (r'replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")', r'replace(/[.*+?^${}()|[\]\\]/g, "\\$&")'),
    (r"raw.match(/^(19|20)\\d{2}/)", r"raw.match(/^(19|20)\d{2}/)"),
    (r"rest.match(/^\\s*[.\\-\\/年]?\\s*(\\d{1,2})/)", r"rest.match(/^\s*[.\-\/年]?\s*(\d{1,2})/)"),
    (r"raw.match(/(19|20)\\d{2}/g)", r"raw.match(/(19|20)\d{2}/g)"),
    (r"endPart.match(/(\\d{1,2})\\s*月?\\s*$/)", r"endPart.match(/(\d{1,2})\s*月?\s*$/)"),
    (r'.split(/[\\s,，、;；:：/|()（）【】\\[\\]<>《》"“”\'‘’]+/)', r'.split(/[\s,，、;；:：/|()（）【】\[\]<>《》"“”\'‘’]+/)'),
    (r'dm[0].replace(/\\s+/g, "")', r'dm[0]'),
    (r'lines.join("\\n")', r'lines.join("\n")'),
    (r"l.match(/\\b(19|20)\\d{2}\\s*([.\\-\\/年])\\s*\\d{1,2}/)", r"l.match(/\b(19|20)\d{2}\s*([.\-\/年])\s*\d{1,2}/)"),
    (r"/(1[3-9]\\d{9})/", r"/(1[3-9]\d{9})/"),
    (r"/[\\w.+-]+@[\\w-]+\\.[\\w.]+/", r"/[\w.+-]+@[\w-]+\.[\w.]+/"),
]

for old, new in pairs:
    if old not in s:
        print("MISS:", old[:60])
    s = s.replace(old, new)

# 简化数据片段的兜底逻辑：正则命中即原文子串
old_block = '''        var dataExcerpt = dm[0];
        // 原文里可能是「提升 300%」，去空格后未必逐字匹配，退回原文片段
        if (line.indexOf(dataExcerpt) === -1) dataExcerpt = dm[0];
        if (line.indexOf(dataExcerpt) === -1) dataExcerpt = dm[1] + line.slice(line.indexOf(dm[1]) + dm[1].length, line.indexOf(dm[1]) + dm[1].length + 12);
'''
new_block = '''        var dataExcerpt = dm[0];
        if (line.indexOf(dataExcerpt) === -1) return; // 理论上不会发生，保底跳过
'''
if old_block in s:
    s = s.replace(old_block, new_block)
else:
    print("MISS: data block")

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("written", len(s))