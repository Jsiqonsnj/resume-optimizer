# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\js\engine.js"
s = io.open(p, encoding="utf-8").read()

reps = [
    ("  async function analyze(resumeText, jdText, industry) {",
     "  async function analyzeFake(resumeText, jdText, industry) {"),
    ("  async function refine(issue, userInput) {",
     "  async function refineFake(issue, userInput) {"),
    ('    MODE: "fake",', '    MODE: "auto",'),
]

for old, new in reps:
    if old not in s:
        print("MISS:", old[:60])
    s = s.replace(old, new)

# 在 refineFake 之前插入两个调度入口
anchor = "  async function refineFake(issue, userInput) {"
wrapper = '''  /* ---------------------------------------------------------
   * 调度：规则引擎优先（engine-rules.js），失败或未加载时回落假数据。
   * 两个实现都必须满足上面的 schema，UI 不感知差异。
   * --------------------------------------------------------- */
  function hasRules() {
    return global.RuleEngine && typeof global.RuleEngine.analyze === "function";
  }

  async function analyze(resumeText, jdText, industry, context) {
    if (hasRules()) {
      try {
        var res = await global.RuleEngine.analyze(resumeText, jdText, industry, context);
        res._meta = res._meta || {};
        res._meta.engine = "rules";
        res._meta.fallback = false;
        return res;
      } catch (err) {
        console.warn("[engine] 规则引擎异常，回落到内置样例", err);
      }
    }
    var fake = await analyzeFake(resumeText, jdText, industry);
    fake._meta.engine = "fake";
    fake._meta.fallback = true;
    return fake;
  }

  async function refine(issue, userInput) {
    if (hasRules() && typeof global.RuleEngine.refine === "function") {
      try {
        return await global.RuleEngine.refine(issue, userInput);
      } catch (err) {
        console.warn("[engine] refine 规则版异常，回落模板", err);
      }
    }
    return refineFake(issue, userInput);
  }

''' + anchor

if anchor in s:
    s = s.replace(anchor, wrapper, 1)
else:
    print("MISS: refineFake anchor")

# validateResult：补 formatIssues 的可选校验，插在 score 检查之前
old_score = '''    if (typeof result.score !== "number" || result.score < 0 || result.score > 100) {
      errors.push("score 必须是 0~100 的数字");
    }'''
new_score = '''    if (result.formatIssues !== undefined) {
      if (!Array.isArray(result.formatIssues)) {
        errors.push("formatIssues 必须是数组");
      } else {
        result.formatIssues.forEach(function (f, i) {
          var at = "formatIssues[" + i + "]";
          if (!f || typeof f !== "object") { errors.push(at + " 不是对象"); return; }
          if (typeof f.label !== "string" || !f.label) errors.push(at + ".label 为空");
          if (typeof f.thought !== "string" || !f.thought) errors.push(at + ".thought 为空");
          if (f.level !== undefined && ["warn", "info"].indexOf(f.level) === -1) {
            errors.push(at + ".level 必须是 warn | info");
          }
        });
      }
    }

    if (typeof result.score !== "number" || result.score < 0 || result.score > 100) {
      errors.push("score 必须是 0~100 的数字");
    }'''
if old_score in s:
    s = s.replace(old_score, new_score, 1)
else:
    print("MISS: score block")

# selfTest 增加 context（格式）与规则模式说明
old_selftest = '''    var result = await analyze(resume, jd, industry);'''
new_selftest = '''    var result = await analyze(resume, jd, industry, opts.context || null);'''
if old_selftest in s:
    s = s.replace(old_selftest, new_selftest, 1)
else:
    print("MISS: selftest analyze")

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched", len(s))