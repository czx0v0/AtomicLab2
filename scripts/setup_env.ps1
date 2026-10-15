# ─────────────────────────────────────────────────────────────────────────────
# 一键创建/更新本地 conda 环境（modelspace）
# 用法：  powershell -File scripts/setup_env.ps1 [-EnvName modelspace]
# ─────────────────────────────────────────────────────────────────────────────
param(
    [string]$EnvName = "modelspace"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envYml = Join-Path $repoRoot "environment.yml"

Write-Host "==> 仓库根目录: $repoRoot" -ForegroundColor Cyan

# 1) 检查 conda
$conda = Get-Command conda -ErrorAction SilentlyContinue
if (-not $conda) {
    Write-Host "[ERROR] 未找到 conda。请先安装 Miniconda/Anaconda 并确保 conda 在 PATH 中。" -ForegroundColor Red
    exit 1
}
Write-Host "==> conda: $($conda.Source)" -ForegroundColor Cyan

# 2) 环境是否已存在
$existing = conda env list | Select-String -Pattern "^$EnvName\s" -Quiet
if ($existing) {
    Write-Host "==> 环境 '$EnvName' 已存在，执行更新 (conda env update --prune)..." -ForegroundColor Yellow
    conda env update -f $envYml --prune
} else {
    Write-Host "==> 创建环境 '$EnvName' (conda env create)..." -ForegroundColor Yellow
    conda env create -f $envYml
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] conda 环境创建/更新失败 (exit $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "================ 环境就绪 ================" -ForegroundColor Green
Write-Host "激活环境：      conda activate $EnvName" -ForegroundColor White
Write-Host ""
Write-Host "启动后端（默认 7860 端口）：" -ForegroundColor White
Write-Host "  conda activate $EnvName" -ForegroundColor Gray
Write-Host "  python app.py" -ForegroundColor Gray
Write-Host ""
Write-Host "跑评测（后端已在 localhost:7860 运行，且已配置 DEEPSEEK_API_KEY）：" -ForegroundColor White
Write-Host "  conda activate $EnvName" -ForegroundColor Gray
Write-Host "  python scripts/eval/run_evaluation.py --chat-url http://localhost:7860/api/chat --run-name b4_full --retrieval-mode full --report scripts/eval/eval_b4_full.csv --output-format jsonl" -ForegroundColor Gray
Write-Host ""
Write-Host "生成对比报告：" -ForegroundColor White
Write-Host "  python scripts/eval/compare_experiments.py --manifest scripts/eval/experiments_manifest.jsonl --out-md scripts/eval/comparison.md --out-csv scripts/eval/comparison.csv" -ForegroundColor Gray
Write-Host ""
Write-Host "详细评测指导见 scripts/eval/EVAL_GUIDE.md" -ForegroundColor Cyan
