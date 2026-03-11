import json
import logging
import os
import shutil
import subprocess
import tempfile
import asyncio
import re
import sys
from typing import AsyncGenerator, Optional
from pathlib import Path

logger = logging.getLogger("uvicorn.error")


# ══════════════════════════════════════════════════════════════
# MinerU CLI 查找：兼容未加入 PATH 的 conda/venv 环境
# ══════════════════════════════════════════════════════════════
def _find_mineru_bin() -> Optional[str]:
    """查找 mineru/magic-pdf 可执行文件，兼容未加入 PATH 的 conda 环境"""
    candidates = [
        # 新版 mineru 命令
        shutil.which("mineru"),
        shutil.which("mineru.exe"),
        # 旧版 magic-pdf 命令
        shutil.which("magic-pdf"),
        shutil.which("magic-pdf.exe"),
    ]

    py_dir = Path(sys.executable).resolve().parent
    candidates.extend(
        [
            # 新版
            str(py_dir / "Scripts" / "mineru.exe"),
            str(py_dir / "Scripts" / "mineru"),
            str(py_dir / "mineru"),
            str(py_dir / "mineru.exe"),
            # Linux bin
            str(py_dir / "bin" / "mineru"),
            # 旧版
            str(py_dir / "Scripts" / "magic-pdf.exe"),
            str(py_dir / "Scripts" / "magic-pdf"),
            str(py_dir / "magic-pdf"),
            str(py_dir / "magic-pdf.exe"),
            # 本地开发回退
            r"D:\anaconda\envs\py-agent\Scripts\magic-pdf.exe",
        ]
    )

    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


_MAGIC_PDF_BIN = _find_mineru_bin()

# 创空间环境：强制使用 ModelScope 模型源（无法访问 HuggingFace）
_SUBPROCESS_ENV = {
    **os.environ,
    "MINERU_MODEL_SOURCE": os.environ.get("MINERU_MODEL_SOURCE", "modelscope"),
}

# Timeout in seconds for a single PDF parse (default 5 minutes).
_PARSE_TIMEOUT = 300

logger.info(f"[MinerU] CLI 路径: {_MAGIC_PDF_BIN or 'NOT FOUND'}")


