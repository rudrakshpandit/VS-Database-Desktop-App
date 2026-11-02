# -*- coding: utf-8 -*-
"""
Adaptive Style Profile Engine for RVS AI / VS AI.
Manages professional default styles, analyzes user reference documents
(DOCX, XLSX, PPTX, PDF) to extract visual styling, and persists reusable
versioned style profiles with font fallback tracking.
"""

from __future__ import annotations
import os
import re
import json
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union
from pydantic import BaseModel, Field

APP_ROOT = Path(__file__).resolve().parent
DEFAULT_STYLE_DIR = APP_ROOT / "data" / "style_profiles"
DEFAULT_STYLE_DIR.mkdir(parents=True, exist_ok=True)


class StyleProfile(BaseModel):
    """
    Structured, reusable style profile capturing visual appearance,
    typography, color palette, table formatting, and page layout.
    """
    profile_id: str = Field(default_factory=lambda: f"prof_{uuid.uuid4().hex[:10]}")
    name: str = "Standard Professional"
    version: str = "1.0.0"
    source_format: Optional[str] = None       # "docx", "xlsx", "pptx", "pdf", "default"
    source_filename: Optional[str] = None
    
    # Typography
    font_primary: str = "Segoe UI"
    font_secondary: str = "Segoe UI"
    font_substitutions: Dict[str, str] = Field(default_factory=dict) # e.g. {"Aptos": "Calibri"}
    font_size_title: float = 16.0
    font_size_heading1: float = 13.0
    font_size_heading2: float = 11.5
    font_size_body: float = 10.0
    font_size_table: float = 9.5
    
    # Color Palette (Hex)
    color_primary_hex: str = "#1E3A8A"        # Deep Navy
    color_secondary_hex: str = "#2563EB"      # Royal Blue
    color_text_hex: str = "#0F172A"           # Slate Dark
    color_muted_hex: str = "#64748B"          # Slate Muted
    color_bg_header_hex: str = "#1E3A8A"      # Table / Banner Header Fill
    color_bg_zebra_hex: str = "#F8FAFC"       # Alternating Row Fill
    color_bg_total_hex: str = "#E2E8F0"       # Total / Summary Row Fill
    color_border_hex: str = "#CBD5E1"         # Border Lines
    
    # Geometry & Layout
    margin_top_inches: float = 0.8
    margin_bottom_inches: float = 0.8
    margin_left_inches: float = 0.8
    margin_right_inches: float = 0.8
    orientation: str = "portrait"             # "portrait" or "landscape"
    page_size: str = "A4"
    
    # Table & Document Features
    table_show_grid: bool = True
    table_header_bold: bool = True
    show_header_banner: bool = True
    show_page_numbers: bool = True
    confidence_score: float = 1.0             # 1.0 for native inspection, lower for heuristic fallback
    extraction_notes: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------------------------------------------------------------------------
# BUILT-IN PROFESSIONAL STYLE PROFILES (Mode A)
# ---------------------------------------------------------------------------

PROFESSIONAL_FINANCIAL = StyleProfile(
    profile_id="prof_financial_executive",
    name="Financial Executive — Schedule III & Tax Audits",
    source_format="default",
    font_primary="Segoe UI",
    font_secondary="Segoe UI Semibold",
    color_primary_hex="#1E3A8A",
    color_secondary_hex="#2563EB",
    color_text_hex="#0F172A",
    color_muted_hex="#64748B",
    color_bg_header_hex="#1E3A8A",
    color_bg_zebra_hex="#F8FAFC",
    color_bg_total_hex="#E2E8F0",
    color_border_hex="#CBD5E1",
    margin_top_inches=0.8,
    margin_bottom_inches=0.8,
    margin_left_inches=0.75,
    margin_right_inches=0.75,
    orientation="portrait",
    extraction_notes=["Pre-configured standard Chartered Accountancy & Schedule III styling."]
)

PROFESSIONAL_LEGAL = StyleProfile(
    profile_id="prof_statutory_legal",
    name="Statutory Legal — High Court & DRC-01 Replies",
    source_format="default",
    font_primary="Calibri",
    font_secondary="Calibri",
    color_primary_hex="#1E1B4B",              # Deep Indigo
    color_secondary_hex="#1D4ED8",
    color_text_hex="#111827",
    color_muted_hex="#4B5563",
    color_bg_header_hex="#1E1B4B",
    color_bg_zebra_hex="#F9FAFB",
    color_bg_total_hex="#E5E7EB",
    color_border_hex="#D1D5DB",
    margin_top_inches=1.0,
    margin_bottom_inches=1.0,
    margin_left_inches=1.0,
    margin_right_inches=1.0,
    orientation="portrait",
    extraction_notes=["Formal judicial pleading & notice reply formatting."]
)

