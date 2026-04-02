"""
PDF 解析服务
============
优先使用 MinerU 云 API（设置 MINERU_API_TOKEN 环境变量即可），
回退到本地 CLI（mineru / magic-pdf）。

MinerU 云 API 工作流（本地文件上传）：
  1. POST /api/v4/extract/task/batch  → 获取 presigned upload URL + task_id
  2. PUT  上传 PDF 字节到 presigned URL
  3. 轮询 GET /api/v4/extract/task/{task_id} 直到 state=done
  4. 下载 full_zip_url 中的 zip，解压提取 full.md

章节摘要模式（环境变量 SECTION_SUMMARY_MODE 或解析 API Query section_summary_mode）：
  first_paragraph — 默认，首节文本，无额外 LLM 调用
  llm — 每章 chunk 后再发 summary 事件，用 DEEPSEEK_API_KEY 生成短摘要（失败则保持首段）

文档：https://mineru.net/doc/docs/
"""

import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
import asyncio
from pathlib import Path
from urllib.parse import quote
from typing import AsyncGenerator, Optional

import httpx

logger = logging.getLogger("uvicorn.error")

# ══════════════════════════════════════════════════════════════
# 图片持久化：将解析结果中的图片保存到 data/parse_images/{stem}/
# ══════════════════════════════════════════════════════════════
_PARSE_IMAGES_DIR = Path(__file__).parent.parent / "data" / "parse_images"
_PARSE_IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def _persist_and_rewrite_images(parsed_content: str, stem: str, img_sources) -> str:
    """
    持久化图片并改写 Markdown 中的图片 URL。
    img_sources: Path（本地 CLI 的 images 目录）或 dict（云 API 的 {name: bytes}）
    """
    persist_dir = _PARSE_IMAGES_DIR / stem
    persist_dir.mkdir(parents=True, exist_ok=True)

    # 复制或写入图片文件
    if isinstance(img_sources, Path):
        # 本地 CLI 路径：从 images 目录复制
        if img_sources.exists():
            for img_file in img_sources.iterdir():
                if img_file.is_file():
                    shutil.copy2(img_file, persist_dir / img_file.name)
    elif isinstance(img_sources, dict):
        # 云 API 路径：从 zip 中提取的 bytes 写入
        for name, data in img_sources.items():
            (persist_dir / name).write_bytes(data)

    # 改写 Markdown 中的图片 URL
    def _rewrite(m: re.Match) -> str:
        alt, orig = m.group(1), m.group(2)
        # 跳过已经是绝对路径或网络 URL 的图片
        if orig.startswith(("http://", "https://", "/")):
            return m.group(0)
        img_name = Path(orig).name
        # 对路径分段做编码，避免中文/空格文件名导致图片 URL 失效
        safe_stem = quote(stem, safe="")
        safe_name = quote(img_name, safe="")
        return f"![{alt}](/api/parse-images/{safe_stem}/{safe_name})"

    return re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", _rewrite, parsed_content)


# ══════════════════════════════════════════════════════════════
# MinerU 云 API 配置
# ══════════════════════════════════════════════════════════════
MINERU_API_BASE = "https://mineru.net/api/v4"


def _get_mineru_api_token() -> str:
    """运行时读取 token，避免受模块导入时机影响。"""
    return (os.environ.get("MINERU_API_TOKEN") or os.environ.get("MINERU_API_KEY", "")).strip()


# ══════════════════════════════════════════════════════════════
# 本地 CLI 回退（未设置 token 时使用）
# ══════════════════════════════════════════════════════════════
def _find_mineru_bin() -> Optional[str]:
    """查找 mineru/magic-pdf 可执行文件"""
    candidates = [
        shutil.which("mineru"),
        shutil.which("mineru.exe"),
        shutil.which("magic-pdf"),
        shutil.which("magic-pdf.exe"),
    ]
    py_dir = Path(sys.executable).resolve().parent
    candidates.extend(
        [
            str(py_dir / "bin" / "mineru"),
            str(py_dir / "Scripts" / "mineru.exe"),
            str(py_dir / "Scripts" / "mineru"),
            str(py_dir / "Scripts" / "magic-pdf.exe"),
            str(py_dir / "Scripts" / "magic-pdf"),
            r"D:\anaconda\envs\py-agent\Scripts\magic-pdf.exe",
        ]
    )
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


