/* export-pdf-check.js — 真的把 PDF 落到磁盘，验证结构能被阅读器打开
   用法：node tools/export-pdf-check.js [输出路径] */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9345;
const ROOT = path.resolve(__dirname, "..");
const PAGE = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
const OUT = process.argv[2] || path.join(ROOT, ".preview", "report.pdf");
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
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* 等 */ }
    await sleep(300);
  }
  throw new Error("CDP 目标未就绪");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return {
    ready,
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

const DUMP = `(async () => {
  const res = await window.PdfExport.build(window.__lastResult.professional);
  const bytes = res.bytes;
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return { b64: btoa(bin), pages: res.pages, size: res.size };
})()`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edge-pdf-"));
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile, "--window-size=1440,1400", PAGE
  ], { stdio: "ignore" });

  const page = await waitForTargets();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await client.send("Page.reload");
  await sleep(1200);

  const evaluate = async (expression) => {
    const res = await client.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, timeout: 120000
    });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
    return res.result.value;
  };

  await evaluate("(() => { localStorage.clear(); App.setTab('upload'); document.getElementById('btnLoadDemo').click(); return 1; })()");
  await sleep(1000);
  await evaluate("(() => { const b = document.getElementById('btnScanSkip'); if (b && !b.hidden) b.click(); return 1; })()");
  await sleep(1600);

  const dump = await evaluate(DUMP);
  const buf = Buffer.from(dump.b64, "base64");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);

  const head = buf.subarray(0, 8).toString("latin1");
  const tail = buf.subarray(Math.max(0, buf.length - 64)).toString("latin1");
  const pageCount = (buf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length;

  console.log("文件       " + OUT);
  console.log("大小       " + Math.round(buf.length / 1024) + " KB");
  console.log("头          " + JSON.stringify(head));
  console.log("页对象     " + pageCount + "（build 报 " + dump.pages + "）");
  console.log("startxref  " + /startxref/.test(tail));
  console.log("%%EOF      " + /%%EOF/.test(tail));

  const ok = head === "%PDF-1.4" && pageCount >= 1 && /%%EOF/.test(tail) && /startxref/.test(tail);
  console.log(ok ? "PDF OK" : "PDF 结构有问题");
  if (!ok) process.exitCode = 1;

  client.close();
  proc.kill();
})();