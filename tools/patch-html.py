# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\index.html"
s = io.open(p, encoding="utf-8").read()

start = s.index("      <!-- ---------- 03 审阅 ---------- -->")
end = s.index("      <!-- ---------- 04 优化 ---------- -->")

new_block = '''      <!-- ---------- 03 审阅 ---------- -->
      <section class="panel" id="panel-scan" data-panel="scan" role="tabpanel" aria-labelledby="tab-scan" hidden>
        <div class="panel-head">
          <p class="panel-eyebrow">03 / 审阅</p>
          <h1>HR 正在看你的简历</h1>
          <p class="panel-desc">
            一支笔逐行走完你的简历：正常行快速扫过，快碰到问题行时减速，敲两下，画一个手绘圈，
            再弹出 HR 的疑问。上传简历后会自动开始审阅，动画可跳过、速度可切 1x / 2x / 4x。
          </p>
        </div>

        <div class="panel-body">
          <div class="card scan-bar">
            <div class="scan-bar-info">
              <span id="scanStatus" class="scan-status">等待简历…</span>
              <span class="scan-meta">评分 <strong id="scanScore">--</strong> · 圈出 <strong id="scanIssueCount">0 处</strong></span>
            </div>
            <div class="scan-bar-actions">
              <button id="btnScanStart" class="btn btn--primary" type="button" disabled>开始 HR 审阅</button>
              <button id="btnScanSkip" class="btn btn--ghost" type="button" hidden>跳过动画</button>
              <div class="speed" id="scanSpeed" role="group" aria-label="动画速度">
                <button type="button" class="speed-btn is-active" data-speed="1">1x</button>
                <button type="button" class="speed-btn" data-speed="2">2x</button>
                <button type="button" class="speed-btn" data-speed="4">4x</button>
              </div>
            </div>
          </div>

          <div class="paper-wrap">
            <div class="paper" id="paper">
              <div class="paper-inner" id="paperInner">
                <div class="paper-lines" id="paperLines"></div>
                <svg class="ink-layer" id="inkLayer" aria-hidden="true"></svg>
                <div class="pen" id="pen" hidden><span class="pen-body"></span><span class="pen-tip"></span></div>
                <div class="hr-bubble" id="hrBubble" hidden></div>
              </div>
            </div>
            <p class="paper-hint">
              圈的颜色：灰 = 模糊表述 · 红 = 数据可疑 · 橙 = 时间线冲突 · 蓝 = JD 不匹配 · 黄 = 表述空泛。
              鼠标悬停圈会高亮，点圈跳到下方对应疑问。
            </p>
          </div>

          <div class="card" id="questionsCard">
            <div class="card-head">
              <h2 class="card-title">HR 疑问清单</h2>
              <span id="questionsProgress" class="tag">已解决 0 / 0</span>
            </div>
            <div class="progress"><span id="progressBar" class="progress-bar"></span></div>
            <p class="empty-text" id="questionsEmpty">扫描结束后，每个圈会在这里拆成一条待处理的疑问。</p>
            <ul id="questionList" class="q-list"></ul>
          </div>

          <div class="card" id="formatCard" hidden>
            <div class="card-head">
              <h2 class="card-title">HR 的格式批注</h2>
              <span id="formatCount" class="tag">—</span>
            </div>
            <p class="card-note">
              只对上传的文档生效：字号层级、页数、空行、字体、日期格式、分区、联系方式。
              粘贴纯文本没有这些格式信号，所以不会出现这一段。
            </p>
            <div id="formatNotes" class="format-notes"></div>
          </div>
        </div>
      </section>

'''

s = s[:start] + new_block + s[end:]

# 脚本：补 engine-rules.js 与 scan.js
s = s.replace(
'''  <script src="js/engine.js"></script>
  <script src="js/main.js"></script>
  <script src="js/upload.js"></script>
  <script src="js/knowledge.js"></script>''',
'''  <script src="js/engine.js"></script>
  <script src="js/engine-rules.js"></script>
  <script src="js/main.js"></script>
  <script src="js/upload.js"></script>
  <script src="js/knowledge.js"></script>
  <script src="js/scan.js"></script>''', 1)

# 知识库：搜索框 + 动态计数
s = s.replace(
'''            <div class="card-head">
              <h2 class="card-title">选择行业</h2>
              <span class="tag">15 个方向</span>
            </div>
            <p class="selector-label">行业大类</p>''',
'''            <div class="card-head">
              <h2 class="card-title">选择行业</h2>
              <span class="tag" id="industryCount">加载中…</span>
            </div>
            <label class="sr-only" for="industrySearch">搜索行业</label>
            <input id="industrySearch" class="input search-input" type="search" autocomplete="off"
                   placeholder="搜索行业 / 方向 / 关键词，如：芯片、合规、GMP、直播" />
            <div id="searchResults" class="search-results" hidden></div>
            <p class="selector-label">行业大类</p>''', 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("ok", len(s))