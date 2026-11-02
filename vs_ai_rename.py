"""
VS Database — AI Auto Document Rename Engine
Version 1.0

Features:
- Reads strictly first 2 pages of document (Page 0 and Page 1) via PyMuPDF / OCR / Vision.
- Identifies Document Type from controlled vocabulary.
- Identifies and normalizes Period / Month / FY / AY (e.g. Sept.26, FY 25-26, AY 26-27).
- Identifies Client / Entity name and normalizes it (e.g. XYZ&CO.).
- Detects possible client mismatch against active client context.
- Detects period conflicts.
- Naming template engine: [DOCUMENT TYPE] [PERIOD/YEAR] [CLIENT NAME]
- Strict confirmation-based workflow (never silent auto-rename).
- Handles duplicates safely (Keep Both with index vs Replace).
- Filename sanitization protecting Windows reserved chars and path traversal.
"""

import os
import re
import json
import base64
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List

try:
    import fitz
except ImportError:
    fitz = None

logger = logging.getLogger("vs_ai_rename")

# ---------------------------------------------------------------------------
# Controlled Document Vocabulary & Detection Rules
# ---------------------------------------------------------------------------

DOCUMENT_TYPE_RULES = [
    # GST Returns & Challans
    {
        "type": "GSTR-3B",
        "keywords": [r"gstr[\s\-]?3b\b", r"return\s+of\s+outward\s+and\s+inward\s+supplies.*3b"],
        "category": "gst"
    },
    {
        "type": "GSTR-1",
        "keywords": [r"gstr[\s\-]?1\b", r"details\s+of\s+outward\s+supplies.*1"],
        "category": "gst"
    },
    {
        "type": "GSTR-2B",
        "keywords": [r"gstr[\s\-]?2b\b", r"auto[\s\-]?drafted\s+itc\s+statement"],
        "category": "gst"
    },
    {
        "type": "GSTR-9",
        "keywords": [r"gstr[\s\-]?9\b", r"annual\s+return.*gstr[\s\-]?9"],
        "category": "gst"
    },
    {
        "type": "GSTR-9C",
        "keywords": [r"gstr[\s\-]?9c\b", r"reconciliation\s+statement.*9c"],
        "category": "gst"
    },
    {
        "type": "GST RETURN",
        "keywords": [r"goods\s+and\s+services\s+tax.*return", r"gst\s+return", r"gstin\b.*return\s+period"],
        "category": "gst"
    },
    {
        "type": "GST REGISTRATION",
        "keywords": [r"form\s+gst\s+reg[\s\-]06", r"registration\s+certificate.*goods\s+and\s+services\s+tax"],
        "category": "gst"
    },
    {
        "type": "GST CHALLAN",
        "keywords": [r"pmt[\s\-]06", r"gst\s+challan", r"challan\s+for\s+payment\s+of\s+goods\s+and\s+services\s+tax"],
        "category": "gst"
    },
    {
        "type": "GST NOTICE",
        "keywords": [r"asmt[\s\-]10", r"drc[\s\-]01", r"show\s+cause\s+notice.*gst", r"notice.*under\s+section.*cgst"],
        "category": "gst"
    },
    
    # Income Tax Forms & Acknowledgment
    {
        "type": "ITR ACKNOWLEDGEMENT",
        "keywords": [
            r"indian\s+income\s+tax\s+return\s+acknowledgement",
            r"itr[\s\-]?v\b",
            r"income\s+tax\s+return\s+verification\s+form",
            r"acknowledgement\s+number.*e[\s\-]?filing"
        ],
        "category": "income_tax"
    },
    {
        "type": "ITR",
        "keywords": [r"income\s+tax\s+return", r"itr[\s\-][1-7]\b", r"sugam", r"sahaj"],
        "category": "income_tax"
    },
    {
        "type": "FORM 26AS",
        "keywords": [r"form\s+(?:no\.?\s*)?26as\b", r"annual\s+tax\s+statement\s+under\s+section\s+203aa"],
        "category": "income_tax"
    },
    {
        "type": "AIS",
        "keywords": [r"annual\s+information\s+statement\b", r"\bais\b.*income\s+tax"],
        "category": "income_tax"
    },
    {
        "type": "TIS",
        "keywords": [r"taxpayer\s+information\s+summary\b", r"\btis\b.*income\s+tax"],
        "category": "income_tax"
    },
    {
        "type": "FORM 16",
        "keywords": [r"form\s+(?:no\.?\s*)?16\b(?!a)", r"certificate\s+under\s+section\s+203.*salary"],
        "category": "income_tax"
    },
    {
        "type": "FORM 16A",
        "keywords": [r"form\s+(?:no\.?\s*)?16a\b", r"certificate\s+under\s+section\s+203.*other\s+than\s+salary"],
        "category": "income_tax"
    },
    {
        "type": "INTIMATION 143(1)",
        "keywords": [r"intimation\s+u[\/s\s]+143\s*\(\s*1\s*\)", r"section\s+143\(1\)", r"143\(1\)\s+of\s+the\s+income\s+tax\s+act"],
        "category": "income_tax"
    },
    {
        "type": "CHALLAN 280",
        "keywords": [r"challan\s+(?:no\.?[\/\s]*)?itns\s*280", r"itns[\s\-]?280", r"advance\s+tax\s+challan.*280"],
        "category": "income_tax"
    },
    {
        "type": "TDS CERTIFICATE",
        "keywords": [r"tds\s+certificate", r"tax\s+deducted\s+at\s+source\s+certificate"],
        "category": "income_tax"
    },

    # Banking & Accounting
    {
        "type": "BANK STATEMENT",
        "keywords": [r"bank\s+statement", r"account\s+statement.*bank", r"statement\s+of\s+account.*savings|current", r"\bifsc\b.*account\s+no"],
        "category": "banking"
    },
    {
        "type": "AUDIT REPORT",
        "keywords": [r"independent\s+auditor'?s\s+report", r"form\s+3cd", r"form\s+3ca", r"form\s+3cb", r"tax\s+audit\s+report"],
        "category": "audit"
    },
    {
        "type": "TAX INVOICE",
        "keywords": [r"tax\s+invoice", r"invoice\s+no\.?", r"bill\s+of\s+supply"],
        "category": "invoice"
    },
    {
        "type": "BALANCE SHEET",
        "keywords": [r"balance\s+sheet\s+as\s+at", r"statement\s+of\s+financial\s+position"],
        "category": "accounts"
    },
    {
        "type": "PROFIT AND LOSS",
        "keywords": [r"profit\s+(?:and|&)\s+loss\s+statement", r"statement\s+of\s+profit\s+(?:and|&)\s+loss"],
        "category": "accounts"
    }
]

