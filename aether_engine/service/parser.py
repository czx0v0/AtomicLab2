import json
import logging
import os
import shutil
import subprocess
import tempfile
import asyncio
import re
from typing import AsyncGenerator
from pathlib import Path

logger = logging.getLogger("uvicorn.error")

# Resolve MinerU CLI: mineru (v2.0+) preferred, fallback to magic-pdf (legacy).
_MAGIC_PDF_BIN = (
    shutil.which("mineru")
    or shutil.which("magic-pdf")
    or r"D:\anaconda\envs\py-agent\Scripts\magic-pdf.exe"
)

# 创空间环境：强制使用 ModelScope 模型源（无法访问 HuggingFace）
_SUBPROCESS_ENV = {
    **os.environ,
    "MINERU_MODEL_SOURCE": os.environ.get("MINERU_MODEL_SOURCE", "modelscope"),
}

# Timeout in seconds for a single PDF parse (default 5 minutes).
_PARSE_TIMEOUT = 300


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
                proc.wait()
                return lines, proc.returncode

            log_lines, returncode = await asyncio.wait_for(
                asyncio.to_thread(_run_and_collect),
                timeout=_PARSE_TIMEOUT,
            )

            # Yield all captured progress lines
            for log_line in log_lines:
                yield make_event("progress", log_line)

            if returncode != 0:
                logger.error(f"MinerU process failed with code {returncode}")
                yield make_event(
                    "error", f"Extraction failed (exit code {returncode})."
                )
                return

        except asyncio.TimeoutError:
            logger.error(f"MinerU timed out after {_PARSE_TIMEOUT}s for {filename}.")
            yield make_event("error", f"Parsing timed out after {_PARSE_TIMEOUT}s.")
            return
        except FileNotFoundError:
            logger.error("MinerU executable 'magic-pdf' not found in system PATH.")
            yield make_event(
                "error", "MinerU is not installed or 'magic-pdf' is not in PATH."
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