_MAGIC_PDF_BIN = _find_mineru_bin()
_SUBPROCESS_ENV = {
    **os.environ,
    "MINERU_MODEL_SOURCE": os.environ.get("MINERU_MODEL_SOURCE", "modelscope"),
}
_PARSE_TIMEOUT = int(os.environ.get("MINERU_PARSE_TIMEOUT", "300"))

if _get_mineru_api_token():
    logger.info("[MinerU] 使用云 API 模式")
else:
    logger.info(f"[MinerU] 使用本地 CLI 模式，路径: {_MAGIC_PDF_BIN or 'NOT FOUND'}")


# ══════════════════════════════════════════════════════════════
# 公共工具
# ══════════════════════════════════════════════════════════════
_SECTION_SUMMARY_MAX_CHARS = 8000


def _first_text_paragraph_summary(section_body: str) -> str:
    """
    取章节首节可见文字摘要：跳过段首空行与图片行，自第一条正文起收集至第一个空行；
    若正文中再遇图片行则结束（摘要仅保留连续文本块）。总长上限 _SECTION_SUMMARY_MAX_CHARS。
    """
    lines = section_body.splitlines()
    buf: list[str] = []
    started = False
    for line in lines:
        clean = line.strip()
        if not clean:
            if started:
                break
            continue
        if clean.startswith("!"):
            if started:
                break
            continue
        started = True
        buf.append(clean)
    text = "\n".join(buf).strip()
    if len(text) <= _SECTION_SUMMARY_MAX_CHARS:
        return text
    cut = text[: _SECTION_SUMMARY_MAX_CHARS]
    tail = cut[-200:]
    sp = tail.rfind(" ")
    if sp > 0:
        cut = cut[: len(cut) - len(tail) + sp].rstrip()
    return cut


def _split_sections(md: str) -> list:
    """将 Markdown 拆分为章节列表"""
    sections = []
    title = "Preamble"
    buf = []

    def flush():
        if not buf:
            return
        text = "\n".join(buf).strip()
        if not text:
            return
        summary = _first_text_paragraph_summary(text)
        image_refs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", text)
        sections.append(
            {
                "title": title,
                "content": text,
                "summary": summary,
                "image_refs": image_refs,
            }
        )

    for line in md.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush()
            title = m.group(2).strip() or "Untitled"
            buf = []
        else:
            buf.append(line)
    flush()
    return sections


def _make_event(status: str, msg: str = "", markdown: str = "", **extra) -> str:
    payload = {"status": status}
    if msg:
        payload["message"] = msg
    if markdown:
        payload["markdown"] = markdown
    for k, v in extra.items():
        if v is not None and v != "":
            payload[k] = v
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _resolved_section_summary_mode(explicit: Optional[str]) -> str:
    """单次请求 Query 优先，否则环境变量 SECTION_SUMMARY_MODE，默认 first_paragraph。"""
    raw = (explicit or os.environ.get("SECTION_SUMMARY_MODE", "first_paragraph") or "").strip().lower()
    return "llm" if raw == "llm" else "first_paragraph"


def _llm_enhance_summary(title: str, content: str, fallback: str) -> str:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return fallback
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, base_url=api_base)
        resp = client.chat.completions.create(
            model=os.getenv("DEEPSEEK_CHAT_MODEL", "deepseek-chat"),
            messages=[
                {
                    "role": "system",
                    "content": "你是学术文献摘要助手，请输出一句简洁中文摘要（不超过70字）。",
                },
                {
                    "role": "user",
                    "content": f"章节标题: {title}\n\n章节内容:\n{content[:1200]}",
                },
            ],
            max_tokens=120,
            temperature=0.2,
        )
        ans = (resp.choices[0].message.content or "").strip()
        return ans or fallback
    except Exception as e:
        logger.warning("[parser] LLM 章节摘要失败，使用首段 fallback: %s", e)
        return fallback


