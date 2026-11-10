/* =========================================================
 * rewrite.js — resume_engine/rewrite.py 的 1:1 移植
 * ---------------------------------------------------------
 * 原则（比模板重要）：
 *   1. 只重排事实，不新增事实。骨架给的是"怎么摆"，不是"编什么"
 *   2. 每个骨架都必须能填进真实经历。填不进 = 骨架选错，不是客户没料
 *   3. 给例句，不给"XX 公司"这种占位 —— 占位等于什么都没给
 *
 * 骨架按职能族分（SKELETONS 由 extract-engine-data.py 从 Python 导出）。
 * ========================================================= */

(function (global) {
  "use strict";

  var D = global.RLData;
  var PR = global.RProfile;
  var CONTENT_SECTIONS = { "工作经历": 1, "实习经历": 1, "项目经历": 1, "校园经历": 1 };

  function rewriteBullet(b, family) {
    // 骨架跟着「这条讲的什么事」走，而不是跟着求职意向走。
    // 客户投 HR，但这条写的是行政实习 —— 那就该给行政的骨架。
    var own = PR.detectFamily(b.text, "");
    var useFam = own.hits >= 1 ? own.family : family;

    var pool = D.rewrite_skeletons[useFam] || D.rewrite_skeletons[family] || D.rewrite_skeletons["通用"];
    var sk;
    if (!b.quant.length && !b.hasResult) {
      sk = pool[0];
    } else if (b.verbTier <= 2) {
      sk = pool[Math.min(1, pool.length - 1)];
    } else {
      sk = pool.length > 2 ? pool[Math.min(2, pool.length - 1)] : pool[0];
    }

    var problem = b.issues.slice(0, 2).join("；") || "信息量不足";
    return {
      idx: b.idx,
      original: b.text,
      problem: problem,
      skeleton: sk.sk,
      example: sk.ex,
      ask: sk.ask || D.fallback_ask,
      family: useFam,
      line: b.line
    };
  }

  /** 挑最值得改的几条：弱 + 没数 + 篇幅长 */
  function pickRewrites(s, p, limit) {
    limit = limit || 6;
    var content = s.bullets.filter(function (b) { return CONTENT_SECTIONS[b.section]; });
    if (!content.length) return [];
    var scored = content.slice().sort(function (a, b) {
      return (a.score - b.score) || (b.text.length - a.text.length);
    });
    return scored.slice(0, limit).map(function (b) { return rewriteBullet(b, p.family); });
  }

  /* ---------------- 整份怎么重排 ---------------- */
  function restructurePlan(r, p) {
    var plan = [];
    var P = global.RParse;

    if (p.kind === "社招3+" || p.kind === "管理") {
      plan.push({ do: "把工作经历提到教育背景前面", why: p.kind + "阶段，HR 先看你现在在做什么" });
    }
    if (p.kind === "校招") {
      plan.push({
        do: "教育背景保留在最前（校招看学校专业），但只写 3 行：学校/专业/时间 + 一个亮点",
        why: "校招 HR 的默认顺序是先确认学校和专业，再找经历"
      });
    }
    if (P.has(r, "自我评价") && r.selfEval.length > 60) {
      plan.push({
        do: "删掉整段自我评价，换成 3 条「核心优势」，每条后面挂一个证据",
        why: "自评是最贵的位置，形容词在这里的转化率是 0"
      });
    }
    if (!P.has(r, "求职意向")) {
      plan.push({
        do: "第一行加求职意向：岗位名 + 一句话定位",
        why: "没目标岗，HR 只能猜，猜错就进「再看看」堆"
      });
    }
    if (p.expMonths >= 24 && !r.entries.some(function (e) { return e.section === "项目经历"; })) {
      plan.push({
        do: "补一段「代表项目」，只写 1 个：规模 + 你的角色 + 结果",
        why: "两年以上只按公司写经历，看不出你在具体项目里的贡献"
      });
    }
    if (p.kind === "转行") {
      plan.push({
        do: "在求职意向下面加 3 行「为什么转 + 你已具备的可迁移能力」",
        why: "转行不解释动机，HR 会默认你在乱投"
      });
    }
    plan.push({
      do: "文件命名成「姓名-岗位-年限.pdf」，一岗一版",
      why: "投递版本混乱是隐性扣分项，也影响你自己复盘"
    });
    return plan;
  }

  global.RRewrite = {
    rewriteBullet: rewriteBullet,
    pickRewrites: pickRewrites,
    restructurePlan: restructurePlan
  };
})(typeof window !== "undefined" ? window : globalThis);