PROFESSIONAL_CORPORATE = StyleProfile(
    profile_id="prof_corporate_board",
    name="Corporate Boardroom — Management Presentations",
    source_format="default",
    font_primary="Arial",
    font_secondary="Arial Bold",
    color_primary_hex="#0F766E",              # Deep Teal
    color_secondary_hex="#0D9488",
    color_text_hex="#134E4A",
    color_muted_hex="#6B7280",
    color_bg_header_hex="#0F766E",
    color_bg_zebra_hex="#F0FDFA",
    color_bg_total_hex="#CCFBF1",
    color_border_hex="#99F6E4",
    margin_top_inches=0.75,
    margin_bottom_inches=0.75,
    margin_left_inches=0.75,
    margin_right_inches=0.75,
    orientation="landscape",
    extraction_notes=["Clean executive presentation layout."]
)

DEFAULT_PROFILES: Dict[str, StyleProfile] = {
    "financial": PROFESSIONAL_FINANCIAL,
    "legal": PROFESSIONAL_LEGAL,
    "corporate": PROFESSIONAL_CORPORATE,
    "default": PROFESSIONAL_FINANCIAL,
}


# ---------------------------------------------------------------------------
# REFERENCE STYLE EXTRACTOR (Mode B)
# ---------------------------------------------------------------------------