async def _yield_chunks_and_summaries(
    sections: list,
    section_summary_mode: str,
) -> AsyncGenerator[str, None]:
    """先为每章发 chunk；若 mode 为 llm 再发 summary 事件覆盖摘要。"""
    n = len(sections)
    for idx, sec in enumerate(sections):
        yield _make_event(
            "chunk",
            msg=f"分段 {idx + 1}/{n}: {sec['title']}",
            markdown_chunk=sec["content"],
            section_title=sec["title"],
            section_summary=sec["summary"],
            image_refs=sec.get("image_refs", []),
        )
        if section_summary_mode != "llm":
            continue
        enhanced = await asyncio.to_thread(
            _llm_enhance_summary,
            sec["title"],
            sec["content"],
            sec["summary"],
        )
        yield _make_event(
            "summary",
            msg=f"章节摘要: {sec['title']}",
            section_title=sec["title"],
            section_summary=enhanced,
        )


# ══════════════════════════════════════════════════════════════
# MinerU 云 API 解析
# ══════════════════════════════════════════════════════════════
async def _parse_via_cloud_api(
    file_content: bytes,
    filename: str,
    method: str = "auto",
    section_summary_mode: str = "first_paragraph",
) -> AsyncGenerator[str, None]:
    """通过 MinerU 云 API 解析 PDF，流式 yield SSE 事件"""
    token = _get_mineru_api_token()
    if not token:
        yield _make_event("error", "未配置 MINERU_API_TOKEN 或 MINERU_API_KEY 环境变量")
        return

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }

    yield _make_event("starting", f"正在提交到 MinerU 云 API: {filename}...")

    # ── Step 1: 申请批量上传链接 ──────────────────────────────
    batch_url = f"{MINERU_API_BASE}/file-urls/batch"
    is_ocr = method == "ocr"
    batch_payload = {
        "files": [
            {
                "name": filename,
                "is_ocr": is_ocr,
                "data_id": filename,
                "enable_formula": True,
                "enable_table": True,
            }
        ]
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(batch_url, headers=headers, json=batch_payload)
            result = resp.json()
            logger.info("[MinerU] batch API 响应: %s", result)
    except Exception as e:
        yield _make_event("error", f"申请上传链接失败: {e}")
        return

    if result.get("code") != 0:
        error_msg = result.get("msg", "未知错误")
        logger.warning(
            "[MinerU] batch API 错误：code=%s, msg=%s", result.get("code"), error_msg
        )
        yield _make_event("error", f"申请上传链接失败：{error_msg}")
        return

    file_items = result.get("data", {}).get("files", [])

    # 兼容两种 API 响应格式：旧版返回 files，新版返回 file_urls
    upload_url = None
    batch_id = None

    if not file_items:
        file_urls = result.get("data", {}).get("file_urls", [])
        if file_urls:
            upload_url = file_urls[0]
            batch_id = result.get("data", {}).get("batch_id")
            logger.info("[MinerU] 使用新版 API 格式，file_urls: %d", len(file_urls))
        else:
            logger.warning("[MinerU] batch API 未返回 files 或 file_urls: %s", result)
            yield _make_event("error", f"API 未返回上传链接，响应：{result}")
            return
    else:
        upload_url = file_items[0].get("url")
        batch_id = result.get("data", {}).get("batch_id") or file_items[0].get(
            "batch_id"
        )
        logger.info("[MinerU] 使用旧版 API 格式，files: %d", len(file_items))

    if not upload_url:
        yield _make_event("error", "API 未返回 presigned 上传 URL")
        return

    yield _make_event(
        "progress", f"已获取上传链接，正在上传 {len(file_content)/1024:.1f} KB..."
    )

    # ── Step 2: PUT 上传文件 ──────────────────────────────────
    # 官方文档明确要求：上传文件时无须设置 Content-Type，否则 OSS 预签名校验会 SignatureDoesNotMatch
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            put_resp = await client.put(upload_url, content=file_content)
        if put_resp.status_code not in (200, 204):
            try:
                err_body = (put_resp.text or "")[:500]
            except Exception:
                err_body = "<no body>"
            logger.error(
                "[MinerU] 上传到 OSS 失败: status=%s, body=%s",
                put_resp.status_code,
                err_body,
            )
            yield _make_event(
                "error",
                f"上传文件失败 (HTTP {put_resp.status_code})。创空间环境常见为 OSS 策略限制，详情见日志: {err_body}",
            )
            return
    except Exception as e:
        yield _make_event("error", f"上传文件失败: {e}")
        return

    yield _make_event("progress", "文件上传成功，等待解析...")

    # ── Step 3: 轮询任务状态 ──────────────────────────────────
    # 批量上传后系统自动创建任务，通过 batch_id 查询
    poll_url = f"{MINERU_API_BASE}/extract-results/batch/{batch_id}"
    poll_headers = {"Authorization": f"Bearer {token}"}

    max_wait = 600  # 最多等待 10 分钟
    poll_interval = 5
    elapsed = 0
    task_id = None

    while elapsed < max_wait:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                poll_resp = await client.get(poll_url, headers=poll_headers)
                poll_data = poll_resp.json()
        except Exception as e:
            yield _make_event("progress", f"查询状态失败 ({elapsed}s): {e}")
            continue

        if poll_data.get("code") != 0:
            yield _make_event("error", f"查询失败: {poll_data.get('msg')}")
            return

        extract_list = poll_data.get("data", {}).get("extract_result", [])
        if not extract_list:
            yield _make_event("progress", f"等待解析... ({elapsed}s)")
            continue

        item = extract_list[0]
        state = item.get("state", "pending")
        progress = item.get("extract_progress", {})
        task_id = item.get("task_id")

        if state == "running":
            pages_done = progress.get("extracted_pages", 0)
            total_pages = progress.get("total_pages", "?")
            yield _make_event(
                "progress", f"解析中: {pages_done}/{total_pages} 页 ({elapsed}s)"
            )
        elif state in ("pending", "converting"):
            yield _make_event("progress", f"排队中... ({elapsed}s)")
        elif state == "done":
            full_zip_url = item.get("full_zip_url")
            if not full_zip_url:
                yield _make_event("error", "解析完成但未返回结果 URL")
                return
            yield _make_event("progress", "解析完成，正在下载结果...")

            # ── Step 4: 下载 zip，提取 full.md ────────────────
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    zip_resp = await client.get(full_zip_url)
                zip_bytes = zip_resp.content
            except Exception as e:
                yield _make_event("error", f"下载结果失败: {e}")
                return

            try:
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    md_files = [n for n in zf.namelist() if n.endswith(".md")]
                    if not md_files:
                        yield _make_event("error", "结果 zip 中未找到 .md 文件")
                        return
                    # 优先选 full.md
                    target = next((n for n in md_files if "full" in n), md_files[0])
                    parsed_content = zf.read(target).decode("utf-8", errors="replace")

                    # 提取图片文件
                    img_data = {
                        Path(n).name: zf.read(n)
                        for n in zf.namelist()
                        if n.lower().endswith(
                            (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg")
                        )
                    }
            except Exception as e:
                yield _make_event("error", f"解压结果失败: {e}")
                return

            # 持久化图片并改写 URL
            stem = Path(filename).stem
            parsed_content = _persist_and_rewrite_images(parsed_content, stem, img_data)

            # 流式输出章节（可选 LLM 摘要）
            sections = _split_sections(parsed_content)
            async for ev in _yield_chunks_and_summaries(sections, section_summary_mode):
                yield ev

            yield _make_event("success", markdown=parsed_content)
            return

        elif state == "failed":
            err = item.get("err_msg", "未知错误")
            yield _make_event("error", f"MinerU 解析失败: {err}")
            return

    yield _make_event("error", f"解析超时（已等待 {max_wait}s）")


# ══════════════════════════════════════════════════════════════
# 本地 CLI 解析（回退）
# ══════════════════════════════════════════════════════════════
async def _parse_via_local_cli(
    file_content: bytes,
    filename: str,
    method: str = "auto",
    section_summary_mode: str = "first_paragraph",
) -> AsyncGenerator[str, None]:
    """调用本地 mineru/magic-pdf CLI 解析"""
    if not _MAGIC_PDF_BIN:
        yield _make_event(
            "error",
            "MinerU 未安装且未配置 MINERU_API_TOKEN。\n"
            "请在创空间环境变量中设置 MINERU_API_TOKEN。",
        )
        return

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)
        pdf_path = temp_dir_path / filename
        output_dir = temp_dir_path / "output"
        output_dir.mkdir()
        pdf_path.write_bytes(file_content)

        cmd = [_MAGIC_PDF_BIN, "-p", str(pdf_path), "-o", str(output_dir), "-m", method]
        logger.info(f"[MinerU CLI] 执行: {' '.join(cmd)}")
        yield _make_event("starting", f"本地 MinerU CLI 解析: {filename}...")

        try:

            def _run() -> tuple[list[str], int]:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    errors="replace",
                    env=_SUBPROCESS_ENV,
                )
                lines: list[str] = []
                for line in proc.stdout:
                    s = line.strip()
                    if s:
                        lines.append(s)
                        if any(
                            k in s.lower() for k in ["error", "fail", "model", "load"]
                        ):
                            logger.info(f"[MinerU CLI] {s}")
                proc.wait()
                logger.info(f"[MinerU CLI] 退出码: {proc.returncode}")
                return lines, proc.returncode

            log_lines, returncode = await asyncio.wait_for(
                asyncio.to_thread(_run), timeout=_PARSE_TIMEOUT
            )

            for line in log_lines:
                yield _make_event("progress", line)

            if returncode != 0:
                ctx = "\n".join(log_lines[-10:]) if log_lines else "无输出"
                logger.error(f"[MinerU CLI] 失败 (exit {returncode})")
                yield _make_event(
                    "error",
                    f"CLI 解析失败 (exit {returncode})。\n"
                    f"可能原因：模型未下载 / PDF 格式不支持 / 内存不足\n"
                    f"详情: {ctx[-200:]}",
                )
                return

        except asyncio.TimeoutError:
            yield _make_event("error", f"解析超时（{_PARSE_TIMEOUT}s）")
            return
        except FileNotFoundError:
            yield _make_event("error", f"找不到可执行文件: {_MAGIC_PDF_BIN}")
            return
        except Exception as e:
            yield _make_event("error", f"意外错误: {e}")
            return

        md_files = list(output_dir.rglob("*.md"))
        if not md_files:
            yield _make_event("error", "CLI 未生成 Markdown 文件")
            return

        target_md = max(md_files, key=lambda p: p.stat().st_size)
        parsed_content = target_md.read_text(encoding="utf-8", errors="replace")

        # 持久化图片并改写 URL
        stem = Path(filename).stem
        src_img_dir = target_md.parent / "images"
        parsed_content = _persist_and_rewrite_images(parsed_content, stem, src_img_dir)

        sections = _split_sections(parsed_content)
        async for ev in _yield_chunks_and_summaries(sections, section_summary_mode):
            yield ev

        yield _make_event("success", markdown=parsed_content)


# ══════════════════════════════════════════════════════════════
# 统一入口
# ══════════════════════════════════════════════════════════════
async def parse_pdf_with_mineru(
    file_content: bytes,
    filename: str,
    method: str = "auto",
    section_summary_mode: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    解析 PDF，优先云 API，回退本地 CLI。
    section_summary_mode: 显式传入覆盖环境变量；见 _resolved_section_summary_mode。
    """
    if method not in ("auto", "txt", "ocr"):
        method = "auto"

    mode = _resolved_section_summary_mode(section_summary_mode)

    if _get_mineru_api_token():
        async for event in _parse_via_cloud_api(
            file_content, filename, method, mode
        ):
            yield event
    else:
        async for event in _parse_via_local_cli(
            file_content, filename, method, mode
        ):
            yield event