async def parse_pdf_with_mineru(
    file_content: bytes, filename: str, method: str = "auto"
) -> AsyncGenerator[str, None]:
    """
    Invokes the local MinerU CLI (magic-pdf) via subprocess to parse a PDF.
    Yields Server-Sent Events (SSE) strings with progressive logs, and finally the Markdown result.
    """
    if method not in ("auto", "txt", "ocr"):
        method = "auto"

    def make_event(status: str, msg: str = "", markdown: str = "", **extra) -> str:
        payload = {"status": status}
        if msg:
            payload["message"] = msg
        if markdown:
            payload["markdown"] = markdown
        for k, v in extra.items():
            if v is not None and v != "":
                payload[k] = v
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    def split_sections(md: str):
        sections = []
        title = "Preamble"
        buf = []

        def flush():
            if not buf:
                return
            text = "\n".join(buf).strip()
            if not text:
                return
            # 取首个非空自然段作为摘要
            summary = ""
            for line in text.splitlines():
                clean = line.strip()
                if not clean:
                    continue
                if clean.startswith("!"):
                    continue
                summary = clean[:160]
                break
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

    def llm_enhance_summary(title: str, content: str, fallback: str) -> str:
        # 创空间环境不启用 LLM 增强（避免额外耗时）
        if os.path.exists("/mnt/workspace"):
            return fallback
        api_key = os.getenv("DEEPSEEK_API_KEY")
        api_base = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
        if not api_key:
            return fallback
        try:
            from openai import OpenAI

            client = OpenAI(api_key=api_key, base_url=api_base)
            resp = client.chat.completions.create(
                model="deepseek-chat",
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
        except Exception:
            return fallback

    # Create an isolated temporary directory for the process
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)

        # Determine paths
        pdf_path = temp_dir_path / filename
        output_dir = temp_dir_path / "output"
        output_dir.mkdir()

        # Save uploaded PDF to disk
        pdf_path.write_bytes(file_content)

        cmd = [_MAGIC_PDF_BIN, "-p", str(pdf_path), "-o", str(output_dir), "-m", method]

        logger.info(f"Starting MinerU parsing for {filename} (method={method}) ...")
        yield make_event("starting", f"MinerU process initialized for {filename}...")

        try:
            # Use subprocess.Popen in a thread to stream output line-by-line.
            # (asyncio.create_subprocess_exec raises NotImplementedError on Windows Python 3.10)
            def _run_and_collect() -> tuple[list[str], int]:
                logger.info(f"[MinerU] 执行命令: {' '.join(cmd)}")
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
                    stripped = line.strip()
                    if stripped:
                        lines.append(stripped)
                        # 实时打印关键日志
                        if any(
                            kw in stripped.lower()
                            for kw in ["error", "fail", "model", "download", "load"]
                        ):
                            logger.info(f"[MinerU] {stripped}")
                proc.wait()
                logger.info(f"[MinerU] 进程退出码: {proc.returncode}")
                return lines, proc.returncode

            log_lines, returncode = await asyncio.wait_for(
                asyncio.to_thread(_run_and_collect),
                timeout=_PARSE_TIMEOUT,
            )

            # Yield all captured progress lines
            for log_line in log_lines:
                yield make_event("progress", log_line)

            if returncode != 0:
                # 提取最后几行日志用于错误提示
                error_context = "\n".join(log_lines[-10:]) if log_lines else "No output"
                logger.error(f"[MinerU] 解析失败 (exit {returncode})")
                logger.error(f"[MinerU] 最后日志:\n{error_context}")
                yield make_event(
                    "error",
                    f"PDF 解析失败 (exit code {returncode})。\n"
                    f"可能原因：1) MinerU 模型未下载 2) PDF 格式不支持 3) 内存不足\n"
                    f"详情: {error_context[-200:]}",
                )
                return

        except asyncio.TimeoutError:
            logger.error(f"MinerU timed out after {_PARSE_TIMEOUT}s for {filename}.")
            yield make_event("error", f"Parsing timed out after {_PARSE_TIMEOUT}s.")
            return
        except FileNotFoundError:
            logger.error(f"[MinerU] 可执行文件未找到: {_MAGIC_PDF_BIN}")
            yield make_event(
                "error",
                "MinerU 未安装或 'mineru/magic-pdf' 不在 PATH 中。\n"
                "请检查服务器日志确认 MinerU 安装状态。",
            )
            return
        except Exception as e:
            logger.exception("Unexpected error during parsing.")
            yield make_event("error", f"Unexpected error: {str(e)}")
            return

        # MinerU usually outputs nested directories inside the output_dir. Find the primary generated .md file
        md_files = list(output_dir.rglob("*.md"))
        if not md_files:
            logger.error(f"No valid Markdown generated for {filename}.")
            yield make_event(
                "error", "Execution completed, but no Markdown output was found."
            )
            return

        # Read the first generated Markdown file as the main document
        target_md_file = md_files[0]
        parsed_content = target_md_file.read_text(encoding="utf-8", errors="replace")

        logger.info(
            f"Successfully parsed {filename} to Markdown ({len(parsed_content)} chars)."
        )

        # 增加分段流式事件：章节文本 + 自动摘要，便于前端构建章节树。
        sections = split_sections(parsed_content)
        for idx, sec in enumerate(sections):
            yield make_event(
                "chunk",
                msg=f"分段 {idx + 1}/{len(sections)}: {sec['title']}",
                markdown_chunk=sec["content"],
                section_title=sec["title"],
                section_summary=sec["summary"],
                image_refs=sec.get("image_refs", []),
            )
            # 使用 LLM 做增强摘要并流式更新。
            enhanced = await asyncio.to_thread(
                llm_enhance_summary,
                sec["title"],
                sec["content"],
                sec["summary"],
            )
            yield make_event(
                "summary",
                msg=f"章节摘要增强: {sec['title']}",
                section_title=sec["title"],
                section_summary=enhanced,
            )

        yield make_event("success", markdown=parsed_content)
