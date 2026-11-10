/* =========================================================
 * knowledge.js — 功能 1：行业 HR 偏好知识库
 * ---------------------------------------------------------
 * 两级选择（行业大类 → 二级方向），数据全部来自 js/data.js。
 * 选中方向后：
 *   - 顶栏行业标签常驻（main.js 的 setIndustry 负责）
 *   - 本页渲染四张知识卡片：筛简历习惯 / 偏好写法 / 常见减分项 / 核心关键词
 *   - 选择写入 localStorage，刷新不丢
 * ========================================================= */

(function () {
  "use strict";

  var el = {};
  var tree = [];
  var db = {};
  var uiCategory = "";   // 当前正在浏览的大类（可能还没选方向）

  /* ------------------------------ 工具 ------------------------------ */

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function keyOf(category, direction) {
    return category + "-" + direction;
  }

  function findEntry(category, direction) {
    return db[keyOf(category, direction)] || null;
  }

  function groupOf(category) {
    return tree.filter(function (g) { return g.category === category; })[0] || null;
  }

  function selectedCategory() {
    var industry = App.state.industry;
    return uiCategory || (industry ? industry.category : "");
  }

  /* ------------------------------ 选择器 ------------------------------ */

  function renderCategories() {
    var current = selectedCategory();
    el.categoryChips.innerHTML = tree.map(function (group) {
      var active = group.category === current;
      return '<button type="button" class="chip-btn' + (active ? " is-active" : "") + '"' +
        ' data-category="' + escapeHtml(group.category) + '"' +
        ' aria-pressed="' + active + '">' + escapeHtml(group.category) + "</button>";
    }).join("");
  }

  function renderDirections(category) {
    if (!category) {
      el.directionChips.innerHTML = '<span class="selector-hint">先选一个行业大类</span>';
      return;
    }
    var group = groupOf(category);
    if (!group) return;

    var industry = App.state.industry;
    el.directionChips.innerHTML = group.directions.map(function (dir) {
      var active = !!industry && industry.category === category && industry.sub === dir;
      var hasData = !!findEntry(category, dir);
      return '<button type="button" class="chip-btn chip-btn--sub' +
        (active ? " is-active" : "") + (hasData ? "" : " is-dim") + '"' +
        ' data-category="' + escapeHtml(category) + '" data-direction="' + escapeHtml(dir) + '"' +
        ' aria-pressed="' + active + '">' + escapeHtml(dir) + "</button>";
    }).join("");
  }

  /* ------------------------------ 知识卡片 ------------------------------ */

  function renderCards() {
    var industry = App.state.industry;
    var category = selectedCategory();
    var direction = industry && industry.category === category ? industry.sub : "";

    if (!category || !direction) {
      el.industryCards.innerHTML =
        '<div class="card card--empty">' +
          '<div class="card-head"><h2 class="card-title">知识卡片</h2>' +
            '<span class="tag">等待选择</span></div>' +
          '<p class="empty-text">' +
            (category
              ? "已选「" + escapeHtml(category) + "」大类，再选一个二级方向即可看到 HR 偏好。"
              : "选好大类与方向后，这里会显示该方向的 HR 筛选习惯、偏好写法、常见减分项与核心关键词。") +
          "</p>" +
        "</div>";
      return;
    }

    var data = findEntry(category, direction);
    if (!data) {
      el.industryCards.innerHTML =
        '<div class="card card--empty"><p class="empty-text">这个方向暂时没有内置数据，' +
        "可以换一个方向，或在 data.js 里补充。</p></div>";
      return;
    }

    el.industryCards.innerHTML = "" +
      '<div class="card">' +
        '<div class="card-head">' +
          '<h2 class="card-title">HR 筛简历的习惯</h2>' +
          '<span class="tag tag--live">' + escapeHtml(keyOf(category, direction)) + "</span>" +
        "</div>" +
        '<p class="k-body">' + escapeHtml(data.hrHabits) + "</p>" +
      "</div>" +

      '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">偏好写法</h2>' +
          '<span class="tag">' + data.preferences.length + " 条</span></div>" +
        '<ul class="k-list">' + data.preferences.map(function (item) {
          return '<li><span class="k-mark">＋</span><span>' + escapeHtml(item) + "</span></li>";
        }).join("") + "</ul>" +
      "</div>" +

      '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">常见减分项</h2>' +
          '<span class="tag">' + data.redFlags.length + " 条</span></div>" +
        '<ul class="k-list k-list--flags">' + data.redFlags.map(function (item) {
          return '<li><span class="k-mark">－</span><span>' + escapeHtml(item) + "</span></li>";
        }).join("") + "</ul>" +
      "</div>" +

      '<div class="card">' +
        '<div class="card-head"><h2 class="card-title">核心关键词</h2>' +
          '<span class="tag">JD 匹配会用到</span></div>' +
        '<div class="kw-list">' + data.keywords.map(function (kw) {
          return '<span class="kw">' + escapeHtml(kw) + "</span>";
        }).join("") + "</div>" +
      "</div>";
  }

  function renderAll() {
    renderCategories();
    renderDirections(selectedCategory());
    renderCards();
  }

  /* ------------------------------ 事件 ------------------------------ */

  function choose(category, direction) {
    uiCategory = category;
    App.setIndustry({ category: category, sub: direction });
    renderAll();
    var data = findEntry(category, direction);
    App.toast("已切到「" + category + "-" + direction + "」" +
      (data ? "，共 " + data.keywords.length + " 个核心关键词" : ""));
  }

  function bind() {
    el.categoryChips.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-category]");
      if (!btn) return;
      var category = btn.dataset.category;
      var group = groupOf(category);
      if (!group) return;

      uiCategory = category;
      var industry = App.state.industry;
      var sameCategory = industry && industry.category === category;

      renderCategories();
      renderDirections(category);

      // 该行业只有一个方向时直接选中，少一次点击
      if (!sameCategory && group.directions.length === 1) {
        choose(category, group.directions[0]);
        return;
      }
      if (!sameCategory) {
        renderCards();
        var first = el.directionChips.querySelector(".chip-btn");
        if (first) first.focus();
      }
    });

    el.directionChips.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-direction]");
      if (!btn) return;
      choose(btn.dataset.category, btn.dataset.direction);
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  function init() {
    el = {
      categoryChips: document.getElementById("categoryChips"),
      directionChips: document.getElementById("directionChips"),
      industryCards: document.getElementById("industryCards"),
      search: document.getElementById("industrySearch"),
      searchResults: document.getElementById("searchResults"),
      count: document.getElementById("industryCount")
    };
    if (!el.categoryChips) return;

    tree = window.INDUSTRY_TREE || [];
    db = window.INDUSTRY_DB || {};

    if (!tree.length) {
      el.industryCards.innerHTML =
        '<div class="card card--empty"><p class="empty-text">js/data.js 未加载，无法显示行业知识库。</p></div>';
      return;
    }

    if (App.state.industry) uiCategory = App.state.industry.category;
    renderCount();
    renderAll();
    bind();
    bindSearch();

    document.addEventListener("industry:change", function (e) {
      var industry = e.detail && e.detail.industry;
      if (industry && industry.category) uiCategory = industry.category;
      renderAll();
    });
  }

  // 口语词 / 别称：招聘方和候选人常用的说法，关键词里不一定有
  var CATEGORY_ALIASES = {
    "互联网": ["码农", "研发", "大厂", "后端", "前端", "全栈"],
    "人工智能": ["AI", "大模型", "算法", "机器学习", "深度学习"],
    "金融": ["银行", "券商", "基金", "投行", "资管", "风控"],
    "快消": ["快消品", "日化", "品牌", "市场部"],
    "零售/电商": ["电商", "淘宝", "直播", "带货", "店铺"],
    "制造业": ["工厂", "产线", "工艺", "精益"],
    "汽车/新能源": ["造车", "整车", "电池", "智驾", "自动驾驶"],
    "国企央企": ["体制内", "央企", "国企", "编制"],
    "政府/事业单位": ["考公", "公务员", "事业编", "选调"],
    "教育": ["老师", "教师", "教书", "教研", "培训"],
    "医疗": ["医院", "医生", "护士", "临床"],
    "生物医药": ["药企", "医药", "制药", "GMP", "新药"],
    "法律": ["律师", "法务", "诉讼", "合规"],
    "财务/会计": ["会计", "财务", "做账", "审计", "税务"],
    "人力资源": ["HR", "人事", "招聘", "薪酬", "绩效"],
    "咨询": ["顾问", "咨询公司", "行研", "战略"],
    "传媒/内容": ["媒体", "编辑", "记者", "公众号", "短视频"],
    "设计/创意": ["设计师", "视觉", "UI", "交互", "工业设计"],
    "建筑/地产": ["建筑", "施工", "地产", "开发商", "工地"],
    "物流/供应链": ["物流", "仓储", "货代", "关务", "供应链"],
    "能源/电力": ["电网", "电力", "发电", "新能源", "储能"],
    "通信": ["运营商", "基站", "射频", "5G", "网络优化"],
    "半导体": ["芯片", "集成电路", "IC", "晶圆", "封测"],
    "游戏": ["手游", "端游", "策划", "原画", "引擎"],
    "文旅/酒店": ["酒店", "旅游", "景区", "民宿"],
    "农业/食品": ["食品", "农产品", "研发", "品控", "种植"]
  };

  /* ------------------------------ 搜索 ------------------------------ */

  function renderCount() {
    if (!el.count) return;
    var total = tree.reduce(function (a, g) { return a + g.directions.length; }, 0);
    el.count.textContent = tree.length + " 大类 · " + total + " 方向";
  }

  function snippet(text, q) {
    var lower = String(text).toLowerCase();
    var i = lower.indexOf(q);
    if (i === -1) return "";
    var start = Math.max(0, i - 14);
    var piece = String(text).slice(start, start + 62);
    return (start > 0 ? "…" : "") + piece + (start + 62 < String(text).length ? "…" : "");
  }

  function matchEntry(category, dir, q) {
    var entry = findEntry(category, dir);
    if (!entry) return null;
    var lower = q.toLowerCase();

    if (String(dir).toLowerCase().indexOf(lower) !== -1) {
      return { field: "方向", snippet: category + " / " + dir };
    }
    if (String(category).toLowerCase().indexOf(lower) !== -1) {
      return { field: "大类", snippet: category + " / " + dir };
    }
    var aliases = CATEGORY_ALIASES[category] || [];
    for (var a = 0; a < aliases.length; a++) {
      if (String(aliases[a]).toLowerCase().indexOf(lower) !== -1 ||
          lower.indexOf(String(aliases[a]).toLowerCase()) !== -1) {
        return { field: "方向", snippet: category + " / " + dir + "（口语：「" + aliases[a] + "」）" };
      }
    }

    var kws = (entry.keywords || []).filter(function (k) {
      return String(k).toLowerCase().indexOf(lower) !== -1;
    });
    if (kws.length) {
      return { field: "关键词", snippet: kws.join(" · ") };
    }
    var lists = [
      { name: "偏好", arr: entry.preferences || [] },
      { name: "减分项", arr: entry.redFlags || [] }
    ];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].arr.length; j++) {
        if (String(lists[i].arr[j]).toLowerCase().indexOf(lower) !== -1) {
          return { field: lists[i].name, snippet: snippet(lists[i].arr[j], lower) };
        }
      }
    }
    if (String(entry.hrHabits || "").toLowerCase().indexOf(lower) !== -1) {
      return { field: "筛选习惯", snippet: snippet(entry.hrHabits, lower) };
    }
    return null;
  }

  function search(q) {
    var query = q.trim().toLowerCase();
    if (!query) {
      el.searchResults.hidden = true;
      el.searchResults.innerHTML = "";
      return;
    }

    var hits = [];
    tree.forEach(function (group) {
      group.directions.forEach(function (dir) {
        if (hits.length >= 12) return;
        var m = matchEntry(group.category, dir, query);
        if (m) hits.push({ category: group.category, dir: dir, field: m.field, snippet: m.snippet });
      });
    });

    if (!hits.length) {
      el.searchResults.hidden = false;
      el.searchResults.innerHTML = '<p class="search-empty">没有匹配「' + escapeHtml(q.trim()) +
        '」的方向，换个说法试试：芯片 / 合规 / GMP / 直播 / 电网。</p>';
      return;
    }

    el.searchResults.hidden = false;
    el.searchResults.innerHTML = hits.map(function (h, i) {
      return '<button type="button" class="search-row" data-index="' + i + '"' +
        ' data-category="' + escapeHtml(h.category) + '" data-direction="' + escapeHtml(h.dir) + '">' +
        '<span class="search-name">' + escapeHtml(h.dir) + '</span>' +
        '<span class="search-hit">' + escapeHtml(h.category) + ' · ' + escapeHtml(h.field) +
        '：' + escapeHtml(h.snippet) + '</span>' +
        '</button>';
    }).join("");
  }

  function bindSearch() {
    if (!el.search || !el.searchResults) return;

    el.search.addEventListener("input", function () { search(el.search.value); });

    el.search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = el.searchResults.querySelector(".search-row");
        if (first) {
          choose(first.dataset.category, first.dataset.direction);
          el.searchResults.hidden = true;
        }
      } else if (e.key === "Escape") {
        el.search.value = "";
        search("");
      }
    });

    el.searchResults.addEventListener("click", function (e) {
      var row = e.target.closest(".search-row");
      if (!row) return;
      choose(row.dataset.category, row.dataset.direction);
      el.searchResults.hidden = true;
      el.search.value = "";
    });

    document.addEventListener("click", function (e) {
      if (el.searchResults.hidden) return;
      if (e.target === el.search || el.searchResults.contains(e.target)) return;
      el.searchResults.hidden = true;
    });
  }

  window.KnowledgeModule = {
    render: renderAll,
    findEntry: findEntry
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();