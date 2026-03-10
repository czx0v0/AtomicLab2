# MinerU 模型存储配置指南

## ✅ 当前配置状态（已完成）

### 1. 模型存储位置

- **主目录**: `D:\models\MinerU`
  包含所有已迁移的模型权重（约 3GB）

### 2. magic-pdf.json 配置

```json
{
  "models-dir": "D:/models/MinerU",
  "layoutreader-model-dir": "D:/models/MinerU/ReadingOrder/layout_reader",
  "device-mode": "cpu"
}
```

**路径**: `C:\Users\yates\magic-pdf.json`

### 3. 系统环境变量（已设置）

```powershell
MODELSCOPE_CACHE=D:\models\.cache\modelscope
HF_HOME=D:\models\.cache\huggingface
```

**作用**: 让未来所有 ModelScope/HuggingFace 下载自动存储到 D 盘

---

## 📦 未来安装新模型的行为

### 方式一：使用 `mineru-models-download` 命令

```bash
# 会自动读取 MODELSCOPE_CACHE 环境变量
mineru-models-download

# 下载到：D:\models\.cache\modelscope\hub\models\...
# 然后仍需运行一次性迁移命令（见下方）
```

### 方式二：Python ModelScope SDK

```python
from modelscope import snapshot_download

# 会自动使用 MODELSCOPE_CACHE 环境变量
model_dir = snapshot_download('OpenDataLab/PDF-Extract-Kit')
# 直接下载到 D:\models\.cache\modelscope\...
```

### ⚠️ 重要提示

无论哪种方式，如果新模型下载到 ModelScope 缓存目录，你需要一次性迁移到 MinerU 工作目录：

```powershell
# 找到新下载的模型（示例路径）
$src = "D:\models\.cache\modelscope\hub\models\OpenDataLab\新模型包名\models"
$dst = "D:\models\MinerU"

# 合并到现有目录
robocopy $src $dst /E /R:1 /W:1

# 验证关键文件路径是否正确
magic-pdf --help  # 检查配置无误
```

```
全量复制模型目录到 D 盘
$src='C:\Users\yates.cache\modelscope\hub\models\OpenDataLab\PDF-Extract-Kit-1___0\models'
$dst='D:\models\MinerU'
New-Item -ItemType Directory -Path $dst -Force | Out-Null
robocopy $src $dst /E /R:1 /W:1

修正 OCR 兼容文件名（你这版 magic-pdf 需要）
$ocr='D:\models\MinerU\OCR\paddleocr_torch'
if(!(Test-Path "$ocr\ch_PP-OCRv3_det_infer.pth") -and (Test-Path "$ocr\Multilingual_PP-OCRv3_det_infer.pth")){
Copy-Item "$ocr\Multilingual_PP-OCRv3_det_infer.pth" "$ocr\ch_PP-OCRv3_det_infer.pth" -Force
}

配置文件关键项保持为

models-dir = D:/models/MinerU
layoutreader-model-dir = D:/models/MinerU/ReadingOrder/layout_reader
验证命令
magic-pdf.exe -p test.pdf -o D:\Coding\agent\AtomicLab\file\output_layout_test4 -m auto
```

---

## 🌐 其他平台配置兼容性

### 与其他工具的共存

| 工具/平台                          | 配置方式                           | 与 MinerU 冲突？        |
| ---------------------------------- | ---------------------------------- | ----------------------- |
| **ModelScope CLI**           | 读取 `MODELSCOPE_CACHE` 环境变量 | ✅ 无冲突               |
| **HuggingFace Transformers** | 读取 `HF_HOME` 环境变量          | ✅ 无冲突               |
| **MinerU magic-pdf**         | 读取 `magic-pdf.json` 配置文件   | ✅ 无冲突（优先级最高） |
| **Docker 容器**              | 需在 Dockerfile 中设置 ENV         | ⚠️ 需单独配置         |

### 优先级规则

```
magic-pdf.json 配置 > 环境变量 > 默认路径(C:\Users\...\cache)
```

### 示例：在其他项目使用 ModelScope

```python
# 你的其他 Python 项目自动使用 D 盘缓存
from modelscope import snapshot_download

# 无需额外配置，自动使用 D:\models\.cache\modelscope
model = snapshot_download('damo/nlp_structbert_...')
```

---

## 🔧 故障排查

### 问题 1：新下载的模型 MinerU 找不到

**原因**: ModelScope 下载到缓存，但 `magic-pdf.json` 指向 `D:\models\MinerU`
**解决**: 运行上方迁移命令，或直接修改 `magic-pdf.json` 的 `models-dir`

### 问题 2：环境变量不生效

**排查**:

```powershell
# 检查当前会话
$env:MODELSCOPE_CACHE  # 应显示 D:\models\.cache\modelscope

# 如果为空，重启 PowerShell 或运行：
[System.Environment]::GetEnvironmentVariable('MODELSCOPE_CACHE', 'User')
```

### 问题 3：C 盘空间仍然不足

**检查其他缓存**:

```powershell
# HuggingFace 缓存
Get-ChildItem C:\Users\yates\.cache\huggingface -Recurse | Measure-Object -Property Length -Sum

# pip 缓存
pip cache purge
```

---

## 📝 配置验证清单

运行以下命令确认一切正常：

```powershell
# 1. 确认环境变量
$env:MODELSCOPE_CACHE
$env:HF_HOME

# 2. 确认 D 盘模型存在
Test-Path D:\models\MinerU\Layout\YOLO\doclayout_yolo_docstructbench_imgsz1280_2501.pt

# 3. 确认 MinerU 配置
magic-pdf -p test.pdf -o output -m auto  # 应该正常运行无缺模型报错
```

---

## 🚀 推荐工作流

### 日常使用（不需要迁移）

```bash
# 直接调用 MinerU
magic-pdf -p 文档.pdf -o 输出目录 -m auto
# 使用当前 D:\models\MinerU 下的模型
```

### 需要新模型时

1. 确认模型名称（如 `OpenDataLab/新功能模型`）
2. 下载到 D 盘缓存（自动使用环境变量）
3. 一次性迁移到 `D:\models\MinerU`
4. 更新 `magic-pdf.json`（如果路径结构变化）

### 与团队共享配置

直接分享 `D:\models\MinerU` 整个目录 + `magic-pdf.json` 文件即可

---

**最后更新**: 2026-03-10
**配置版本**: MinerU v0.x with ModelScope integration