# Month name mapping to standardized 3-4 letter abbr with period
MONTH_MAP = {
    "jan": "Jan.",
    "january": "Jan.",
    "feb": "Feb.",
    "february": "Feb.",
    "mar": "Mar.",
    "march": "Mar.",
    "apr": "Apr.",
    "april": "Apr.",
    "may": "May",
    "jun": "Jun.",
    "june": "Jun.",
    "jul": "Jul.",
    "july": "Jul.",
    "aug": "Aug.",
    "august": "Aug.",
    "sep": "Sept.",
    "sept": "Sept.",
    "september": "Sept.",
    "oct": "Oct.",
    "october": "Oct.",
    "nov": "Nov.",
    "november": "Nov.",
    "dec": "Dec.",
    "december": "Dec."
}

# ---------------------------------------------------------------------------
# Normalization Helpers
# ---------------------------------------------------------------------------

def normalize_month_token(month_str: str) -> Optional[str]:
    """Converts January, Sep, Sept, etc. to standardized 'Jan.', 'Sept.', etc."""
    cleaned = re.sub(r'[^a-zA-Z]', '', month_str).lower()
    return MONTH_MAP.get(cleaned)


def normalize_client_name(raw_name: str) -> str:
    """
    Normalizes client entity name:
    'XYZ & CO.' -> 'XYZ&CO.'
    'MR. RAMLAL GUPTA' -> 'MR. Ramlal Gupta' or 'MR. Ramlal'
    Removes illegal path characters and excessive whitespace.
    """
    if not raw_name:
        return ""
    
    name = raw_name.strip()
    # Strip common salutation prefixes
    name = re.sub(r'^(?:m\/s\.?|ms\.?|mr\.?|mrs\.?|shri|smt\.?)\s*', '', name, flags=re.IGNORECASE).strip()
    # Collapse ' & ' or ' and ' into '&' for company entities
    name = re.sub(r'\s*&\s*', '&', name)
    name = re.sub(r'\s+and\s+', '&', name, flags=re.IGNORECASE)
    # Standardize & Co. -> &CO. or & Co
    name = re.sub(r'&CO\.?', '&CO.', name, flags=re.IGNORECASE)
    # Remove filesystem illegal characters
    name = re.sub(r'[\\/*?:"<>|]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def sanitize_filename(name: str, fallback_ext: str = ".pdf") -> str:
    r"""
    Ensures safe Windows filename:
    - Removes illegal chars: \ / * ? : " < > |
    - Strips leading/trailing dots and spaces
    - Limits length to 180 chars
    - Preserves extension
    """
    name = name.strip()
    if not name:
        return f"Document{fallback_ext}"

    # Extract extension if present
    base, ext = os.path.splitext(name)
    if not ext:
        ext = fallback_ext
    else:
        ext = ext.lower()

    # Clean base name
    clean_base = re.sub(r'[\\/*?:"<>|]', ' ', base)
    clean_base = re.sub(r'\s+', ' ', clean_base).strip(' .')

    if not clean_base:
        clean_base = "Document"

    # Truncate to reasonable length
    if len(clean_base) > 160:
        clean_base = clean_base[:160].rstrip(' .')

    return f"{clean_base}{ext}"


# ---------------------------------------------------------------------------
# Text Extraction (First 2 Pages Only)
# ---------------------------------------------------------------------------

def extract_first_two_pages_text(file_path: Path) -> Tuple[str, int]:
    """
    Extracts text strictly from Page 0 and Page 1 of PDF.
    Returns (extracted_text, page_count).
    """
    if not file_path.is_file():
        return "", 0

    ext = file_path.suffix.lower()
    if ext != ".pdf":
        return "", 0

    if not fitz:
        return "", 0

    try:
        doc = fitz.open(str(file_path))
        page_count = len(doc)
        pages_to_read = min(2, page_count)
        combined_text = []

        for pno in range(pages_to_read):
            page_text = doc[pno].get_text("text") or ""
            combined_text.append(page_text)

        doc.close()
        full_text = "\n".join(combined_text)
        return full_text.strip(), page_count
    except Exception as e:
        logger.warning(f"Error reading first 2 pages of {file_path}: {e}")
        return "", 0


def render_page_thumbnail_base64(file_path: Path, max_pages: int = 2) -> List[str]:
    """Renders up to 2 pages as JPEG base64 thumbnails for vision analysis."""
    if not fitz or not file_path.is_file() or file_path.suffix.lower() != ".pdf":
        return []

    images = []
    try:
        doc = fitz.open(str(file_path))
        pages_to_render = min(max_pages, len(doc))
        for pno in range(pages_to_render):
            page = doc[pno]
            pix = page.get_pixmap(dpi=130)
            img_bytes = pix.tobytes("jpeg")
            images.append(base64.b64encode(img_bytes).decode("utf-8"))
        doc.close()
    except Exception as e:
        logger.warning(f"Error rendering thumbnails for {file_path}: {e}")
    return images


# ---------------------------------------------------------------------------
# Heuristic Extraction Engine
# ---------------------------------------------------------------------------

class DocumentContentExtractor:
    """Fast, accurate deterministic extraction of doc type, period, and entity."""

    @staticmethod
    def detect_document_type(text: str) -> Optional[Dict[str, Any]]:
        t_low = text.lower()
        for rule in DOCUMENT_TYPE_RULES:
            for kw in rule["keywords"]:
                if re.search(kw, t_low):
                    return rule
        return None

    @staticmethod
    def extract_period(text: str, doc_category: str = "general") -> Tuple[Optional[str], Optional[str], bool]:
        """
        Extracts period:
        - Assessment Year: 'AY 26-27'
        - Financial Year: 'FY 25-26'
        - Month Period: 'Sept.26', 'Oct.25'
        Returns: (formatted_period, raw_period_type, has_conflict)
        """
        has_conflict = False

        # 1. Check for Assessment Year (AY 2026-27 or AY 26-27 or Assessment Year 2026-2027)
        ay_matches = re.findall(
            r'(?:assessment\s*year|a\.?y\.?)\s*[:\-]?\s*(\b20[2-3][0-9])[\s\-\/]+([0-9]{2,4}\b)',
            text,
            re.IGNORECASE
        )
        if ay_matches:
            # normalize first match
            y1_str, y2_str = ay_matches[0]
            y1 = int(y1_str)
            y2 = int(y2_str[-2:])
            ay_str = f"AY {str(y1)[-2:]}-{y2:02d}"
            # Check for conflicting AYs in first 2 pages
            unique_ays = set(f"{m[0]}-{m[1][-2:]}" for m in ay_matches)
            if len(unique_ays) > 1:
                has_conflict = True
            return ay_str, "AY", has_conflict

        # 2. Check for Financial Year (FY 2025-26 or FY 25-26 or Financial Year 2025-2026)
        fy_matches = re.findall(
            r'(?:financial\s*year|f\.?y\.?)\s*[:\-]?\s*(\b20[2-3][0-9])[\s\-\/]+([0-9]{2,4}\b)',
            text,
            re.IGNORECASE
        )
        if fy_matches:
            y1_str, y2_str = fy_matches[0]
            y1 = int(y1_str)
            y2 = int(y2_str[-2:])
            fy_str = f"FY {str(y1)[-2:]}-{y2:02d}"
            unique_fys = set(f"{m[0]}-{m[1][-2:]}" for m in fy_matches)
            if len(unique_fys) > 1:
                has_conflict = True
            return fy_str, "FY", has_conflict

        # 3. Check for GST Return Period (Month Year, e.g. September 2026, Sept 2026, 09/2026)
        month_year_pattern = (
            r'(?:return\s*period|tax\s*period|period|month)\s*[:\-]?\s*'
            r'([a-zA-Z]{3,9})\s*[\-\/,\s]?\s*(20[2-3][0-9]|[2-3][0-9])\b'
        )
        my_match = re.search(month_year_pattern, text, re.IGNORECASE)
        if my_match:
            m_raw, y_raw = my_match.group(1), my_match.group(2)
            m_norm = normalize_month_token(m_raw)
            if m_norm:
                y_suffix = y_raw[-2:]
                period_str = f"{m_norm}{y_suffix}"
                return period_str, "MONTH", False

        # Fallback standalone month + 4-digit year (e.g. "September 2026")
        standalone_my = re.findall(
            r'\b(january|february|march|april|may|june|july|august|september|october|november|december|sept?|oct|nov|dec|jan|feb|mar|apr|jun|jul|aug)\s+(20[2-3][0-9])\b',
            text,
            re.IGNORECASE
        )
        if standalone_my:
            m_raw, y_raw = standalone_my[0]
            m_norm = normalize_month_token(m_raw)
            if m_norm:
                y_suffix = y_raw[-2:]
                period_str = f"{m_norm}{y_suffix}"
                if len(set(f"{m.lower()}_{y}" for m, y in standalone_my)) > 1:
                    has_conflict = True
                return period_str, "MONTH", has_conflict

        return None, None, False

    @staticmethod
    def extract_identifiers(text: str) -> Dict[str, str]:
        """Extracts PAN, GSTIN, TAN, or Form Acknowledgment numbers."""
        ids = {}
        # PAN pattern: 5 uppercase letters, 4 digits, 1 uppercase letter
        pan_match = re.search(r'\b([A-Z]{5}[0-9]{4}[A-Z])\b', text)
        if pan_match:
            ids["pan"] = pan_match.group(1)

        # GSTIN pattern: 2 digits, 5 letters, 4 digits, 1 letter, 1 char, Z, 1 char
        gstin_match = re.search(r'\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b', text)
        if gstin_match:
            ids["gstin"] = gstin_match.group(1)

        return ids

    @staticmethod
    def extract_entity_name(text: str, context_client_name: Optional[str] = None) -> Optional[str]:
        """
        Attempts to find entity / taxpayer name in document:
        - "Name of Taxpayer: XYZ & CO."
        - "Legal Name of Business: ..."
        - "Trade Name: ..."
        - "Name: Mr. Ramlal"
        """
        patterns = [
            r'(?:legal\s*name\s*of\s*business|trade\s*name|name\s*of\s*the\s*taxpayer|name\s*of\s*assessee|taxpayer\s*name)\s*[:\-]?\s*([A-Za-z0-9\s&.,\'\-]+?)(?=\n|gstin|pan|constitution|address|$)',
            r'(?:name)\s*[:\-]\s*([A-Za-z0-9\s&.,\'\-]{3,40})(?=\n|pan|status|father|$)',
        ]

        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                raw = m.group(1).strip()
                # Clean up excess trailing markers
                raw = re.sub(r'^(mr\.|m\/s\.?|shri|smt\.?)\s*', '', raw, flags=re.IGNORECASE)
                raw = raw.split("\n")[0].strip()
                if len(raw) >= 3 and not re.search(r'^(is|the|for|assessment|income|tax|return)$', raw, re.IGNORECASE):
                    return normalize_client_name(raw)

        return None


# ---------------------------------------------------------------------------
# Template Engine
# ---------------------------------------------------------------------------

class NamingTemplateEngine:
    """Formats standardized filenames according to defined template grammar."""

    @staticmethod
    def format_filename(
        doc_type: str,
        period: Optional[str],
        client_name: Optional[str],
        extension: str = ".pdf",
        template: str = "{DOCUMENT_TYPE} {PERIOD} {CLIENT_NAME}"
    ) -> str:
        """
        Default pattern: [DOCUMENT TYPE] [PERIOD/YEAR] [CLIENT NAME]
        Gracefully handles missing components without empty spaces.
        """
        tokens = []

        clean_doc = (doc_type or "").strip()
        if clean_doc:
            tokens.append(clean_doc)

        clean_period = (period or "").strip()
        if clean_period:
            tokens.append(clean_period)

        clean_client = (client_name or "").strip()
        if clean_client:
            tokens.append(clean_client)

        result_base = " ".join(tokens)
        return sanitize_filename(result_base, fallback_ext=extension)


# ---------------------------------------------------------------------------
# Client Mismatch Detector
# ---------------------------------------------------------------------------

def check_client_mismatch(detected_name: Optional[str], context_client_name: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    Compares the entity detected from the document against the client currently active in the app.
    Returns (is_mismatch, message).
    """
    if not detected_name or not context_client_name:
        return False, None

    d_norm = re.sub(r'[^a-zA-Z0-9]', '', detected_name).lower()
    c_norm = re.sub(r'[^a-zA-Z0-9]', '', context_client_name).lower()

    if not d_norm or not c_norm:
        return False, None

    # Check if one is substring of other (e.g. 'XYZ' and 'XYZ & CO.')
    if d_norm in c_norm or c_norm in d_norm:
        return False, None

    # Significant mismatch
    return True, f"Possible client mismatch: Document appears to belong to '{detected_name}', but active client is '{context_client_name}'."


# ---------------------------------------------------------------------------
# AI Auto Rename Master Coordinator
# ---------------------------------------------------------------------------

class AiAutoRenameCoordinator:
    """
    Coordinates end-to-end analysis:
    1. Reads first 2 pages strictly.
    2. Runs fast deterministic regex/heuristics.
    3. If confidence is low or document is scanned/image, falls back to Gemini Flash vision on first 2 pages.
    4. Proposes standardized filename with explanation and confidence score.
    5. Flags client mismatch or period conflicts.
    """

    def __init__(self, gemini_provider=None):
        self.gemini = gemini_provider

    def analyze_document(
        self,
        file_path: str,
        context_client_name: Optional[str] = None,
        context_client_pan: Optional[str] = None,
        file_bytes: Optional[bytes] = None
    ) -> Dict[str, Any]:
        """
        Analyzes document and generates proposed filename.
        NEVER renames automatically. Returns proposal for user confirmation.
        """
        p = Path(file_path)
        orig_name = p.name
        ext = p.suffix.lower() if p.suffix else ".pdf"

        if ext not in (".pdf", ".png", ".jpg", ".jpeg"):
            return {
                "ok": False,
                "error": f"AI Rename only supports PDF and image formats (received {ext})."
            }

        # 1. Read first 2 pages
        extracted_text, page_count = extract_first_two_pages_text(p)
        clean_text_len = len(re.sub(r'\s+', '', extracted_text))

        doc_type_rule = None
        period_str = None
        period_type = None
        has_period_conflict = False
        detected_entity = None
        identifiers = {}
        analysis_method = "deterministic_regex"
        confidence = "HIGH"
        confidence_score = 0.95
        reason_parts = []

        # 2. Try Deterministic Extraction if text exists
        if clean_text_len > 20:
            doc_type_rule = DocumentContentExtractor.detect_document_type(extracted_text)
            period_str, period_type, has_period_conflict = DocumentContentExtractor.extract_period(
                extracted_text,
                doc_category=doc_type_rule["category"] if doc_type_rule else "general"
            )
            identifiers = DocumentContentExtractor.extract_identifiers(extracted_text)
            detected_entity = DocumentContentExtractor.extract_entity_name(extracted_text, context_client_name)

        # 3. Fallback to Gemini Multimodal Vision if text is sparse or doc_type not identified
        if (not doc_type_rule or clean_text_len <= 20) and self.gemini:
            vision_result = self._analyze_via_vision(p, context_client_name)
            if vision_result.get("ok"):
                v_data = vision_result.get("data", {})
                doc_type_val = v_data.get("document_type")
                if doc_type_val:
                    doc_type_rule = {"type": doc_type_val.upper(), "category": "vision"}
                if not period_str and v_data.get("period"):
                    period_str = v_data.get("period")
                if not detected_entity and v_data.get("client_name"):
                    detected_entity = normalize_client_name(v_data.get("client_name"))
                analysis_method = "gemini_flash_vision"
                confidence = v_data.get("confidence_rating", "MEDIUM")
                confidence_score = float(v_data.get("confidence", 0.85))

        # 4. Synthesize final attributes
        final_doc_type = doc_type_rule["type"] if doc_type_rule else "DOCUMENT"
        
        # Prefer detected client, otherwise context client if known
        final_client = detected_entity or (normalize_client_name(context_client_name) if context_client_name else None)

        # Build Explanation Reason
        if doc_type_rule:
            reason_parts.append(f"Identified as {final_doc_type}")
        if period_str:
            reason_parts.append(f"Period: {period_str}")
        if final_client:
            reason_parts.append(f"Client: {final_client}")

        # Check Client Mismatch
        is_client_mismatch, mismatch_msg = check_client_mismatch(detected_entity, context_client_name)
        if is_client_mismatch:
            confidence = "LOW" if confidence == "HIGH" else confidence
            confidence_score = min(confidence_score, 0.65)

        if has_period_conflict:
            confidence = "MEDIUM" if confidence == "HIGH" else confidence
            confidence_score = min(confidence_score, 0.75)

        # If document type could not be determined at all
        if final_doc_type == "DOCUMENT" and not period_str:
            confidence = "LOW"
            confidence_score = 0.30
            reason_parts.append("Could not confidently identify tax document structure")

        # 5. Format proposed filename
        proposed_name = NamingTemplateEngine.format_filename(
            doc_type=final_doc_type if final_doc_type != "DOCUMENT" else "",
            period=period_str,
            client_name=final_client,
            extension=ext
        )

        # If proposal turned out empty or identical to original
        if not proposed_name or proposed_name.lower() == ext.lower():
            proposed_name = orig_name

        return {
            "ok": True,
            "original_filename": orig_name,
            "proposed_filename": proposed_name,
            "confidence": confidence,
            "confidence_score": round(confidence_score, 2),
            "method": analysis_method,
            "pages_analyzed": min(2, page_count) if page_count else 1,
            "document_type": final_doc_type if final_doc_type != "DOCUMENT" else None,
            "period": period_str,
            "detected_client": detected_entity,
            "context_client": context_client_name,
            "client_mismatch": is_client_mismatch,
            "client_mismatch_message": mismatch_msg,
            "period_conflict": has_period_conflict,
            "breakdown": {
                "type": final_doc_type if final_doc_type != "DOCUMENT" else "General Document",
                "period": period_str or "Not specified",
                "client": final_client or "Not specified"
            },
            "reason": " • ".join(reason_parts) if reason_parts else "Standard document format"
        }

    def _analyze_via_vision(self, p: Path, context_client_name: Optional[str]) -> Dict[str, Any]:
        """Runs Gemini Flash vision on first 1-2 pages of scanned / image docs."""
        if not self.gemini:
            return {"ok": False, "error": "Gemini provider not configured."}

        thumbnails = render_page_thumbnail_base64(p, max_pages=2)
        attachments = []
        for tb in thumbnails:
            attachments.append({"mime_type": "image/jpeg", "base64_data": tb})

        if not attachments:
            return {"ok": False, "error": "Could not generate page image for vision."}

        prompt = (
            "Analyze the first 2 pages of this Indian statutory, tax, or office document.\n"
            "Identify:\n"
            "1. Document Type (e.g. GST RETURN, GSTR-3B, GSTR-1, ITR ACKNOWLEDGEMENT, FORM 26AS, AIS, TIS, BANK STATEMENT, TAX INVOICE)\n"
            "2. Period / Month / Year (Format: 'Sept.26' for months, 'FY 25-26' for financial years, 'AY 26-27' for assessment years)\n"
            "3. Client or Entity Name (e.g. XYZ&CO., MR. Ramlal)\n"
            "4. Confidence rating ('HIGH', 'MEDIUM', or 'LOW') and confidence numeric (0.0 to 1.0)\n\n"
            f"Active Client Context: {context_client_name or 'None'}\n\n"
            "Output strictly valid JSON with this schema:\n"
            "{\n"
            '  "document_type": "...",\n'
            '  "period": "...",\n'
            '  "client_name": "...",\n'
            '  "confidence_rating": "HIGH",\n'
            '  "confidence": 0.95\n'
            "}"
        )

        try:
            res = self.gemini.generate_content(
                prompt,
                attachments=attachments,
                system_instruction="You are an expert Indian CA office document naming specialist. Return strict JSON only."
            )
            if res.get("ok"):
                raw_text = res.get("text", "").strip()
                clean_json = re.sub(r'^```json\s*', '', raw_text)
                clean_json = re.sub(r'\s*```$', '', clean_json).strip()
                data = json.loads(clean_json)
                return {"ok": True, "data": data}
        except Exception as e:
            logger.warning(f"Gemini vision rename error: {e}")

        return {"ok": False, "error": "Vision analysis failed."}


# ---------------------------------------------------------------------------
# Duplicate Resolution Helpers
# ---------------------------------------------------------------------------

def generate_unique_filename(target_dir: Path, desired_name: str) -> str:
    """
    If 'GST RETURN Sept.26 XYZ&CO..pdf' exists, generates
    'GST RETURN Sept.26 XYZ&CO. (1).pdf', '(2).pdf', etc.
    """
    base, ext = os.path.splitext(desired_name)
    counter = 1
    test_name = desired_name
    while (target_dir / test_name).exists():
        test_name = f"{base} ({counter}){ext}"
        counter += 1
    return test_name
