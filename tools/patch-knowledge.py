# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\js\knowledge.js"
s = io.open(p, encoding="utf-8").read()

s = s.replace(
'''    el = {
      categoryChips: document.getElementById("categoryChips"),
      directionChips: document.getElementById("directionChips"),
      industryCards: document.getElementById("industryCards")
    };''',
'''    el = {
      categoryChips: document.getElementById("categoryChips"),
      directionChips: document.getElementById("directionChips"),
      industryCards: document.getElementById("industryCards"),
      search: document.getElementById("industrySearch"),
      searchResults: document.getElementById("searchResults"),
      count: document.getElementById("industryCount")
    };''', 1)

s = s.replace(
'''    if (App.state.industry) uiCategory = App.state.industry.category;
    renderAll();
    bind();''',
'''    if (App.state.industry) uiCategory = App.state.industry.category;
    renderCount();
    renderAll();
    bind();
    bindSearch();''', 1)

helpers = '''  /* ------------------------------ 搜索 ------------------------------ */

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

'''

s = s.replace("  window.KnowledgeModule = {", helpers + "  window.KnowledgeModule = {", 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("ok", len(s))