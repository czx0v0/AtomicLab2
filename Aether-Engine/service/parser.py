import logging
import subprocess
import tempfile
import asyncio
from pathlib import Path

logger = logging.getLogger("uvicorn.error")


async def parse_pdf_with_mineru(file_content: bytes, filename: str) -> str:
    """
    Invokes the local MinerU CLI (magic-pdf) via subprocess to parse a PDF
    and extract its content to Markdown with formulas and tables.
    """
    # Create an isolated temporary directory for the process
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)

        # Determine paths
        pdf_path = temp_dir_path / filename
        output_dir = temp_dir_path / "output"
        output_dir.mkdir()

        # Save uploaded PDF to disk
        pdf_path.write_bytes(file_content)

        # Build MinerU CLI execution command
        # Typically magic-pdf usage: magic-pdf -p <input.pdf> -o <output_dir> -m auto
        cmd = ["magic-pdf", "-p", str(pdf_path), "-o", str(output_dir), "-m", "auto"]

        logger.info(f"Starting MinerU parsing for {filename}...")

        try:
            # Run in a separate thread to avoid blocking the async event loop
            process = await asyncio.to_thread(
                subprocess.run,
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
            )
            logger.debug(f"MinerU STDOUT:\n{process.stdout}")
        except subprocess.CalledProcessError as e:
            logger.error(f"MinerU parsing failed for {filename}. STDERR:\n{e.stderr}")
            raise RuntimeError(f"MinerU extraction failed: {e.stderr}")
        except FileNotFoundError:
            logger.error("MinerU executable 'magic-pdf' not found in system PATH.")
            raise RuntimeError("MinerU is not installed or 'magic-pdf' is not in PATH.")

        # MinerU usually outputs nested directories inside the output_dir. Find the primary generated .md file
        md_files = list(output_dir.rglob("*.md"))
        if not md_files:
            logger.error(f"No valid Markdown generated for {filename}.")
            raise RuntimeError(
                "MinerU execution completed, but no Markdown output was found."
            )

        # Read the first generated Markdown file as the main document
        target_md_file = md_files[0]
        parsed_content = target_md_file.read_text(encoding="utf-8", errors="replace")

        logger.info(
            f"Successfully parsed {filename} to Markdown ({len(parsed_content)} chars)."
        )
        return parsed_content
