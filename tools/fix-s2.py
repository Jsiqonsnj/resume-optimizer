# -*- coding: utf-8 -*-
import io

p = r"D:\简历优化\resume-optimizer\tools\stage2-check.js"
s = io.open(p, encoding="utf-8").read()

idx = s.index('  await client.send("Emulation.setDeviceMetricsOverride"')
tail = '''  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  await evaluate('(window.dispatchEvent(new Event("resize")), 1)');
  await sleep(700);

  const mobile = await evaluate(`(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    paperW: Math.round(document.querySelector('.paper').getBoundingClientRect().width),
    circles: document.querySelectorAll('#inkLayer .ink-circle').length
  }))()`);
  check("390 宽无横向溢出", mobile.overflow <= 1, mobile);
  check("小屏重排后圈数量不变", mobile.circles === afterSkip.circles, mobile);

  const shot2 = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, "stage2-scan-mobile.png"), Buffer.from(shot2.data, "base64"));

  const errs = await evaluate("window.__errors");
  check("无 JS 运行时错误", errs.length === 0, errs);

  client.close();
  proc.kill();

  const failed = checks.filter((c) => !c.ok);
  console.log("---- 结果 ----");
  console.log("通过 " + (checks.length - failed.length) + " / " + checks.length);
  if (failed.length) {
    console.log("失败项：" + failed.map((f) => f.name).join("、"));
    process.exitCode = 1;
  }
})();
'''

s = s[:idx] + tail
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("ok", len(s))