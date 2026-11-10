/* 阶段 1 文件解析联调：DOCX / PPTX / PDF 真文件走一遍 CDN 解析库。
   需要联网（解析库从 cdnjs 加载）。
   用法：node tools/stage1-files.js */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9335;
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
const FIX = path.join(ROOT, ".preview", "fixtures");
const SHOT = path.join(ROOT, ".preview");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    require("http").get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function waitForTargets(timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* not ready */ }
    await sleep(300);
  }
  throw new Error("CDP 目标未就绪");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method) events.push(msg);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  return {
    ready,
    events,
    send(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    },
    close() { ws.close(); }
  };
}

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (detail === undefined ? "" : "  → " + JSON.stringify(detail)));
  if (!ok) failures.push(name);
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-s1f-"));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile, "--window-size=1440,1300", PAGE
  ], { stdio: "ignore" });

  const page = await waitForTargets();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Page.enable");
  await client.send("DOM.enable");
  await sleep(900);

  const evaluate = async (expression, awaitPromise = true) => {
    const res = await client.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error("页面脚本异常: " + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
    }
    return res.result.value;
  };

  const root = await client.send("DOM.getDocument", { depth: 1 });
  const node = await client.send("DOM.querySelector", { nodeId: root.root.nodeId, selector: "#fileInput" });

  async function setFile(absPath) {
    await client.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [absPath] });
    // 等解析完成：resumeMeta.filename 变成目标文件
    const name = path.basename(absPath);
    const started = Date.now();
    while (Date.now() - started < 25000) {
      const meta = await evaluate(`(() => {
        const s = JSON.parse(localStorage.getItem('resume-opt.state.v1') || '{}');
        return { name: s.resumeMeta && s.resumeMeta.filename, text: (s.resumeText || '').slice(0, 400),
                 lines: s.resumeMeta && s.resumeMeta.lines, pages: s.resumeMeta && s.resumeMeta.pages,
                 tag: document.getElementById('previewSource').textContent,
                 status: document.getElementById('uploadStatus').textContent,
                 cdn: document.getElementById('cdnStatus').textContent };
      })()`);
      if (meta.name === name) return meta;
      if (String(meta.status || "").indexOf("失败") !== -1) return meta;
      await sleep(300);
    }
    return { timeout: true };
  }

  console.log("---- DOCX ----");
  const docx = await setFile(path.join(FIX, "test.docx"));
  console.log(JSON.stringify(docx, null, 2));
  check("DOCX 解析出正文", !!(docx.text && docx.text.includes("赵六")), docx.text && docx.text.slice(0, 40));
  check("DOCX 保留多行", docx.lines > 5, docx.lines);
  check("DOCX 来源标记", docx.tag === "DOCX 文件", docx.tag);
  check("mammoth 已加载", String(docx.cdn || "").length > 0, docx.cdn);

  console.log("---- PPTX ----");
  const pptx = await setFile(path.join(FIX, "test.pptx"));
  console.log(JSON.stringify(pptx, null, 2));
  check("PPTX 解析出正文", !!(pptx.text && pptx.text.includes("钱七")), pptx.text && pptx.text.slice(0, 40));
  check("PPTX 按页标注", !!(pptx.text && pptx.text.includes("【第 1 页】") && pptx.text.includes("【第 2 页】")), pptx.text && pptx.text.slice(0, 60));
  check("PPTX 页数", pptx.pages === 2, pptx.pages);
  check("PPTX 来源标记", pptx.tag === "PPTX 文件", pptx.tag);

  console.log("---- PDF ----");
  const pdf = await setFile(path.join(FIX, "test.pdf"));
  console.log(JSON.stringify(pdf, null, 2));
  check("PDF 解析出正文", !!(pdf.text && pdf.text.includes("孙八")), pdf.text && pdf.text.slice(0, 60));
  check("PDF 页码标注", !!(pdf.text && pdf.text.includes("【第 1 页】")), pdf.text && pdf.text.slice(0, 40));
  check("PDF 页数", pdf.pages >= 1, pdf.pages);

  const cdnFinal = await evaluate(`document.getElementById('cdnStatus').textContent`);
  console.log("CDN 状态:", cdnFinal);
  check("三种解析库全部就绪", cdnFinal === "解析库已就绪", cdnFinal);

  await sleep(300);
  const shot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT, "stage1-upload-pdf.png"), Buffer.from(shot.data, "base64"));

  const errors = client.events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails.text + " " + ((e.params.exceptionDetails.exception || {}).description || ""));
  const logErrors = client.events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  console.log("---- 控制台错误 ----");
  console.log(JSON.stringify({ errors, logErrors }, null, 2));
  check("无页面异常", errors.length === 0, errors);

  client.close();
  proc.kill();
  console.log(failures.length ? "FAILED: " + failures.join(" | ") : "ALL PASS");
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error("CHECK FAILED:", err);
  process.exit(1);
});