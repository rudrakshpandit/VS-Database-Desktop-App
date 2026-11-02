# -*- coding: utf-8 -*-
"""
DocIR — Document Intermediate Representation for RVS AI / VS AI.
Typed, versioned semantic document models decoupling AI reasoning
from physical grid coordinates, page layouts, and output formats.
"""

from __future__ import annotations
import uuid
from enum import Enum
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class GenerationMode(str, Enum):
    """Core three-mode document generation model."""
    PROFESSIONAL = "professional"           # Mode A: From scratch with high-fidelity defaults
    REFERENCE_STYLE = "reference_style"     # Mode B: Adopt visual appearance of reference file
    EDITABLE_TEMPLATE = "editable_template" # Mode C: Populate existing template without structure alteration


class TargetFormat(str, Enum):
    """Output document format."""
    XLSX = "xlsx"
    DOCX = "docx"
    PPTX = "pptx"
    PDF = "pdf"


class DocumentType(str, Enum):
    """Semantic document classification."""
    FINANCIAL_STATEMENTS = "financial_statements"
    LEGAL_NOTICE_REPLY = "legal_notice_reply"
    TAX_COMPUTATION = "tax_computation"
    BOARD_PRESENTATION = "board_presentation"
    AUDIT_REPORT = "audit_report"
    AGREEMENT_DRAFT = "agreement_draft"
    EXECUTIVE_BRIEF = "executive_brief"
    GENERAL_DOCUMENT = "general_document"


class SemanticRowType(str, Enum):
    """Explicit semantic distinction between row types."""
    HEADER = "header"
    CATEGORY = "category"           # E.g. "I. EQUITY AND LIABILITIES", "(1) Shareholders' Funds"
    DETAIL = "detail"               # Ordinary financial data row (Share capital)
    SUBTOTAL = "subtotal"           # Aggregation of child detail items
    GRAND_TOTAL = "grand_total"     # Master summary row (Total Assets)
    CONTROL_CHECK = "control_check" # Reconciliation check (Assets - Liabilities = 0)
    SEPARATOR = "separator"
    NOTE = "note"


class NumberFormatType(str, Enum):
    """Number and data formatting directives."""
    CURRENCY_INR = "currency_inr"   # ₹ #,##0 or ₹ #,##0.00
    PERCENTAGE = "percentage"       # 0.0%
    INTEGER = "integer"             # #,##0
    DECIMAL_2 = "decimal_2"         # #,##0.00
    RATIO = "ratio"                 # 0.00
    TEXT = "text"
    DATE = "date"                   # DD-MMM-YYYY


class SemanticCell(BaseModel):
    """A single cell inside a semantic row."""
    value: Any = None
    raw_text: str = ""
    format_type: NumberFormatType = NumberFormatType.TEXT
    is_bold: bool = False
    is_italic: bool = False
    align: str = "left"             # "left", "center", "right"
    formula_expr: Optional[str] = None  # Semantic formula e.g. "SUM(shareholders_funds)"


class SemanticRow(BaseModel):
    """A row with unique semantic identity and hierarchical grouping."""
    row_id: str
    label: str
    row_type: SemanticRowType = SemanticRowType.DETAIL
    parent_group: Optional[str] = None      # e.g. "shareholders_funds", "current_assets"
    cells: Dict[str, SemanticCell] = Field(default_factory=dict) # Keyed by col_id
    formula_expr: Optional[str] = None     # Expression referencing row_ids or groups
    dependencies: List[str] = Field(default_factory=list) # Row IDs required for calculation
    is_indent: int = 0                     # Visual indentation level (0=top group, 1=sub, 2=item)


class SemanticColumn(BaseModel):
    """A column definition for a semantic table."""
    col_id: str
    header: str
    width_chars: Optional[int] = None
    default_format: NumberFormatType = NumberFormatType.TEXT
    align: str = "left"


class ControlAssertion(BaseModel):
    """An independent accounting or mathematical validation rule."""
    assertion_id: str
    name: str                              # E.g. "Assets Equal Liabilities"
    left_expr: str                         # E.g. "total_assets"
    right_expr: str                        # E.g. "total_equity_liabilities"
    op: str = "=="                         # "==", ">=", "<=", "!="
    tolerance: float = 0.01                # Allowed absolute difference
    error_message: str = "Control total does not reconcile"


class SemanticTable(BaseModel):
    """A structured, semantically aware financial or legal table."""
    table_id: str
    title: str
    columns: List[SemanticColumn] = Field(default_factory=list)
    rows: List[SemanticRow] = Field(default_factory=list)
    control_assertions: List[ControlAssertion] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SemanticSection(BaseModel):
    """A section of a Word/PDF report or explanatory schedule."""
    section_id: str
    heading: str
    level: int = 1                         # 1 for #, 2 for ##, 3 for ###
    paragraphs: List[str] = Field(default_factory=list)
    tables: List[SemanticTable] = Field(default_factory=list)


class SlideContent(BaseModel):
    """PowerPoint slide representation."""
    slide_id: str = Field(default_factory=lambda: f"slide_{uuid.uuid4().hex[:6]}")
    title: str
    subtitle: Optional[str] = None
    bullet_points: List[str] = Field(default_factory=list)
    bullets: List[str] = Field(default_factory=list)
    table: Optional[SemanticTable] = None
    metrics: List[Dict[str, str]] = Field(default_factory=list) # E.g. [{"label": "EBITDA", "value": "₹31.80 L"}]
    notes: Optional[str] = None
    layout_name: str = "title_and_content"

    def get_bullets(self) -> List[str]:
        return self.bullets or self.bullet_points



class DocIR(BaseModel):
    """
    Document Intermediate Representation Root.
    Standardized, serializable document specification decoupling domain reasoning
    from physical formatting and format-specific generation.
    """
    docir_version: str = "1.0.0"
    doc_id: str = Field(default_factory=lambda: f"docir_{uuid.uuid4().hex[:12]}")
    title: str
    subtitle: Optional[str] = None
    generation_mode: GenerationMode = GenerationMode.PROFESSIONAL
    target_format: TargetFormat = TargetFormat.XLSX
    document_type: DocumentType = DocumentType.GENERAL_DOCUMENT
    client_name: Optional[str] = None
    client_pan: Optional[str] = None
    style_profile_id: Optional[str] = None
    source_file_path: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    sections: List[SemanticSection] = Field(default_factory=list)
    slides: List[SlideContent] = Field(default_factory=list)
    control_assertions: List[ControlAssertion] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def get_all_tables(self) -> List[SemanticTable]:
        tables = []
        for sec in self.sections:
            tables.extend(sec.tables)
        return tables
