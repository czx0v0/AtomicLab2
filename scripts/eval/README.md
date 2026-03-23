# 评测脚本运行说明

本文档说明如何使用 `run_evaluation.py` 进行稳定评测、断点续跑与失败重试。

## 1. 脚本位置

- 脚本：`D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py`
- 数据集：`D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\dataset.json`
- 默认报告：`D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\evaluation_report.csv`

## 2. 前置条件

- 本地后端接口可访问。评测脚本默认请求地址为 **`http://localhost:8000/api/chat`**（即本机 **8000** 端口上的 HTTP 服务；路径为 `/api/chat`）。
- **端口需与正在运行的服务一致**：
  - `run_evaluation.py` 用 `--chat-url` 指定完整地址；默认端口为 **8000**。
  - 若你用 `modelspace-deploy/app.py` 直接起服务，默认环境变量为 `UVICORN_PORT`（未设置时一般为 **7860**，见 `app.py`）。此时应二选一：
    - 启动服务时把端口改成 8000，例如设置环境变量 `UVICORN_PORT=8000`；或
    - 评测时显式指定端口，例如：`--chat-url http://localhost:7860/api/chat`（将 `7860` 换成你实际监听的端口）。
  - 若服务跑在远程或容器里，把 `localhost` 换成对应主机名，并确保防火墙/安全组放行该端口。
- 环境变量中有 `DEEPSEEK_API_KEY`（脚本会自动尝试加载：
  - `modelspace-deploy/.env`
  - 仓库根目录 `.env`）

## 3. 基础运行

在 `modelspace-deploy` 目录执行：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py"
```

仅跑前 10 题（快速验证）：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" --limit 10
```

## 4. 断点续跑与失败重试（当前默认行为）

### 4.1 自动续跑规则

- 脚本会读取 `--report` 指向的 CSV，按 `question` 判断是否跳过。
- 同一题若有多行记录，只看该题在报告中的**最后一行状态**。

### 4.2 哪些题会被当作“已完成”

- 报告里带 **`status` 列**（新版 CSV）时：默认仅 `status=ok` 视为已完成；`status=failed` 不算完成，会重试。
- **旧版 CSV 没有 `status` 列**时：无法读列，则根据 **`judge_reason` 是否以 `执行失败:` 开头** 推断为失败行；否则视为成功。这样早期因网络/后端超时写入的失败行，在旧表上也会被识别为未完成，下次运行会重新评测。
- 若某条成功记录的 `judge_reason` 恰好以 `执行失败:` 开头（极罕见），会被误判为失败并重跑。

### 4.3 表头与列数混用

若同一文件先按旧表头写入、后又用新脚本追加带 `status` 的列，可能出现**表头列数与数据行不一致**，`csv` 解析会错位。建议**新实验换一个新的 `--report` 文件名**，或手动统一表头后再跑。

### 4.4 兼容旧语义（失败也跳过）

如果你希望“失败题也不再重试”，加：

```powershell
--count-failed-as-done
```

## 5. JSON Lines 侧车输出（多行答案、结构化上下文）

- 加 `--output-format jsonl` 时：仍会写入 **`--report` 的 CSV**（断点续跑、已完成判定**只读 CSV**，逻辑不变），并**额外追加**一个 JSON Lines 文件（每行一个完整 JSON 对象）。
- 默认 JSONL 路径：与 CSV 同目录、同主文件名、扩展名 **`.jsonl`**。也可用 `--jsonl-report "路径"` 指定。
- JSON 对象中 `answer`、`judge_reason` 等为大模型多行文本时，为标准 JSON 字符串（换行会转义为 `\n`），无需像 CSV 那样担心引号/逗号字段规则；`retrieved_contexts` 为 **JSON 数组**（结构化对象列表），不是 CSV 里那种整段字符串。

示例：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" `
  --output-format jsonl `
  --report "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\evaluation_report.csv"
```

按行读取 JSONL（示例思路）：逐行 `json.loads`，每行一条评测记录。

## 6. 从指定题号开始

例如从第 38 题开始：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" --start-index 38
```

说明：

- `--start-index` 是 1-based（第 1 题是 1）。
- 会先按起始题号过滤，再应用“已完成题目跳过”规则。

## 7. 超时与重试参数（建议）

### 7.1 常用参数

- `--timeout`：兼容入口（默认连接/读取等超时基准）。
- `--connect-timeout`：连接超时。
- `--read-timeout`：读取超时（大模型慢响应时建议重点调大）。
- `--write-timeout`：写入超时。
- `--pool-timeout`：连接池超时。
- `--chat-retries`：问答请求重试次数。
- `--chat-retry-wait-max`：重试指数退避上限（秒）。
- `--fail-fast`：单题失败时立即终止（默认失败后继续下一题）。

### 7.2 稳健长跑示例

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" `
  --report "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\evaluation_report.csv" `
  --start-index 38 `
  --connect-timeout 10 `
  --read-timeout 180 `
  --write-timeout 30 `
  --pool-timeout 10 `
  --chat-retries 4 `
  --chat-retry-wait-max 20
```

## 8. 使用不同报告文件做实验隔离

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" `
  --report "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\evaluation_report_expA.csv"
```

建议每组参数用独立报告文件，便于对比。

## 9. 记录实验参数（baseline 对比）

评测脚本会额外写入 `experiments_manifest.jsonl`（默认与 `--report` 同目录），每次运行追加一条记录，包含：

- `run_id`、`run_name`（默认 `baseline`）
- `report_path`、`dataset_path`、`started_at`、`ended_at`
- 关键 RAG 参数（`top_k/max_rounds/chat_url/*timeout/chat_retries/...`）
- 运行统计（`ok/failed/skip_*`）

示例（将这次运行标注为 baseline）：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" `
  --run-name baseline `
  --report "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\evaluation_report.csv"
```

查看 manifest：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\experiment_manifest.py" `
  --manifest "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\experiments_manifest.jsonl"
```

## 10. 汇总统计说明

脚本末尾会输出 `Evaluation Summary`。为避免同一题多次记录影响平均分：

- 汇总按 `question` 去重；
- 同一题仅以**最后一行**记录参与统计。

这意味着：同一题先失败后成功，最终汇总会反映最后一次成功结果。

## 11. 量化指标与自动测试

### 11.1 生成量化指标（双口径）

`compute_metrics.py` 会计算：

- 裁判口径：`accuracy_cp_pct`、`faithfulness_avg_pct`、`success_rate_pct`
- 答案匹配口径：`em_pct`、`token_f1_pct`

按 `question` 去重（默认 `--dedupe latest`），支持输出 JSON + Markdown：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\compute_metrics.py" `
  --report "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\evaluation_report.csv" `
  --dedupe latest `
  --out-json "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\metrics.json" `
  --out-md "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\metrics_report.md"
```

也可从 manifest 按实验名定位 report：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\compute_metrics.py" `
  --manifest "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\experiments_manifest.jsonl" `
  --run-name baseline `
  --out-json "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\metrics_baseline.json"
```

### 11.2 自动阈值测试（pytest）

先生成指标 JSON，然后跑测试：

```powershell
$env:METRICS_JSON="D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\metrics.json"
$env:MIN_ACCURACY_CP_PCT="60"
$env:MIN_FAITHFULNESS_PCT="80"
$env:MIN_SUCCESS_RATE_PCT="90"
pytest "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\test_metrics_thresholds.py" -q
```

说明：`METRICS_JSON` 不设置时，阈值门禁测试会自动跳过，仅保留基础 smoke test。

