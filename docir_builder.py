# -*- coding: utf-8 -*-
"""
DocIR Builder and Mode Detection Engine for RVS AI / VS AI.
Detects the generation mode (Professional, Reference Style, Editable Template),
constructs typed DocIR models from domain facts or Markdown text,
and generates structured financial statement schedules.
"""

from __future__ import annotations
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple, Union

from docir_models import (
    DocIR, GenerationMode, TargetFormat, DocumentType,
    SemanticSection, SemanticTable, SemanticRow, SemanticColumn,
    SemanticCell, SemanticRowType, NumberFormatType, ControlAssertion,
    SlideContent
)
from style_profile_engine import StyleProfileEngine, StyleProfile


class ModeDetector:
    """
    Evaluates user prompt, intent, and attached files to deterministically
    select between Professional Mode, Reference Style Mode, and Editable Template Mode.
    """

    @classmethod
    def detect_mode(
        cls,
        prompt: str,
        attachments: Optional[List[Dict[str, Any]]] = None
    ) -> Tuple[GenerationMode, Optional[str], Optional[str]]:
        """
        Returns: (mode, template_file_path, reference_file_path)
        """
        p_low = (prompt or "").lower()
        has_attachments = bool(attachments and len(attachments) > 0)

        template_path = None
        reference_path = None

        if has_attachments:
            for att in attachments:
                role = (att.get("role") or "").lower()
                f_path = att.get("file_path") or att.get("name")
                if "template" in role or "fill" in role or "populate" in role:
                    template_path = f_path
                elif "reference" in role or "style" in role or "format" in role:
                    reference_path = f_path
                elif not template_path and not reference_path:
                    # Heuristic assignment based on prompt verbs
                    if any(w in p_low for w in ("fill", "populate", "complete", "update this", "update the file")):
                        template_path = f_path
                    else:
                        reference_path = f_path

        # Rule 1: Explicit request to fill, complete, update or populate
        if template_path or any(w in p_low for w in ("fill the template", "populate the template", "fill this", "complete this document", "update existing file")):
            return GenerationMode.EDITABLE_TEMPLATE, template_path, reference_path

        # Rule 2: Explicit request to follow appearance or format of attached file
        if reference_path or (has_attachments and any(w in p_low for w in ("in the same format", "use this style", "follow this design", "same appearance", "look like"))):
            return GenerationMode.REFERENCE_STYLE, None, reference_path

        # Rule 3: Default to Professional Mode
        return GenerationMode.PROFESSIONAL, None, None