class StyleProfileEngine:
    """Extracts, caches, and applies document styles across formats."""

    @classmethod
    def get_default_profile(cls, doc_type: str = "financial") -> StyleProfile:
        dt = (doc_type or "financial").lower()
        if "legal" in dt or "notice" in dt or "petition" in dt:
            return PROFESSIONAL_LEGAL
        elif "board" in dt or "presentation" in dt or "pptx" in dt:
            return PROFESSIONAL_CORPORATE
        return PROFESSIONAL_FINANCIAL

    @classmethod
    def analyze_docx_reference(cls, file_path: Union[str, Path]) -> StyleProfile:
        """Inspects a .docx reference file to extract fonts, colors, margins, and table styles."""
        p = Path(file_path)
        notes = []
        substitutions = {}
        font_name = "Calibri"
        primary_color = "#1E3A8A"
        zebra_color = "#F8FAFC"
        m_top = m_bottom = m_left = m_right = 0.8
        orient = "portrait"

        try:
            import docx
            doc = docx.Document(str(p))

            # 1. Section geometry
            if doc.sections:
                sec = doc.sections[0]
                m_top = round(sec.top_margin.inches, 2)
                m_bottom = round(sec.bottom_margin.inches, 2)
                m_left = round(sec.left_margin.inches, 2)
                m_right = round(sec.right_margin.inches, 2)
                orient = "landscape" if sec.orientation == docx.enum.section.WD_ORIENT.LANDSCAPE else "portrait"

            # 2. Extract Normal paragraph font
            try:
                if "Normal" in doc.styles and doc.styles["Normal"].font.name:
                    font_name = doc.styles["Normal"].font.name
            except Exception:
                pass

            # 3. Sample first non-empty paragraph run
            for para in doc.paragraphs[:15]:
                for run in para.runs:
                    if run.font.name:
                        font_name = run.font.name
                        break
                    if run.font.color and run.font.color.rgb:
                        primary_color = f"#{run.font.color.rgb}"
                if font_name != "Calibri":
                    break

            # 4. Table inspection
            if doc.tables:
                first_tbl = doc.tables[0]
                # Look for header cell fill color in XML
                for cell in first_tbl.rows[0].cells:
                    tcPr = cell._tc.get_or_add_tcPr()
                    for ch in tcPr:
                        if ch.tag.endswith("shd"):
                            fill_val = ch.get(docx.oxml.ns.qn("w:fill"))
                            if fill_val and fill_val not in ("auto", "none"):
                                primary_color = f"#{fill_val}"
                                break

            # Font fallback resolution
            safe_font = cls._resolve_font_fallback(font_name)
            if safe_font != font_name:
                substitutions[font_name] = safe_font
                notes.append(f"Font '{font_name}' substituted with '{safe_font}' for system compatibility.")
                font_name = safe_font

        except Exception as exc:
            notes.append(f"Partial extraction due to warning: {str(exc)}")

        return StyleProfile(
            name=f"Style from {p.name}",
            source_format="docx",
            source_filename=p.name,
            font_primary=font_name,
            font_secondary=font_name,
            font_substitutions=substitutions,
            color_primary_hex=primary_color,
            color_bg_header_hex=primary_color,
            margin_top_inches=m_top,
            margin_bottom_inches=m_bottom,
            margin_left_inches=m_left,
            margin_right_inches=m_right,
            orientation=orient,
            confidence_score=0.92,
            extraction_notes=notes
        )

    @classmethod
    def analyze_xlsx_reference(cls, file_path: Union[str, Path]) -> StyleProfile:
        """Inspects an .xlsx workbook to extract header styles, fills, fonts, and grid configuration."""
        p = Path(file_path)
        notes = []
        substitutions = {}
        font_name = "Segoe UI"
        hdr_color = "#1E3A8A"
        zebra_color = "#F8FAFC"
        orient = "portrait"

        try:
            import openpyxl
            wb = openpyxl.load_workbook(str(p), data_only=True)
            if wb.sheetnames:
                ws = wb.active
                if ws.page_setup and ws.page_setup.orientation:
                    orient = ws.page_setup.orientation.lower()

                # Sample header row (row 1 or 4)
                for r_idx in (1, 2, 4, 5):
                    for c_idx in range(1, min(ws.max_column + 1, 10)):
                        cell = ws.cell(row=r_idx, column=c_idx)
                        if cell.font and cell.font.name:
                            font_name = cell.font.name
                        if cell.fill and hasattr(cell.fill, "start_color") and cell.fill.start_color:
                            rgb = getattr(cell.fill.start_color, "rgb", None)
                            if rgb and isinstance(rgb, str) and len(rgb) in (6, 8):
                                raw_c = rgb[-6:]
                                if raw_c not in ("000000", "FFFFFF"):
                                    hdr_color = f"#{raw_c}"
                                    break
            wb.close()

            safe_font = cls._resolve_font_fallback(font_name)
            if safe_font != font_name:
                substitutions[font_name] = safe_font
                notes.append(f"Font '{font_name}' substituted with '{safe_font}'.")
                font_name = safe_font

        except Exception as exc:
            notes.append(f"Excel inspection note: {str(exc)}")

        return StyleProfile(
            name=f"Style from {p.name}",
            source_format="xlsx",
            source_filename=p.name,
            font_primary=font_name,
            font_secondary=font_name,
            font_substitutions=substitutions,
            color_primary_hex=hdr_color,
            color_secondary_hex=hdr_color,
            color_bg_header_hex=hdr_color,
            orientation=orient,
            confidence_score=0.90,
            extraction_notes=notes
        )

    @classmethod
    def analyze_pptx_reference(cls, file_path: Union[str, Path]) -> StyleProfile:
        """Inspects a .pptx presentation to extract slide fonts, master layout, and color schemes."""
        p = Path(file_path)
        notes = []
        substitutions = {}
        font_name = "Calibri"
        primary_color = "#0F766E"

        try:
            import pptx
            prs = pptx.Presentation(str(p))
            # Sample first slide text shapes
            if prs.slides:
                slide = prs.slides[0]
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        for para in shape.text_frame.paragraphs:
                            for run in para.runs:
                                if run.font.name:
                                    font_name = run.font.name
                                if run.font.color and hasattr(run.font.color, "rgb") and run.font.color.rgb:
                                    primary_color = f"#{str(run.font.color.rgb)}"
                                    break
                            if font_name != "Calibri":
                                break

            safe_font = cls._resolve_font_fallback(font_name)
            if safe_font != font_name:
                substitutions[font_name] = safe_font
                notes.append(f"Presentation font '{font_name}' substituted with '{safe_font}'.")
                font_name = safe_font

        except Exception as exc:
            notes.append(f"PowerPoint inspection note: {str(exc)}")

        return StyleProfile(
            name=f"Style from {p.name}",
            source_format="pptx",
            source_filename=p.name,
            font_primary=font_name,
            font_secondary=font_name,
            font_substitutions=substitutions,
            color_primary_hex=primary_color,
            color_bg_header_hex=primary_color,
            orientation="landscape",
            confidence_score=0.88,
            extraction_notes=notes
        )

    @classmethod
    def analyze_pdf_reference(cls, file_path: Union[str, Path]) -> StyleProfile:
        """Inspects a PDF using PyMuPDF to extract page dimensions, orientation, and font properties."""
        p = Path(file_path)
        notes = []
        substitutions = {}
        font_name = "Helvetica"
        orient = "portrait"
        m_top = m_bottom = m_left = m_right = 0.8

        try:
            try:
                import pymupdf as fitz
            except ImportError:
                import fitz

            doc = fitz.open(str(p))
            if len(doc) > 0:
                first_page = doc[0]
                rect = first_page.rect
                orient = "landscape" if rect.width > rect.height else "portrait"
                
                # Extract font list from page
                fonts = first_page.get_fonts()
                if fonts:
                    raw_fn = fonts[0][3] # BaseFont name
                    clean_fn = re.sub(r'^[A-Z]{6}\+', '', raw_fn)
                    font_name = clean_fn.split("-")[0].split(",")[0].strip()

            doc.close()
            safe_font = cls._resolve_font_fallback(font_name)
            if safe_font != font_name:
                substitutions[font_name] = safe_font
                notes.append(f"PDF font '{font_name}' mapped to system font '{safe_font}'.")
                font_name = safe_font

        except Exception as exc:
            notes.append(f"PDF inspection note: {str(exc)}")

        return StyleProfile(
            name=f"Style from {p.name}",
            source_format="pdf",
            source_filename=p.name,
            font_primary=font_name,
            font_secondary=font_name,
            font_substitutions=substitutions,
            orientation=orient,
            confidence_score=0.85,
            extraction_notes=notes
        )

    @classmethod
    def extract_style(cls, file_path: Union[str, Path]) -> StyleProfile:
        """Universal style extraction dispatcher based on file extension."""
        p = Path(file_path)
        ext = p.suffix.lower()
        if ext in (".docx", ".doc"):
            return cls.analyze_docx_reference(p)
        elif ext in (".xlsx", ".xls"):
            return cls.analyze_xlsx_reference(p)
        elif ext in (".pptx", ".ppt"):
            return cls.analyze_pptx_reference(p)
        elif ext == ".pdf":
            return cls.analyze_pdf_reference(p)
        else:
            return cls.get_default_profile()

    @classmethod
    def save_profile(cls, profile: StyleProfile) -> Path:
        """Persists profile to data/style_profiles/<profile_id>.json."""
        out_path = DEFAULT_STYLE_DIR / f"{profile.profile_id}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(profile.model_dump_json(indent=2))
        return out_path

    @classmethod
    def load_profile(cls, profile_id: str) -> Optional[StyleProfile]:
        """Loads profile from registry by ID."""
        if profile_id in DEFAULT_PROFILES:
            return DEFAULT_PROFILES[profile_id]
        path = DEFAULT_STYLE_DIR / f"{profile_id}.json"
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return StyleProfile(**data)
        return None

    @classmethod
    def _resolve_font_fallback(cls, raw_font: str) -> str:
        """Maps proprietary or missing fonts to standard Windows TrueType fonts."""
        fn = (raw_font or "").strip()
        fl = fn.lower()
        if any(k in fl for k in ("aptos", "calibri", "carlito")):
            return "Calibri"
        elif any(k in fl for k in ("segoe", "tahoma")):
            return "Segoe UI"
        elif any(k in fl for k in ("arial", "helvetica", "liberation sans")):
            return "Arial"
        elif any(k in fl for k in ("times", "georgia", "cambria", "garamond", "roman")):
            return "Times New Roman"
        elif any(k in fl for k in ("consolas", "courier", "mono")):
            return "Consolas"
        return "Calibri"

    @classmethod
    def resolve_font_family(cls, raw_font: str, target_format: str = "docx") -> str:
        """Resolves font family with format-specific fallback resolution."""
        if target_format.lower() == "pdf":
            fl = (raw_font or "").lower()
            if any(k in fl for k in ("times", "georgia", "cambria", "garamond", "roman")):
                return "Times-Roman"
            elif any(k in fl for k in ("courier", "mono", "consolas")):
                return "Courier"
            return "Helvetica"
        return cls._resolve_font_fallback(raw_font)

