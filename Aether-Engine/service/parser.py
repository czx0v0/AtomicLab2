import json
import logging
import shutil
import subprocess
import tempfile
import asyncio
from typing import AsyncGenerator
from pathlib import Path

logger = logging.getLogger("uvicorn.error")

# Resolve magic-pdf: prefer PATH, fallback to known conda env location.
_MAGIC_PDF_BIN = (
    shutil.which("magic-pdf") or r"D:\anaconda\envs\py-agent\Scripts\magic-pdf.exe"
)

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

    def make_event(status: str, msg: str = "", markdown: str = "") -> str:
        payload = {"status": status}
        if msg:
            payload["message"] = msg
        if markdown:
            payload["markdown"] = markdown
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

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
        yield make_event("success", markdown=parsed_content)