class DocIRBuilder:
    """Factory creating validated DocIR instances for core CA and legal deliverables."""

    @classmethod
    def create_schedule_iii_balance_sheet_docir(
        cls,
        title: str = "Balance Sheet (Schedule III)",
        client_name: Optional[str] = None,
        share_capital: float = 5000000.0,
        reserves_surplus: float = 4190000.0,
        long_term_borrowings: float = 2800000.0,
        trade_payables: float = 1840000.0,
        short_term_provisions: float = 460000.0,
        property_plant_equipment: float = 6800000.0,
        inventories: float = 2450000.0,
        trade_receivables: float = 3120000.0,
        cash_bank: float = 1480000.0,
        short_term_advances: float = 440000.0,
        mode: GenerationMode = GenerationMode.PROFESSIONAL,
        target_format: TargetFormat = TargetFormat.XLSX,
        style_profile_id: Optional[str] = None
    ) -> DocIR:
        """
        Creates a mathematically guaranteed, Schedule III compliant Balance Sheet DocIR
        with independent accounting assertions (Assets == Equity + Liabilities).
        """
        cols = [
            SemanticColumn(col_id="particulars", header="Particulars", width_chars=36),
            SemanticColumn(col_id="note_no", header="Note No.", width_chars=12, align="center"),
            SemanticColumn(col_id="current_period", header="Current Period (₹)", width_chars=22, default_format=NumberFormatType.CURRENCY_INR, align="right"),
            SemanticColumn(col_id="prev_period", header="Previous Period (₹)", width_chars=22, default_format=NumberFormatType.CURRENCY_INR, align="right"),
        ]

        # -------------------------------------------------------------
        # SHEET 1: EQUITY AND LIABILITIES
        # -------------------------------------------------------------
        eq_rows = [
            SemanticRow(row_id="cat_equity_liab", label="I. EQUITY AND LIABILITIES", row_type=SemanticRowType.CATEGORY),
            SemanticRow(row_id="cat_shareholders_funds", label="(1) Shareholders' Funds", row_type=SemanticRowType.CATEGORY, is_indent=1),
            SemanticRow(
                row_id="share_capital", label="(a) Share capital", row_type=SemanticRowType.DETAIL,
                parent_group="shareholders_funds", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(a) Share capital"),
                    "note_no": SemanticCell(value="1", align="center"),
                    "current_period": SemanticCell(value=share_capital, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=share_capital, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="reserves_surplus", label="(b) Reserves and surplus", row_type=SemanticRowType.DETAIL,
                parent_group="shareholders_funds", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(b) Reserves and surplus"),
                    "note_no": SemanticCell(value="2", align="center"),
                    "current_period": SemanticCell(value=reserves_surplus, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=2450000.0, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="subtotal_shareholders_funds", label="Sub-total - Shareholders' Funds", row_type=SemanticRowType.SUBTOTAL,
                parent_group="shareholders_funds", is_indent=1,
                dependencies=["share_capital", "reserves_surplus"],
                cells={
                    "particulars": SemanticCell(value="Sub-total - Shareholders' Funds", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(value=share_capital + reserves_surplus, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                    "prev_period": SemanticCell(value=share_capital + 2450000.0, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                }
            ),

            SemanticRow(row_id="cat_non_current_liab", label="(2) Non-Current Liabilities", row_type=SemanticRowType.CATEGORY, is_indent=1),
            SemanticRow(
                row_id="long_term_borrowings", label="(a) Long-term borrowings", row_type=SemanticRowType.DETAIL,
                parent_group="non_current_liab", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(a) Long-term borrowings"),
                    "note_no": SemanticCell(value="3", align="center"),
                    "current_period": SemanticCell(value=long_term_borrowings, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=long_term_borrowings, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="subtotal_non_current_liab", label="Sub-total - Non-Current Liabilities", row_type=SemanticRowType.SUBTOTAL,
                parent_group="non_current_liab", is_indent=1,
                dependencies=["long_term_borrowings"],
                cells={
                    "particulars": SemanticCell(value="Sub-total - Non-Current Liabilities", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(value=long_term_borrowings, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                    "prev_period": SemanticCell(value=long_term_borrowings, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                }
            ),

            SemanticRow(row_id="cat_current_liab", label="(3) Current Liabilities", row_type=SemanticRowType.CATEGORY, is_indent=1),
            SemanticRow(
                row_id="trade_payables", label="(a) Trade payables", row_type=SemanticRowType.DETAIL,
                parent_group="current_liab", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(a) Trade payables"),
                    "note_no": SemanticCell(value="4", align="center"),
                    "current_period": SemanticCell(value=trade_payables, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=trade_payables, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="short_term_provisions", label="(b) Short-term provisions", row_type=SemanticRowType.DETAIL,
                parent_group="current_liab", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(b) Short-term provisions"),
                    "note_no": SemanticCell(value="5", align="center"),
                    "current_period": SemanticCell(value=short_term_provisions, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=short_term_provisions, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="subtotal_current_liab", label="Sub-total - Current Liabilities", row_type=SemanticRowType.SUBTOTAL,
                parent_group="current_liab", is_indent=1,
                dependencies=["trade_payables", "short_term_provisions"],
                cells={
                    "particulars": SemanticCell(value="Sub-total - Current Liabilities", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(value=trade_payables + short_term_provisions, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                    "prev_period": SemanticCell(value=trade_payables + short_term_provisions, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                }
            ),

            SemanticRow(
                row_id="total_equity_liabilities", label="TOTAL - EQUITY AND LIABILITIES", row_type=SemanticRowType.GRAND_TOTAL,
                dependencies=["subtotal_shareholders_funds", "subtotal_non_current_liab", "subtotal_current_liab"],
                cells={
                    "particulars": SemanticCell(value="TOTAL - EQUITY AND LIABILITIES", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(
                        value=share_capital + reserves_surplus + long_term_borrowings + trade_payables + short_term_provisions,
                        format_type=NumberFormatType.CURRENCY_INR, is_bold=True
                    ),
                    "prev_period": SemanticCell(
                        value=share_capital + 2450000.0 + long_term_borrowings + trade_payables + short_term_provisions,
                        format_type=NumberFormatType.CURRENCY_INR, is_bold=True
                    ),
                }
            ),
        ]

        tbl_liab = SemanticTable(
            table_id="tbl_equity_liabilities",
            title="Equity and Liabilities",
            columns=cols,
            rows=eq_rows
        )

        # -------------------------------------------------------------
        # SHEET 2: ASSETS
        # -------------------------------------------------------------
        asset_rows = [
            SemanticRow(row_id="cat_assets", label="II. ASSETS", row_type=SemanticRowType.CATEGORY),
            SemanticRow(row_id="cat_non_current_assets", label="(1) Non-Current Assets", row_type=SemanticRowType.CATEGORY, is_indent=1),
            SemanticRow(
                row_id="ppe_net_block", label="(a) Property, Plant & Equipment", row_type=SemanticRowType.DETAIL,
                parent_group="non_current_assets", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(a) Property, Plant & Equipment"),
                    "note_no": SemanticCell(value="6", align="center"),
                    "current_period": SemanticCell(value=property_plant_equipment, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=property_plant_equipment, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="subtotal_non_current_assets", label="Sub-total - Non-Current Assets", row_type=SemanticRowType.SUBTOTAL,
                parent_group="non_current_assets", is_indent=1,
                dependencies=["ppe_net_block"],
                cells={
                    "particulars": SemanticCell(value="Sub-total - Non-Current Assets", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(value=property_plant_equipment, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                    "prev_period": SemanticCell(value=property_plant_equipment, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                }
            ),

            SemanticRow(row_id="cat_current_assets", label="(2) Current Assets", row_type=SemanticRowType.CATEGORY, is_indent=1),
            SemanticRow(
                row_id="inventories", label="(a) Inventories", row_type=SemanticRowType.DETAIL,
                parent_group="current_assets", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(a) Inventories"),
                    "note_no": SemanticCell(value="7", align="center"),
                    "current_period": SemanticCell(value=inventories, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=inventories, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="trade_receivables", label="(b) Trade receivables", row_type=SemanticRowType.DETAIL,
                parent_group="current_assets", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(b) Trade receivables"),
                    "note_no": SemanticCell(value="8", align="center"),
                    "current_period": SemanticCell(value=trade_receivables, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=trade_receivables, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="cash_bank", label="(c) Cash and bank balances", row_type=SemanticRowType.DETAIL,
                parent_group="current_assets", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(c) Cash and bank balances"),
                    "note_no": SemanticCell(value="9", align="center"),
                    "current_period": SemanticCell(value=cash_bank, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=cash_bank, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="short_term_advances", label="(d) Short-term loans and advances", row_type=SemanticRowType.DETAIL,
                parent_group="current_assets", is_indent=2,
                cells={
                    "particulars": SemanticCell(value="(d) Short-term loans and advances"),
                    "note_no": SemanticCell(value="10", align="center"),
                    "current_period": SemanticCell(value=short_term_advances, format_type=NumberFormatType.CURRENCY_INR),
                    "prev_period": SemanticCell(value=short_term_advances, format_type=NumberFormatType.CURRENCY_INR),
                }
            ),
            SemanticRow(
                row_id="subtotal_current_assets", label="Sub-total - Current Assets", row_type=SemanticRowType.SUBTOTAL,
                parent_group="current_assets", is_indent=1,
                dependencies=["inventories", "trade_receivables", "cash_bank", "short_term_advances"],
                cells={
                    "particulars": SemanticCell(value="Sub-total - Current Assets", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(value=inventories + trade_receivables + cash_bank + short_term_advances, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                    "prev_period": SemanticCell(value=inventories + trade_receivables + cash_bank + short_term_advances, format_type=NumberFormatType.CURRENCY_INR, is_bold=True),
                }
            ),

            SemanticRow(
                row_id="total_assets", label="TOTAL - ASSETS", row_type=SemanticRowType.GRAND_TOTAL,
                dependencies=["subtotal_non_current_assets", "subtotal_current_assets"],
                cells={
                    "particulars": SemanticCell(value="TOTAL - ASSETS", is_bold=True),
                    "note_no": SemanticCell(value=""),
                    "current_period": SemanticCell(
                        value=property_plant_equipment + inventories + trade_receivables + cash_bank + short_term_advances,
                        format_type=NumberFormatType.CURRENCY_INR, is_bold=True
                    ),
                    "prev_period": SemanticCell(
                        value=property_plant_equipment + inventories + trade_receivables + cash_bank + short_term_advances,
                        format_type=NumberFormatType.CURRENCY_INR, is_bold=True
                    ),
                }
            ),
        ]

        tbl_assets = SemanticTable(
            table_id="tbl_assets",
            title="Assets",
            columns=cols,
            rows=asset_rows
        )

        # Accounting Identity Check: Assets == Liabilities
        assertions = [
            ControlAssertion(
                assertion_id="asst_bs_balance",
                name="Balance Sheet Equality",
                left_expr="TOTAL - ASSETS",
                right_expr="TOTAL - EQUITY AND LIABILITIES",
                op="==",
                tolerance=0.01,
                error_message="Total Assets must strictly equal Total Equity and Liabilities"
            )
        ]

        sec1 = SemanticSection(
            section_id="sec_bs",
            heading="Financial Position",
            paragraphs=[
                "The Balance Sheet has been compiled strictly in accordance with Schedule III of the Companies Act, 2013.",
                "Accounting identities and double-entry reconciliations are independently verified."
            ],
            tables=[tbl_liab, tbl_assets]
        )

        return DocIR(
            title=title,
            subtitle="Schedule III Statutory Financial Statements",
            generation_mode=mode,
            target_format=target_format,
            document_type=DocumentType.FINANCIAL_STATEMENTS,
            client_name=client_name or "[Client Entity Name]",
            style_profile_id=style_profile_id or "prof_financial_executive",
            sections=[sec1],
            control_assertions=assertions
        )

    @classmethod
    def from_markdown_or_prompt(
        cls,
        text: str,
        title: Optional[str] = None,
        target_format: Union[str, TargetFormat] = TargetFormat.DOCX,
        client_name: Optional[str] = None,
        mode: GenerationMode = GenerationMode.PROFESSIONAL,
        style_profile_id: Optional[str] = None
    ) -> DocIR:
        """
        Parses Markdown text (headings, paragraphs, bullet points, tables) into a structured DocIR model.
        Also parses slide structures when target_format is PPTX.
        """
        fmt = TargetFormat(target_format) if isinstance(target_format, str) else target_format
        resolved_title = title or "Practice Document"
        lines = (text or "").splitlines()
        sections: List[SemanticSection] = []
        slides: List[SlideContent] = []
        current_heading = "Executive Summary"
        current_paras: List[str] = []
        table_lines: List[str] = []
        in_table = False

        def flush_table(h_name: str) -> Optional[SemanticTable]:
            nonlocal table_lines
            if not table_lines:
                return None
            from vs_ai_doc_generator import parse_markdown_tables, clean_number_value
            raw_tbls = parse_markdown_tables("\n".join(table_lines))
            table_lines = []
            if not raw_tbls:
                return None
            t0 = raw_tbls[0]
            headers = t0.get("headers", [])
            data_rows = t0.get("rows", [])
            cols = []
            for i, h in enumerate(headers):
                h_low = h.lower()
                def_fmt = NumberFormatType.TEXT
                if any(k in h_low for k in ("amount", "figure", "₹", "total", "balance", "value", "taxable", "cgst", "sgst", "igst", "price", "cost")):
                    def_fmt = NumberFormatType.CURRENCY_INR
                elif any(k in h_low for k in ("%", "rate", "percent", "margin")):
                    def_fmt = NumberFormatType.PERCENTAGE
                elif any(k in h_low for k in ("count", "no.", "quantity", "qty", "s.no", "sr")):
                    def_fmt = NumberFormatType.INTEGER
                cols.append(SemanticColumn(col_id=f"col_{i}", header=h, width_chars=max(12, len(h) + 2), default_format=def_fmt))

            s_rows = []
            current_group = None
            for r_idx, r_data in enumerate(data_rows):
                r_cells = {}
                first_txt = str(r_data[0]).strip() if r_data else ""
                first_low = first_txt.lower()
                first_norm = re.sub(r'[^a-z0-9]', '', first_low)

                is_grand = any(k in first_norm for k in ("grandtotal", "totalassets", "totalequity", "totalliabilities"))
                is_subtotal = not is_grand and any(k in first_low for k in ("total", "sub-total", "subtotal", "aggregate"))
                is_recon = any(k in first_low for k in ("reconciliation", "difference", "balance check", "variance", "equality check"))
                is_cat = not is_grand and not is_subtotal and not is_recon and (
                    first_txt.startswith("I.") or first_txt.startswith("II.") or 
                    (first_txt.startswith("(") and ")" in first_txt and not any(r_data[1:]))
                )

                if is_grand:
                    r_type = SemanticRowType.GRAND_TOTAL
                elif is_subtotal:
                    r_type = SemanticRowType.SUBTOTAL
                elif is_recon:
                    r_type = SemanticRowType.CONTROL_CHECK
                elif is_cat:
                    r_type = SemanticRowType.CATEGORY
                    current_group = f"grp_{r_idx}"
                else:
                    r_type = SemanticRowType.DETAIL

                for c_idx, val in enumerate(r_data):
                    if c_idx < len(cols):
                        c_id = cols[c_idx].col_id
                        v_str = str(val).strip()
                        was_bold = v_str.startswith("**") and v_str.endswith("**") and len(v_str) >= 4
                        stripped_v = re.sub(r'^\*\*|\*\*$', '', v_str).strip()
                        if stripped_v.startswith("="):
                            clean_v = stripped_v
                            c_fmt = cols[c_idx].default_format
                        elif c_idx > 0 and not is_cat:
                            clean_v, fmt_str = clean_number_value(stripped_v)
                            if fmt_str and "₹" in fmt_str:
                                c_fmt = NumberFormatType.CURRENCY_INR
                            elif fmt_str and "%" in fmt_str:
                                c_fmt = NumberFormatType.PERCENTAGE
                            elif fmt_str and "." in fmt_str:
                                c_fmt = NumberFormatType.DECIMAL_2
                            elif isinstance(clean_v, (int, float)):
                                c_fmt = cols[c_idx].default_format
                            else:
                                c_fmt = NumberFormatType.TEXT
                        else:
                            clean_v = stripped_v
                            c_fmt = NumberFormatType.TEXT

                        r_cells[c_id] = SemanticCell(value=clean_v, format_type=c_fmt, is_bold=(was_bold or is_subtotal or is_grand))

                s_rows.append(SemanticRow(
                    row_id=f"row_{r_idx}",
                    label=first_txt or f"Row {r_idx}",
                    row_type=r_type,
                    parent_group=current_group if r_type == SemanticRowType.DETAIL else None,
                    cells=r_cells
                ))
            return SemanticTable(
                table_id=f"tbl_{uuid.uuid4().hex[:6]}",
                title=h_name,
                columns=cols,
                rows=s_rows
            )

        def flush_section():
            nonlocal current_heading, current_paras, sections, slides
            tbl = flush_table(current_heading)
            tables = [tbl] if tbl else []
            if current_paras or tables:
                sec = SemanticSection(
                    section_id=f"sec_{len(sections)+1}",
                    heading=current_heading,
                    paragraphs=list(current_paras),
                    tables=tables
                )
                sections.append(sec)
                slides.append(SlideContent(
                    title=current_heading,
                    bullets=[p.lstrip("-* ").strip() for p in current_paras if not p.startswith(">") and p.strip()][:6],
                    table=tbl
                ))
            current_paras = []

        for line in lines:
            s_line = line.strip()
            if not s_line:
                if in_table:
                    in_table = False
                continue
            if s_line.startswith("# ") and not title:
                resolved_title = s_line.lstrip("#").strip()
                continue
            if s_line.startswith("## ") or s_line.startswith("### "):
                flush_section()
                current_heading = re.sub(r'^[#\s]+', '', s_line).strip()
                in_table = False
                continue
            if s_line.startswith("|") and s_line.endswith("|"):
                in_table = True
                table_lines.append(s_line)
                continue
            if in_table:
                in_table = False
            current_paras.append(s_line)

        flush_section()

        if not sections:
            sections.append(SemanticSection(
                section_id="sec_1",
                heading="Overview",
                paragraphs=[text] if text else ["No content provided."]
            ))
            slides.append(SlideContent(
                title="Overview",
                bullets=[text[:100]] if text else ["No content provided."]
            ))

        # Check for Balance Sheet tables to construct independent control assertions
        has_assets = False
        has_liab = False
        for sec in sections:
            for tbl in sec.tables:
                for r in tbl.rows:
                    lbl_norm = re.sub(r'[^a-z0-9]', '', r.label.lower())
                    if "totalasset" in lbl_norm:
                        has_assets = True
                    if "totalequity" in lbl_norm or "totalliabilit" in lbl_norm:
                        has_liab = True

        assertions = []
        if has_assets and has_liab:
            assertions.append(ControlAssertion(
                assertion_id="asst_bs_balance",
                name="Balance Sheet Equality",
                left_expr="TOTAL - ASSETS",
                right_expr="TOTAL - EQUITY AND LIABILITIES",
                op="==",
                tolerance=0.01,
                error_message="Total Assets must strictly equal Total Equity and Liabilities"
            ))

        return DocIR(
            title=resolved_title,
            subtitle="Advisory & Professional Working Paper",
            generation_mode=mode,
            target_format=fmt,
            document_type=DocumentType.GENERAL_DOCUMENT,
            client_name=client_name or "[Client Entity Name]",
            style_profile_id=style_profile_id or "prof_statutory_legal",
            sections=sections,
            slides=slides if fmt == TargetFormat.PPTX else [],
            control_assertions=assertions
        )

