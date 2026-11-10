"""patch-audit-panel.py — 把「04 深审」接进 index.html

为什么用脚本而不是手改：
  · 这个文件被多处脚本/工具改过，行号不稳定；
  · 插入点都在容器块边界上，脚本可以按锚点定位、可重复执行；
  · 重复执行不会插两次（有 panel-audit 就跳过），方便出问题重跑。

做的事：
  1. <head> 加 css/audit.css
  2. 导航：审阅之后插「04 深审」，优化→05、规划→06（含 eyebrow 文案）
  3. 主工作区：审阅面板之后插入 panel-audit
  4. 脚本：engine-audit.js（在 review.js 之后）+ audit-view.js（在 report-view.js 之后）
"""

from pathlib import Path
import shutil
import time

ROOT = Path(".")
IDX = ROOT / "index.html"
BAK_DIR = ROOT / "tools" / "_backup"
BAK_DIR.mkdir(parents=True, exist_ok=True)

src = IDX.read_text(encoding="utf-8")
stamp = time.strftime("%Y%m%d-%H%M%S")
if 'id="panel-audit"' in src:
    print("[skip] panel-audit 已存在，不重复插入")
else:
    shutil.copy2(IDX, BAK_DIR / ("index.before-audit.%s.html" % stamp))

    # ---------- 1. head ----------
    if "css/audit.css" not in src:
        src = src.replace(
            '  <link rel="stylesheet" href="css/pro.css" />',
            '  <link rel="stylesheet" href="css/pro.css" />\n'
            '  <link rel="stylesheet" href="css/audit.css" />'
        )

    # ---------- 2. 导航 ----------
    anchor = 'aria-controls="panel-scan" data-tab="scan" id="tab-scan"'
    i = src.index(anchor)
    j = src.index("</button>", i) + len("</button>")
    nav_item = (
        '\n        <button class="nav-item" type="button" role="tab" aria-selected="false" locked\n'
        '                aria-controls="panel-audit" data-tab="audit" id="tab-audit" data-gate="1" hidden>\n'
        '          <span class="nav-index">04</span><span class="nav-text">深审</span>\n'
        '        </button>'
    )
    src = src[:j] + nav_item + src[j:]

    src = src.replace(
        '<span class="nav-index">04</span><span class="nav-text">优化</span>',
        '<span class="nav-index">05</span><span class="nav-text">优化</span>')
    src = src.replace(
        '<span class="nav-index">05</span><span class="nav-text">规划</span>',
        '<span class="nav-index">06</span><span class="nav-text">规划</span>')
    src = src.replace("<p class=\"panel-eyebrow\">04 / 优化</p>",
                      "<p class=\"panel-eyebrow\">05 / 优化</p>")
    src = src.replace("<p class=\"panel-eyebrow\">05 / 规划</p>",
                      "<p class=\"panel-eyebrow\">06 / 规划</p>")

    # ---------- 3. 面板 ----------
    panel = '''      <!-- ---------- 04 深审：逐行过堂，七件事 ---------- -->
      <section class="panel" id="panel-audit" data-panel="audit" role="tabpanel" aria-labelledby="tab-audit" hidden>
        <div class="panel-head">
          <p class="panel-eyebrow">04 / 深审</p>
          <h1>逐行过堂：每一行都过七关</h1>
          <p class="panel-desc">
            审阅页回答「这份简历值多少分」，这一页回答「每一行会被怎么问」。
            七件事：会被问什么 · 写得够不够细 · 真不真实 · 缺什么 · 该删什么 · 语言有没有 AI 味 · 逻辑通不通。
            每条结论都指向行号，看得见原文，改得动。
          </p>
        </div>

        <div class="panel-body" id="auditBody" hidden>
          <div class="card audit-summary">
            <div class="card-head">
              <h2 class="card-title">七项体检</h2>
              <span class="tag" id="auditEngineTag">AuditEngine</span>
            </div>
            <div class="audit-score-row">
              <div class="audit-score"><strong id="auditScore">--</strong><span>/100</span></div>
              <div class="audit-score-body">
                <div class="audit-score-top">
                  <span class="audit-level is-c" id="auditLevel">—</span>
                  <div class="audit-tags" id="auditTags"></div>
                </div>
                <p class="audit-advice" id="auditAdvice">—</p>
                <p class="audit-cap" id="auditCap" hidden></p>
              </div>
            </div>
            <div class="audit-dims" id="auditDims"></div>
            <div class="audit-counts" id="auditCounts"></div>
          </div>

          <div class="card audit-toolbar-card">
            <div class="audit-toolbar">
              <div class="audit-filters" id="auditFilters" role="group" aria-label="按问题类型筛选"></div>
              <div class="row row--tight">
                <button class="btn btn--ghost btn--sm" type="button" id="auditExpandAll">全部展开</button>
                <button class="btn btn--ghost btn--sm" type="button" id="auditCollapseAll">全部收起</button>
                <button class="btn btn--ghost btn--sm" type="button" id="auditRecompute">重新深审</button>
              </div>
            </div>
            <p class="card-note card-note--dim">
              点任意一行展开七项判断。默认只展开被问得最狠的两行 —— 一次砸 20 条等于没给结论。
            </p>
          </div>

          <div class="audit-rows" id="auditRows"></div>
          <p class="empty-text" id="auditRowsEmpty" hidden></p>

          <div class="audit-grid">
            <div class="card" id="auditAskCard">
              <div class="card-head">
                <h2 class="card-title">追问总表 · 按风险排</h2>
                <span class="tag" id="auditAskCount">—</span>
              </div>
              <p class="card-note">
                这些是面试官真会问出口的话。每条都给一句答法骨架：先说口径，再说你负责哪一段，最后说重做会改什么。
                准备好一条就点「标记已备答」，进度会记住。
              </p>
              <div class="progress"><span id="auditAskBar" class="progress-bar"></span></div>
              <div class="row row--tight">
                <button class="btn btn--ghost btn--sm" type="button" id="auditCopyAsks">复制全部追问</button>
              </div>
              <ul class="audit-ask-list" id="auditAskList"></ul>
            </div>

            <div class="card" id="auditToneCard">
              <div class="card-head">
                <h2 class="card-title">AI 味词表</h2>
                <span class="tag" id="auditToneCount">—</span>
              </div>
              <p class="card-note">
                行话、自夸形容词、软素质声明、模板句式 —— 这些词的共同点是：删掉之后信息量不变。
                所以它们不是风格问题，是占地方。
              </p>
              <div id="auditToneList"></div>
            </div>
          </div>

          <div class="audit-grid">
            <div class="card" id="auditCutCard">
              <div class="card-head">
                <h2 class="card-title">该删清单</h2>
                <span class="tag" id="auditCutCount">—</span>
              </div>
              <div id="auditCutList"></div>
            </div>
            <div class="card" id="auditAddCard">
              <div class="card-head">
                <h2 class="card-title">该补清单</h2>
                <span class="tag" id="auditAddCount">—</span>
              </div>
              <div id="auditAddList"></div>
            </div>
          </div>

          <div class="card" id="auditLogicCard">
            <div class="card-head">
              <h2 class="card-title">逻辑与结构</h2>
              <span class="tag" id="auditLogicCount">—</span>
            </div>
            <p class="card-note">时间线、顺序、技能与经历是否互相打架 —— 这类问题 HR 不会问，但会直接不约你。</p>
            <div id="auditLogicList"></div>
          </div>

          <div class="card" id="auditLadderCard">
            <div class="card-head">
              <h2 class="card-title">没有数字怎么补（可信度从高到低）</h2>
              <span class="tag">补数的顺序</span>
            </div>
            <p class="card-note">
              一个都拿不到，就把「做了什么」写到别人能复现的程度。宁可无数字，不要假数字。
            </p>
            <div class="audit-ladder" id="auditLadder"></div>
          </div>

          <div class="card" id="auditExportCard">
            <div class="card-head">
              <h2 class="card-title">导出深审报告</h2>
              <span class="tag">Markdown</span>
            </div>
            <p class="card-note">
              八节：总评 / 追问总表 / 详细度 / 真实性 / 该补 / 该删 / 语言 / 逻辑。
              带行号，可以逐条对着改。
            </p>
            <div class="row row--tight">
              <button id="auditExportMd" class="btn btn--primary btn--sm" type="button">下载深审报告 .md</button>
              <button id="auditCopyMd" class="btn btn--ghost btn--sm" type="button">复制报告全文</button>
            </div>
          </div>
        </div>

        <div class="panel-body" id="auditEmpty">
          <div class="card">
            <p class="empty-text" id="auditEmptyNote">还没有载入简历。到「上传」页粘贴或拖入一份，这里会逐行过堂。</p>
            <div class="row row--tight">
              <button class="btn btn--primary btn--sm" type="button" data-goto="upload">去上传页</button>
            </div>
          </div>
        </div>
      </section>

'''
    marker = "      <!-- ---------- 04 优化：逐句改，我问你答 ---------- -->"
    if marker not in src:
        marker = "      <!-- ---------- 05 优化：逐句改，我问你答 ---------- -->"
    if marker not in src:
        raise SystemExit("找不到优化面板注释锚点")
    src = src.replace(marker, panel + marker, 1)

    # ---------- 4. 脚本 ----------
    if "js/engine-audit.js" not in src:
        src = src.replace(
            '  <script src="js/engine-resume/review.js"></script>',
            '  <script src="js/engine-resume/review.js"></script>\n'
            '  <script src="js/engine-audit.js"></script>'
        )
    if "js/audit-view.js" not in src:
        src = src.replace(
            '  <script src="js/report-view.js"></script>',
            '  <script src="js/report-view.js"></script>\n'
            '  <script src="js/audit-view.js"></script>'
        )

    IDX.write_text(src, encoding="utf-8")

check = IDX.read_text(encoding="utf-8")
for key in ['id="panel-audit"', 'id="tab-audit"', 'id="auditRows"', 'id="auditAskList"',
            'id="auditDims"', 'id="auditLadder"', 'js/engine-audit.js', 'js/audit-view.js',
            'css/audit.css', '05 / 优化', '06 / 规划']:
    print(key.ljust(26), check.count(key))
print("total lines", len(check.split("\n")))