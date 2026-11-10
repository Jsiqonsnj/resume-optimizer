"""parity.py · 用 Python 引擎产出黄金结果，供 JS 移植版比对

移植最怕的是"看起来对"。所以每一份靶子都跑一遍真引擎，
把完整 dict + markdown 报告存成 JSON，再用 tools/parity-js.js 逐字段比。

    python tools/parity.py            # 生成 tools/golden/cases.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ENGINE = Path(r"D:\破甲后")
sys.path.insert(0, str(ENGINE))

from resume_engine import review, demo_cv           # noqa: E402
from resume_engine import report as R               # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "golden" / "cases.json"
DEMO = json.loads((HERE / "fixtures" / "demo.json").read_text(encoding="utf-8"))

SITE_SAMPLE = """张三 | 后端开发工程师
电话 138-0000-0000 | 邮箱 zhangsan@example.com | 北京
教育背景
2016.09 - 2020.06  某某大学  计算机科学与技术  本科
2020.07 - 2021.06  A 公司  后端开发工程师
负责相关工作，参与业务系统的日常开发与维护。
2021.06 - 2022.03  B 公司  高级后端开发工程师
主导订单服务重构，接口平均响应从 800ms 降到 120ms。
2022.03 - 2023.09  C 公司  技术专家
搭建公司级消息队列平台，支撑日均 2 亿条消息。
2021.03 - 2023.06  某创业项目  技术合伙人
主导开发 SaaS 后台，性能提升 300%，用户满意度大幅提升。
技能
熟练掌握 Java、MySQL、Redis、Kafka。
精通分布式与高并发架构。
工作认真负责，具备良好的团队协作能力。"""

SITE_JD = """岗位：高级后端工程师（云原生方向）
职责：负责核心交易链路的服务设计与稳定性治理；
参与 Go 微服务改造与 K8s 容器化落地；
带领 3-5 人小组完成季度迭代。
要求：5 年以上后端经验；精通 Go 或 Java；
有高并发、分布式事务、消息队列实战经验；
熟悉云原生与 K8s；有团队管理经验。"""

EXTRA = {
    # 空窗 + 至今 + 兼职重叠
    "edge-空窗至今": {
        "job": "运营专员", "industry": "互联网技术", "jd": "",
        "text": """王五 | 男 | 1996.05 | 13700001111 | wangwu@example.com
求职意向：用户运营（3 年经验）
教育背景：XX大学 市场营销（本科） 2014.09-2018.06
工作经历
2018.07-2020.02 XX科技 运营专员
- 负责社群日常运营
- 参与活动策划
2021.02-至今 YY网络 用户运营
- 独立负责 3 个社群共 1500 人，月活从 20% 提到 45%
- 参与会员体系搭建
技能证书：熟练使用 Excel、SQL；CET-6
自我评价：认真负责，沟通能力强，抗压能力强。""",
    },
    # 管理岗 + 团队成果 + 无量化
    "edge-管理岗": {
        "job": "运营经理", "industry": "互联网技术",
        "jd": "岗位职责：负责用户增长团队管理；任职要求：5 年以上经验，3 年以上团队管理经验，本科及以上学历。",
        "text": """赵六 | 男 | 1990.03 | 13600002222 | zhaoliu@example.com
求职意向：运营经理
教育背景：XX大学 工商管理（本科） 2008.09-2012.06
工作经历
2012.07-2016.05 AA公司 运营专员
- 负责店铺日常运营
2016.06-至今 BB集团 运营主管
- 负责团队日常管理
- 带领团队完成各项指标
- 团队成员 8 人
技能证书：Excel、PPT""",
    },
}

CASES = []
for name, case in demo_cv.all_cases():
    CASES.append({"name": name, "text": case["text"], "jd": case["jd"],
                  "industry": case["industry"], "jobTitle": case["job"]})
CASES.append({"name": "site-sample", "text": SITE_SAMPLE, "jd": SITE_JD,
              "industry": "互联网技术", "jobTitle": "高级后端工程师"})
# 站点「载入示例」用的那份（tools/fixtures/demo.json → js/demo-resume.js）
CASES.append({"name": "demo-resume", "text": DEMO["text"], "jd": DEMO["jd"],
              "industry": "", "jobTitle": ""})
for name, case in EXTRA.items():
    CASES.append({"name": name, "text": case["text"], "jd": case["jd"],
                  "industry": case["industry"], "jobTitle": case["job"]})


def main() -> int:
    rows = []
    for c in CASES:
        r = review(c["text"], jd=c["jd"], industry=c["industry"], job_title=c["jobTitle"])
        row = dict(c)
        row["expect"] = json.loads(json.dumps(r, ensure_ascii=False, default=str))
        row["expect_markdown"] = R.to_markdown(r) if not r.get("error") else ""
        row["expect_text"] = R.to_text(r) if not r.get("error") else ""
        rows.append(row)
        print(f"{c['name']:<26} {r.get('total', '-')} /100  "
              f"{r.get('level','-')}  {r.get('kind','-')}  {r.get('family','-')}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"cases": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n写入 {OUT}  {OUT.stat().st_size} bytes  {len(rows)} 份")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())