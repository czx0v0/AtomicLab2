from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from compute_metrics import compute_metrics


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    return float(raw)


def test_compute_metrics_smoke() -> None:
    rows = [
        {
            "type": "single-hop",
            "question": "q1",
            "answer": "答案A",
            "ground_truth": "答案A",
            "context_precision": 1,
            "faithfulness": 1.0,
            "status": "ok",
            "judge_reason": "",
        },
        {
            "type": "single-hop",
            "question": "q2",
            "answer": "错误答案",
            "ground_truth": "标准答案",
            "context_precision": 0,
            "faithfulness": 0.0,
            "status": "failed",
            "judge_reason": "执行失败: timeout",
        },
    ]
    m = compute_metrics(rows)
    assert m["overall"]["n"] == 2
    assert m["overall"]["accuracy_cp_pct"] == 50.0
    assert m["overall"]["success_rate_pct"] == 50.0


def test_metrics_thresholds_from_json() -> None:
    metrics_path_raw = os.getenv("METRICS_JSON", "").strip()
    if not metrics_path_raw:
        pytest.skip("未设置 METRICS_JSON，跳过真实阈值门禁测试。")
    metrics_path = Path(metrics_path_raw).resolve()
    if not metrics_path.exists():
        pytest.skip(f"METRICS_JSON 不存在: {metrics_path}")

    payload = json.loads(metrics_path.read_text(encoding="utf-8"))
    overall = payload["metrics"]["overall"]

    min_accuracy_cp = _env_float("MIN_ACCURACY_CP_PCT", 0.0)
    min_faithfulness = _env_float("MIN_FAITHFULNESS_PCT", 0.0)
    min_success_rate = _env_float("MIN_SUCCESS_RATE_PCT", 0.0)
    min_em = _env_float("MIN_EM_PCT", 0.0)
    min_token_f1 = _env_float("MIN_TOKEN_F1_PCT", 0.0)

    assert overall["accuracy_cp_pct"] >= min_accuracy_cp
    assert overall["faithfulness_avg_pct"] >= min_faithfulness
    assert overall["success_rate_pct"] >= min_success_rate
    assert overall["em_pct"] >= min_em
    assert overall["token_f1_pct"] >= min_token_f1

