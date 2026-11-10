"""extract-engine-data.py · 把 resume_engine 的词表原样导成 JS

为什么这么做：resume_engine 是唯一事实源（lexicon.py 是它的灵魂）。
前端不能跑 Python，所以词表必须导出来，但**不许手抄** —— 手抄就会漂移。
改完 Python 词表 → 重跑这个脚本 → 前端立刻同步。

    .venv\\Scripts\\python.exe tools\\extract-engine-data.py
    （或在 D:\\破甲后 下： .venv\\Scripts\\python.exe .\\tools_extract.py）

产物：js/engine-resume/lexicon.data.js
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ENGINE = Path(r"D:\破甲后")
sys.path.insert(0, str(ENGINE))

from resume_engine import lexicon as L          # noqa: E402
from resume_engine import kb as KB              # noqa: E402
from resume_engine import demo_cv as DEMO       # noqa: E402
from resume_engine.jd_match import DICT as JD_DICT, EDU_RANK   # noqa: E402
from resume_engine import rewrite as RW         # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "js" / "engine-resume" / "lexicon.data.js"


def kb_dump() -> dict:
    """把 docs/industry_kb.json 里前端用得上的三样抽出来：screen / pitfalls / keywords"""
    raw = KB.load()
    inds = raw.get("industries") or {}
    out: dict[str, dict] = {}
    for std, aliases in KB.ALIAS.items():
        for alias in aliases:
            d = inds.get(alias) or {}
            if not d:
                continue
            out.setdefault(std, {})
            for k in ("screen", "pitfalls", "keywords", "tips"):
                vals = [x for x in (d.get(k) or []) if isinstance(x, str) and x.strip()]
                if vals:
                    merged = out[std].get(k) or []
                    for v in vals:
                        if v not in merged:
                            merged.append(v)
                    out[std][k] = merged
            break
    return out


def demo_dump() -> dict:
    out = {}
    for name, case in DEMO.all_cases():
        out[name] = {"job": case["job"], "industry": case["industry"],
                     "jd": case["jd"], "text": case["text"]}
    return out


def main() -> int:
    payload = {
        "meta": {
            "source": "resume_engine v2.0 (D:/破甲后/resume_engine)",
            "engine_version": "2.0",
            "verb_tiers": {str(k): len(v) for k, v in L.VERB_TIERS.items()},
            "families": len([k for k in L.JOB_FAMILIES if k != "通用"]),
            "industries": len([k for k in L.INDUSTRY_KW if k != "通用"]),
            "kb_industries": len(kb_dump()),
            "jd_dict": len(JD_DICT),
            "demo_cases": len(demo_dump()),
        },
        # 动词五档 + 反查表（长的优先，避免「独立负责」被「负责」吃掉）
        "verb_tiers": {str(k): v for k, v in L.VERB_TIERS.items()},
        "verb_lookup": sorted([[v, t] for t, vs in L.VERB_TIERS.items() for v in vs],
                              key=lambda x: -len(x[0])),
        "vague_words": L.VAGUE_WORDS,
        "overclaim_words": L.OVERCLAIM_WORDS,
        "first_person": L.FIRST_PERSON,
        "result_markers": L.RESULT_MARKERS,
        "quant_patterns": L.QUANT_PATTERNS,
        "fake_num": L.FAKE_NUM,
        "level_words": {str(k): v for k, v in L.LEVEL_WORDS.items()},
        "ipo_level_gap_tip": L.IPO_LEVEL_GAP_TIP,
        "job_families": L.JOB_FAMILIES,
        "industry_kw": L.INDUSTRY_KW,
        "industry_pitfall": L.INDUSTRY_PITFALL,
        "conversion_map": L.CONVERSION_MAP,
        "transferable": L.TRANSFERABLE,
        "jd_stopwords": sorted(L.JD_STOPWORDS),
        "jd_synonyms": L.JD_SYNONYMS,
        "section_patterns": L.SECTION_PATTERNS,
        "noise_line": L.NOISE_LINE.pattern,
        "time_range": L.TIME_RANGE.pattern,
        "empty_gap_words": L.EMPTY_GAP_WORDS,
        "misfire_guard": L.MISFIRE_GUARD,
        "probe_by_family": L.PROBE_BY_FAMILY,
        "stability_probes": L.STABILITY_PROBES,
        "jd_dict": sorted(JD_DICT),
        "edu_rank": EDU_RANK,
        "rewrite_skeletons": RW.SKELETONS,
        "fallback_ask": RW.FALLBACK_ASK,
        "kb": kb_dump(),
        "demo": demo_dump(),
    }

    body = json.dumps(payload, ensure_ascii=False, indent=1)
    js = (
        "/* =========================================================\n"
        " * lexicon.data.js — 自动生成，不要手改\n"
        " * 来源：resume_engine/lexicon.py（唯一事实源）\n"
        " * 重新生成：python tools/extract-engine-data.py\n"
        " * ========================================================= */\n"
        "(function (global) {\n"
        '  "use strict";\n'
        "  var D = " + body + ";\n"
        "  global.RLData = D;\n"
        "})(typeof window !== \"undefined\" ? window : globalThis);\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(js, encoding="utf-8")
    print(f"写入 {OUT}  {OUT.stat().st_size} bytes")
    print(json.dumps(payload["meta"], ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())