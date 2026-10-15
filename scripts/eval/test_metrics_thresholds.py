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
            "correctness": 1.0,
            "context_precision": 1,
            "context_recall": 1.0,
            "retrieval_hit": 1,
            "faithfulness": 1.0,
            "hallucinated": 0,
            "citation_accuracy": 1.0,
            "status": "ok",
            "judge_reason": "",
        },
        {
            "type": "single-hop",
            "question": "q2",
            "answer": "错误答案",
            "ground_truth": "标准答案",
            "correctness": 0.0,
            "context_precision": 0,
            "context_recall": 0.0,
            "retrieval_hit": 0,
            "faithfulness": 0.0,
            "hallucinated": 1,
            "citation_accuracy": 0.0,
            "status": "failed",
            "judge_reason": "执行失败: timeout",
        },
    ]
    m = compute_metrics(rows)
    assert m["overall"]["n"] == 2
    assert m["overall"]["correctness_pct"] == 50.0
    assert m["overall"]["hit_at_k_pct"] == 50.0
    assert m["overall"]["context_precision_pct"] == 50.0
    assert m["overall"]["hallucination_rate_pct"] == 50.0
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

    min_correctness = _env_float("MIN_CORRECTNESS_PCT", 0.0)
    min_hit_at_k = _env_float("MIN_HIT_AT_K_PCT", 0.0)
    min_context_precision = _env_float("MIN_CONTEXT_PRECISION_PCT", 0.0)
    min_context_recall = _env_float("MIN_CONTEXT_RECALL_PCT", 0.0)
    min_faithfulness = _env_float("MIN_FAITHFULNESS_PCT", 0.0)
    max_hallucination = _env_float("MAX_HALLUCINATION_PCT", 100.0)
    min_success_rate = _env_float("MIN_SUCCESS_RATE_PCT", 0.0)
    min_rouge_l = _env_float("MIN_ROUGE_L_PCT", 0.0)

    assert overall["correctness_pct"] >= min_correctness
    assert overall["hit_at_k_pct"] >= min_hit_at_k
    assert overall["context_precision_pct"] >= min_context_precision
    assert overall["context_recall_pct"] >= min_context_recall
    assert overall["faithfulness_avg_pct"] >= min_faithfulness
    assert overall["hallucination_rate_pct"] <= max_hallucination
    assert overall["success_rate_pct"] >= min_success_rate
    assert overall["rouge_l_pct"] >= min_rouge_l

