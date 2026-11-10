/* =========================================================
 * interview.js — resume_engine/interview.py 的 1:1 移植
 * ---------------------------------------------------------
 * 改完简历只是让他进面试，真正让人挂掉的是「这条是怎么算的」。
 * 三类追问：亮点（问细节，最容易露怯）/ 疑点（要不要你的开关）/ 稳定
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;
  var SG = global.RSignals;
  var CONTENT_SECTIONS = { "工作经历": 1, "实习经历": 1, "项目经历": 1, "校园经历": 1 };

  var QUANT_PROBE = {
    "规模": "这个「{n}」是怎么统计的？口径是什么？",
    "频率": "这个频率是常态还是某个高峰期的？",
    "占比": "这个比例的分母是什么？谁定的口径？",
    "时间": "从原来的周期压到现在，中间砍掉了哪些环节？",
    "对比": "改之前的数据是谁提供的？同期有没有别的变量？"
  };

  var NUM_IN_TEXT = /(\d+(?:\.\d+)?\s*(?:%|万|亿|人|个|条|次|天|小时|万元|倍|元|家|台|单))/g;

  function run(r, s, p) {
    var out = [];

    // ① 亮点追问：挑 score 最高的 2 条
    var content = s.bullets.filter(function (b) { return CONTENT_SECTIONS[b.section]; });
    var top = content.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, 2);
    top.forEach(function (b) {
      if (b.score < 38) return;
      if (b.quant.length) {
        var lv = b.quant[0];
        var nums = b.text.match(NUM_IN_TEXT) || [];
        var q = QUANT_PROBE[lv].replace("{n}", nums.length ? nums[0].trim() : "这个数");
        out.push({
          kind: "亮点", question: q,
          answer_skeleton: "先说口径（分母/周期/统计方式）→ 再说我在其中负责哪一段 → 最后说如果重做会改什么",
          source: SG.excerpt(b, 50)
        });
      } else {
        out.push({
          kind: "亮点", question: "这条里哪部分是你独立做的，哪部分是配合？",
          answer_skeleton: "一句话切分（我做 A 和 B，C 是对接）→ 举一个我独立决策的例子 → 说结果归谁",
          source: SG.excerpt(b, 50)
        });
      }
    });

    // ② 族模板追问
    (D.probe_by_family[p.family] || []).slice(0, 2).forEach(function (q) {
      out.push({
        kind: "亮点", question: q,
        answer_skeleton: "给一个具体场景（时间/对象/动作），不要讲方法论",
        source: ""
      });
    });

    // ③ 疑点追问
    if (p.gaps.length) {
      var g = p.gaps.slice().sort(function (a, b) { return b.months - a.months; })[0];
      out.push({
        kind: "疑点", question: g.months + " 个月的空窗在做什么？",
        answer_skeleton: "做什么（具体）+ 学到什么（可验证）+ 现在能干什么。不解释情绪，只交代事实",
        source: g.after + " → " + g.before
      });
    }

    if (p.shortStints >= 2) {
      out.push({
        kind: "疑点", question: "你这两段都不到一年，是为什么？",
        answer_skeleton: "给一条主线（同一方向的递进）→ 承认其中一段是判断失误 → 说明现在要什么，能待多久",
        source: p.shortStints + " 段短经历"
      });
    }

    for (var i = 0; i < s.bullets.length; i++) {
      var b2 = s.bullets[i];
      if (b2.overclaim.length) {
        out.push({
          kind: "疑点", question: "你写「" + b2.overclaim[0] + "」，能说说具体到什么程度吗？",
          answer_skeleton: "立刻降级到可验证的事实：独立做过几次、处理过多大数量、拿到过什么结果。不要硬撑",
          source: SG.excerpt(b2, 40)
        });
        break;
      }
    }

    if (p.mismatch) {
      out.push({
        kind: "疑点", question: "你之前做的是" + p.mismatch.content + "，为什么现在要做" + p.mismatch.target + "？",
        answer_skeleton: "动机（一件具体的事让你想转）→ 已经准备了什么（项目/学习/证书）→ 旧经验里哪部分直接能用",
        source: p.mismatch.note
      });
    }

    // ④ 稳定追问
    if (p.nJobs >= 2) {
      out.push({
        kind: "稳定", question: "上一份为什么离开？",
        answer_skeleton: "往「我要去哪」说，不往「那里有什么不好」说。一句话说完，不铺开",
        source: ""
      });
    }
    out.push({
      kind: "稳定", question: "你下一份打算待多久？",
      answer_skeleton: "给一个具体的成长路径（半年做到什么、一年做到什么），而不是「希望长期发展」",
      source: ""
    });

    // 去重 + 限量
    var seen = {}, uniq = [];
    out.forEach(function (x) {
      var k = x.question.slice(0, 24);
      if (seen[k]) return;
      seen[k] = 1;
      uniq.push(x);
    });
    return uniq.slice(0, 7);
  }

  function selfIntro(r, p, s) {
    var fam = p.family !== "通用" ? p.family : "相关";
    var years = p.expMonths >= 12 ? Math.floor(p.expMonths / 12) + " 年" : "";
    var best = "";
    var content = s.bullets.filter(function (b) {
      return b.section === "工作经历" || b.section === "实习经历" || b.section === "项目经历";
    });
    if (content.length) {
      var b = content.slice().sort(function (a, b) { return b.score - a.score; })[0];
      best = b.text.slice(0, 40);
    }
    return "我是做" + fam + "的，" + years + "经验。\n" +
      "最近这段我主要负责【" + (best || "填你最相关的一段") + "】。\n" +
      "我最能拿得出手的一件事是【一句话 + 一个数】。\n" +
      "我来应聘这个岗，是因为【一句具体的、和岗位直接相关的原因】。";
  }

  global.RInterview = { run: run, selfIntro: selfIntro, QUANT_PROBE: QUANT_PROBE };
})(typeof window !== "undefined" ? window : globalThis);