import re
import json
import logging
from typing import List, Dict, Any, Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from core.models import Section, AtomicNote, KnowledgeType, Annotation

# Configure logging
logger = logging.getLogger(__name__)

def parse_markdown_to_sections(md_text: str) -> List[Section]:
    """
    Parses MinerU-generated Markdown into a list of Section objects.
    Uses # and ## to identify section boundaries.
    """
    lines = md_text.split('\n')
    sections: List[Section] = []
    
    current_title = "Preamble"
    current_level = 0
    current_content = []
    section_counter = 0

    # Helper to finalize the current section
    def finalize_section():
        nonlocal section_counter
        if current_content:
            text_content = '\n'.join(current_content).strip()
            if text_content:
                sections.append(Section(
                    id=f"sec-{section_counter}",
                    title=current_title,
                    level=current_level,
                    content=text_content,
                    atomic_notes=[]
                ))
                section_counter += 1

    for line in lines:
        # Check for headers
        # Matches # Title or ## Title, etc.
        match = re.match(r'^(#{1,6})\s+(.*)', line)
        if match:
            # Save previous section
            finalize_section()
            
            # Start new section
            hashes, title = match.groups()
            current_level = len(hashes)
            current_title = title.strip()
            current_content = [] # Reset content, header is metadata
        else:
            current_content.append(line)
            
    # Finalize the last section
    finalize_section()
    
    return sections


class CrusherAgent:
    """
    Agent responsible for crushing raw text sections into Atomic Notes using an LLM.
    """
    
    def __init__(self, model_name: str = "deepseek-ai/DeepSeek-V3", api_base: str = "http://localhost:8000/v1"):
        self.model_name = model_name
        self.api_base = api_base
        # In a real implementation, you would initialize an OpenAI client here
        # self.client = OpenAI(base_url=api_base, api_key="EMPTY") 

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        retry=retry_if_exception_type(json.JSONDecodeError)
    )
    def extract_atomic_notes(self, section: Section) -> List[AtomicNote]:
        """
        Extracts AtomicNotes from a given Section using an LLM with enforced JSON schema.
        """
        logger.info(f"Extracting notes for section: {section.title} (Length: {len(section.content)})")
        
        if not section.content.strip():
            return []

        prompt = self._build_prompt(section.content)
        
        try:
            # Mocking the LLM call for now. 
            # In production, replace with: 
            # response = self.client.chat.completions.create(...)
            # json_str = response.choices[0].message.content
             
            json_response = self._mock_llm_call(prompt) 
            # In a real scenario, we'd validate against the schema here or let Pydantic do it
            
            notes_data = json.loads(json_response)
            notes = []
            
            for note_data in notes_data.get("notes", []):
                # Ensure annotations are handled if present, or create empty list
                annotations_data = note_data.get("annotations", [])
                annotations = [Annotation(**ann) for ann in annotations_data]
                
                note = AtomicNote(
                    id=f"{section.id}-note-{len(notes)}",
                    concept_title=note_data.get("concept_title", "Untitled"),
                    knowledge_type=KnowledgeType(note_data.get("knowledge_type", "其他")),
                    summary=note_data.get("summary", ""),
                    keywords=note_data.get("keywords", []),
                    annotations=annotations
                )
                notes.append(note)
                
            return notes

        except Exception as e:
            logger.error(f"Failed to extract notes for section {section.id}: {e}")
            raise # Re-raise to trigger tenacity retry if it's a transient error

    def _build_prompt(self, content: str) -> str:
        return f"""
You are an expert academic knowledge extractor. analyze the following text section and extract "Atomic Notes".
Each note must represent a single, distinct concept, method, formula, or finding.

Text Content:
{content}

Output Requirement:
Return a valid JSON object with a key "notes" containing a list of objects.
Each object must follow this schema:
{{
  "concept_title": "string",
  "knowledge_type": "string (one of: 方法, 公式, 图像, 定义, 观点, 数据, 其他)",
  "summary": "string (concise summary)",
  "keywords": ["string", "string"],
  "annotations": [] 
}}

Note: Since you only have text, leave "annotations" as an empty list [].
"""

    def _mock_llm_call(self, prompt: str) -> str:
        """
        Placeholder for actual LLM call. Returns a valid JSON string for testing.
        """
        # This is just a dummy response to satisfy the type checker and basic logic
        dummy_response = {
            "notes": [
                {
                    "concept_title": "Sample Concept",
                    "knowledge_type": "定义",
                    "summary": "This is a placeholder summary generated by the mock LLM.",
                    "keywords": ["test", "mock"],
                    "annotations": []
                }
            ]
        }
        return json.dumps(dummy_response)

