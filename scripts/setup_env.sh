#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 一键创建/更新本地 conda 环境（modelspace）—— Linux / macOS
# 用法：  bash scripts/setup_env.sh [env_name]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_NAME="${1:-modelspace}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_YML="$REPO_ROOT/environment.yml"

echo "==> 仓库根目录: $REPO_ROOT"

if ! command -v conda >/dev/null 2>&1; then
    echo "[ERROR] 未找到 conda。请先安装 Miniconda/Anaconda 并确保 conda 在 PATH 中。" >&2
    exit 1
fi
echo "==> conda: $(command -v conda)"

if conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
    echo "==> 环境 '$ENV_NAME' 已存在，执行更新 (conda env update --prune)..."
    conda env update -f "$ENV_YML" --prune
else
    echo "==> 创建环境 '$ENV_NAME' (conda env create)..."
    conda env create -f "$ENV_YML"
fi

cat <<'EOF'

================ 环境就绪 ================
激活环境：      conda activate ${ENV_NAME}

启动后端（默认 7860 端口）：
  conda activate ${ENV_NAME}
  python app.py

跑评测（后端已在 localhost:7860 运行，且已配置 DEEPSEEK_API_KEY）：
  conda activate ${ENV_NAME}
  python scripts/eval/run_evaluation.py --chat-url http://localhost:7860/api/chat \
    --run-name b4_full --retrieval-mode full \
    --report scripts/eval/eval_b4_full.csv --output-format jsonl

生成对比报告：
  python scripts/eval/compare_experiments.py \
    --manifest scripts/eval/experiments_manifest.jsonl \
    --out-md scripts/eval/comparison.md --out-csv scripts/eval/comparison.csv

详细评测指导见 scripts/eval/EVAL_GUIDE.md
EOF
