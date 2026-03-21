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

- 默认仅 `status=ok` 视为已完成，会在后续运行中跳过。
- `status=failed` 默认**不算完成**，再次运行会重新尝试。

### 4.3 兼容旧语义（失败也跳过）

如果你希望“失败题也不再重试”，加：

```powershell
--count-failed-as-done
```

## 5. 从指定题号开始

例如从第 38 题开始：

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" --start-index 38
```

说明：

- `--start-index` 是 1-based（第 1 题是 1）。
- 会先按起始题号过滤，再应用“已完成题目跳过”规则。

## 6. 超时与重试参数（建议）

### 6.1 常用参数

- `--timeout`：兼容入口（默认连接/读取等超时基准）。
- `--connect-timeout`：连接超时。
- `--read-timeout`：读取超时（大模型慢响应时建议重点调大）。
- `--write-timeout`：写入超时。
- `--pool-timeout`：连接池超时。
- `--chat-retries`：问答请求重试次数。
- `--chat-retry-wait-max`：重试指数退避上限（秒）。
- `--fail-fast`：单题失败时立即终止（默认失败后继续下一题）。

### 6.2 稳健长跑示例

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

## 7. 使用不同报告文件做实验隔离

```powershell
python "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\run_evaluation.py" `
  --report "D:\Coding\agent\AtomicLab\modelspace-deploy\scripts\eval\evaluation_report_expA.csv"
```

建议每组参数用独立报告文件，便于对比。

## 8. 汇总统计说明

脚本末尾会输出 `Evaluation Summary`。为避免同一题多次记录影响平均分：

- 汇总按 `question` 去重；
- 同一题仅以**最后一行**记录参与统计。

这意味着：同一题先失败后成功，最终汇总会反映最后一次成功结果。

