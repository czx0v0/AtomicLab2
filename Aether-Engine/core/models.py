from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field, HttpUrl

class KnowledgeType(str, Enum):
    METHOD = "方法"
    FORMULA = "公式"
    IMAGE = "图像"
    DEFINITION = "定义"
    VIEWPOINT = "观点"
    DATA = "数据"
    OTHER = "其他"

class Annotation(BaseModel):
    """Refers to a specific segment in the source PDF."""
    id: str = Field(..., description="Unique identifier for the annotation")
    selected_text: str = Field(..., description="The exact text selected from the document")
    page_num: int = Field(..., description="Page number where the text appears")
    bbox: List[float] = Field(..., description="Bounding box coordinates [x0, y0, x1, y1]")
    translation: Optional[str] = Field(None, description="Optional translation of the selected text")

class AtomicNote(BaseModel):
    """A single unit of knowledge extracted from the document."""
    id: str = Field(..., description="Unique identifier for the atomic note")
    concept_title: str = Field(..., description="Title of the concept or idea")
    knowledge_type: KnowledgeType = Field(..., description="Type of knowledge")
    summary: str = Field(..., description="Concise summary of the concept")
    keywords: List[str] = Field(default_factory=list, description="List of relevant keywords")
    annotations: List[Annotation] = Field(default_factory=list, description="Source annotations backing this note")

class Section(BaseModel):
    """A logical section within a document (e.g., Introduction, Methodology)."""
    id: str = Field(..., description="Unique identifier for the section")
    title: str = Field(..., description="Title of the section")
    level: int = Field(..., description="Heading level (1 for #, 2 for ##, etc.)")
    content: str = Field(..., description="Raw text content of the section")
    atomic_notes: List[AtomicNote] = Field(default_factory=list, description="Atomic notes extracted from this section")

class Document(BaseModel):
    """Represents a full academic paper or document."""
    doc_id: str = Field(..., description="Unique identifier for the document")
    title: str = Field(..., description="Title of the document")
    bibtex_citation: str = Field(..., description="Full BibTeX citation string")
    references: List[str] = Field(default_factory=list, description="List of doc_ids referenced by this document")
    sections: List[Section] = Field(default_factory=list, description="Sections contained in the document")

class Domain(BaseModel):
    """Represents a knowledge domain containing multiple documents."""
    domain_id: str = Field(..., description="Unique identifier for the domain")
    documents: List[Document] = Field(default_factory=list, description="List of documents within this domain")
