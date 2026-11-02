"""
Bank Statement Parsers for VS Database Automation
Supports:
1. PDF statements (tabular and line-wrapped text extraction via pypdf / pymupdf)
2. Excel statements (.xlsx via openpyxl and .xls)
3. CSV statements (with delimiter detection and multi-currency/format handling)
4. XML statements (structured bank statements)

Normalizes dates, amounts with precise Decimal arithmetic, reference/UTR detection,
and computes deterministic reconciliation checks.
"""

from __future__ import annotations
import re
import csv
import io
import json
import logging
from decimal import Decimal, InvalidOperation
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("vs_database.statement_parser")

DATE_PATTERNS = [
    r"\b(\d{2}[-/.]\d{2}[-/.]\d{4})\b",
    r"\b(\d{4}[-/.]\d{2}[-/.]\d{2})\b",
    r"\b(\d{2}[-/.]\d{2}[-/.]\d{2})\b",
    r"\b(\d{2}-[A-Za-z]{3}-\d{4})\b",
    r"\b(\d{2}\s+[A-Za-z]{3}\s+\d{4})\b",
    r"\b(\d{2}-[A-Za-z]{3}-\d{2})\b"
]

def parse_decimal_safe(val: Any) -> Decimal:
    """Robustly parses currency/amount strings into Decimal without binary floating-point drift."""
    if val is None:
        return Decimal("0.00")
    if isinstance(val, (int, float)):
        return Decimal(str(val)).quantize(Decimal("0.01"))
    if isinstance(val, Decimal):
        return val.quantize(Decimal("0.01"))
    s = str(val).strip()
    if not s or s in ("-", "--", "NA", "N/A", "Nil", "nil", "None"):
        return Decimal("0.00")
    
    sc = s.strip()
    is_negative = sc.startswith("-") or sc.endswith("-") or (sc.startswith("(") and sc.endswith(")"))
    
    m = re.search(r"([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)", sc)
    if not m:
        return Decimal("0.00")
    
    clean_num = m.group(1).replace(",", "")
    try:
        dec = Decimal(clean_num)
        if is_negative:
            dec = -dec
        return dec.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")

def normalize_date_string(date_str: str) -> Optional[str]:
    """Normalizes dates into standard YYYY-MM-DD format."""
    if not date_str:
        return None
    s = str(date_str).strip()
    formats = [
        "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
        "%Y-%m-%d", "%Y/%m/%d",
        "%d/%m/%y", "%d-%m-%y",
        "%d-%b-%Y", "%d %b %Y", "%d-%B-%Y",
        "%d-%b-%y", "%d %b %y",
        "%d/%m/%Y %H:%M:%S", "%d-%m-%Y %H:%M:%S",
        "%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %I:%M %p"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(s, fmt)
            # Handle 2-digit years reasonably
            if dt.year < 100:
                dt = dt.replace(year=dt.year + 2000)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
            
    # Substring regex match for dates embedded within strings or table cells
    m = re.search(r"(\d{1,2}[-/.\s][A-Za-z]{3,9}[-/.\s]\d{2,4})", s)
    if not m:
        m = re.search(r"(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})", s)
    if m:
        sub_s = m.group(1).strip()
        for fmt in formats:
            try:
                dt = datetime.strptime(sub_s, fmt)
                if dt.year < 100:
                    dt = dt.replace(year=dt.year + 2000)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
    return None

def extract_reference_number(narration: str) -> Optional[str]:
    """Detects UTR, Cheque No, UPI ref, IMPS, NEFT, RTGS, or POS transaction ID."""
    if not narration:
        return None
    # UPI ref
    m = re.search(r"\b(?:UPI|UPI/|UPI-)[A-Za-z0-9]*/?(\d{10,14})\b", narration, re.IGNORECASE)
    if m:
        return m.group(1)
    # UTR
    m = re.search(r"\bUTR[:/\s-]*([A-Z0-9]{12,22})\b", narration, re.IGNORECASE)
    if m:
        return m.group(1)
    # Cheque number
    m = re.search(r"\b(?:CHQ|CHEQUE|CHQ\s*NO)[:/\s-]*(\d{6})\b", narration, re.IGNORECASE)
    if m:
        return m.group(1)
    # General alphanumeric transaction ref
    m = re.search(r"\b(?:NEFT|RTGS|IMPS)[/ -]+([A-Za-z0-9]{8,22})\b", narration, re.IGNORECASE)
    if m:
        return m.group(1)
    return None

class BankStatementParser:

    @classmethod
    def parse_file(cls, file_path: Path, original_filename: str) -> Dict[str, Any]:
        """Auto-detects format and routes to appropriate parser."""
        ext = original_filename.lower().split(".")[-1]
        if ext == "csv":
            return cls.parse_csv(file_path)
        elif ext in ("xlsx", "xls"):
            return cls.parse_excel(file_path)
        elif ext == "pdf":
            return cls.parse_pdf(file_path)
        elif ext == "xml":
            return cls.parse_xml(file_path)
        else:
            return {
                "ok": False,
                "error": f"Unsupported file extension: .{ext}. Supported formats: PDF, Excel (.xlsx/.xls), CSV, XML"
            }

    @classmethod
    def parse_csv(cls, file_path: Path) -> Dict[str, Any]:
        """Parses CSV bank statement with robust delimiter detection."""
        try:
            with open(file_path, "r", encoding="utf-8-sig", errors="replace") as f:
                content = f.read()
        except Exception as e:
            return {"ok": False, "error": f"Failed to read CSV file: {e}"}

        lines = [line.strip() for line in content.splitlines() if line.strip()]
        if not lines:
            return {"ok": False, "error": "CSV file is empty"}

        # Detect delimiter (comma, semicolon, tab)
        sample = "\n".join(lines[:10])
        delimiter = ","
        for d in [",", "\t", ";"]:
            if sample.count(d) > sample.count(delimiter):
                delimiter = d

        reader = csv.reader(io.StringIO(content), delimiter=delimiter)
        raw_rows = list(reader)

        # Detect header row
        header_idx = -1
        col_map = {}
        for idx, row in enumerate(raw_rows[:25]):
            row_lower = [str(c).strip().lower() for c in row]
            has_date = any("date" in c for c in row_lower)
            has_narration = any(any(k in c for k in ("narration", "particular", "description", "details", "remarks")) for c in row_lower)
            has_amount = any(any(k in c for k in ("debit", "credit", "withdrawal", "deposit", "amount", "dr", "cr")) for c in row_lower)
            if has_date and (has_narration or has_amount):
                header_idx = idx
                for c_idx, col_name in enumerate(row_lower):
                    if "date" in col_name and "value" not in col_name and "txn" not in col_map:
                        col_map["txn_date"] = c_idx
                    elif "value date" in col_name:
                        col_map["val_date"] = c_idx
                    elif any(k in col_name for k in ("narration", "particular", "description", "details", "remarks")):
                        col_map["narration"] = c_idx
                    elif any(k in col_name for k in ("chq", "cheque", "ref")):
                        col_map["ref"] = c_idx
                    elif any(k in col_name for k in ("debit", "withdrawal", "dr")):
                        col_map["debit"] = c_idx
                    elif any(k in col_name for k in ("credit", "deposit", "cr")):
                        col_map["credit"] = c_idx
                    elif "balance" in col_name:
                        col_map["balance"] = c_idx
                    elif "amount" in col_name and "debit" not in col_map:
                        col_map["amount"] = c_idx
                break

        if header_idx == -1:
            return {"ok": False, "error": "Unable to identify bank statement header columns in CSV"}

        transactions = []
        for r_idx, row in enumerate(raw_rows[header_idx + 1:], start=header_idx + 2):
            if not row or all(not str(c).strip() for c in row):
                continue
            
            raw_date = row[col_map["txn_date"]] if "txn_date" in col_map and col_map["txn_date"] < len(row) else ""
            norm_date = normalize_date_string(raw_date)
            if not norm_date:
                continue # Likely a summary or footer row

            narration = row[col_map["narration"]] if "narration" in col_map and col_map["narration"] < len(row) else ""
            narration = str(narration).strip()

            ref = row[col_map["ref"]] if "ref" in col_map and col_map["ref"] < len(row) else ""
            ref = str(ref).strip() or extract_reference_number(narration)

            debit = Decimal("0.00")
            credit = Decimal("0.00")

            if "debit" in col_map and col_map["debit"] < len(row):
                debit = parse_decimal_safe(row[col_map["debit"]])
            if "credit" in col_map and col_map["credit"] < len(row):
                credit = parse_decimal_safe(row[col_map["credit"]])

            # Single amount column with Dr/Cr indicator
            if debit == Decimal("0.00") and credit == Decimal("0.00") and "amount" in col_map and col_map["amount"] < len(row):
                raw_amt = str(row[col_map["amount"]]).strip()
                parsed_amt = parse_decimal_safe(raw_amt)
                if "dr" in raw_amt.lower() or parsed_amt < 0:
                    debit = abs(parsed_amt)
                else:
                    credit = abs(parsed_amt)

            balance = None
            if "balance" in col_map and col_map["balance"] < len(row):
                balance = parse_decimal_safe(row[col_map["balance"]])

            net_amount = credit - debit

            transactions.append({
                "row_index": r_idx,
                "txn_date": norm_date,
                "value_date": norm_date,
                "original_narration": narration,
                "normalized_narration": re.sub(r"\s+", " ", narration).strip(),
                "ref_number": ref or "",
                "debit_amount": float(debit),
                "credit_amount": float(credit),
                "net_amount": float(net_amount),
                "running_balance": float(balance) if balance is not None else None
            })

        return cls._compile_extraction_result(transactions)

    @classmethod
    def parse_excel(cls, file_path: Path) -> Dict[str, Any]:
        """Parses Excel workbook (.xlsx / .xls) via openpyxl."""
        try:
            import openpyxl
        except ImportError:
            return {"ok": False, "error": "openpyxl library is required for Excel parsing"}

        try:
            wb = openpyxl.load_workbook(file_path, data_only=True)
            sheet = wb.active
        except Exception as e:
            return {"ok": False, "error": f"Failed to load Excel workbook: {e}"}

        raw_rows = []
        for row in sheet.iter_rows(values_only=True):
            raw_rows.append([str(c) if c is not None else "" for c in row])

        if not raw_rows:
            return {"ok": False, "error": "Excel sheet is empty"}

        # Search for header
        header_idx = -1
        col_map = {}
        for idx, row in enumerate(raw_rows[:25]):
            row_lower = [str(c).strip().lower() for c in row]
            has_date = any("date" in c for c in row_lower)
            has_narration = any(any(k in c for k in ("narration", "particular", "description", "details", "remarks")) for c in row_lower)
            has_amount = any(any(k in c for k in ("debit", "credit", "withdrawal", "deposit", "amount", "dr", "cr")) for c in row_lower)
            if has_date and (has_narration or has_amount):
                header_idx = idx
                for c_idx, col_name in enumerate(row_lower):
                    if "date" in col_name and "value" not in col_name and "txn_date" not in col_map:
                        col_map["txn_date"] = c_idx
                    elif "value date" in col_name:
                        col_map["val_date"] = c_idx
                    elif any(k in col_name for k in ("narration", "particular", "description", "details", "remarks")):
                        col_map["narration"] = c_idx
                    elif any(k in col_name for k in ("chq", "cheque", "ref")):
                        col_map["ref"] = c_idx
                    elif any(k in col_name for k in ("debit", "withdrawal", "dr")):
                        col_map["debit"] = c_idx
                    elif any(k in col_name for k in ("credit", "deposit", "cr")):
                        col_map["credit"] = c_idx
                    elif "balance" in col_name:
                        col_map["balance"] = c_idx
                    elif "amount" in col_name and "debit" not in col_map:
                        col_map["amount"] = c_idx
                break

        if header_idx == -1:
            return {"ok": False, "error": "Unable to identify bank statement header columns in Excel sheet"}

        transactions = []
        for r_idx, row in enumerate(raw_rows[header_idx + 1:], start=header_idx + 2):
            if not row or all(not str(c).strip() for c in row):
                continue
            raw_date = row[col_map["txn_date"]] if "txn_date" in col_map and col_map["txn_date"] < len(row) else ""
            norm_date = normalize_date_string(raw_date)
            if not norm_date:
                continue

            narration = row[col_map["narration"]] if "narration" in col_map and col_map["narration"] < len(row) else ""
            narration = str(narration).strip()

            ref = row[col_map["ref"]] if "ref" in col_map and col_map["ref"] < len(row) else ""
            ref = str(ref).strip() or extract_reference_number(narration)

            debit = Decimal("0.00")
            credit = Decimal("0.00")

            if "debit" in col_map and col_map["debit"] < len(row):
                debit = parse_decimal_safe(row[col_map["debit"]])
            if "credit" in col_map and col_map["credit"] < len(row):
                credit = parse_decimal_safe(row[col_map["credit"]])

            if debit == Decimal("0.00") and credit == Decimal("0.00") and "amount" in col_map and col_map["amount"] < len(row):
                raw_amt = str(row[col_map["amount"]]).strip()
                parsed_amt = parse_decimal_safe(raw_amt)
                if "dr" in raw_amt.lower() or parsed_amt < 0:
                    debit = abs(parsed_amt)
                else:
                    credit = abs(parsed_amt)

            balance = None
            if "balance" in col_map and col_map["balance"] < len(row):
                balance = parse_decimal_safe(row[col_map["balance"]])

            net_amount = credit - debit

            transactions.append({
                "row_index": r_idx,
                "txn_date": norm_date,
                "value_date": norm_date,
                "original_narration": narration,
                "normalized_narration": re.sub(r"\s+", " ", narration).strip(),
                "ref_number": ref or "",
                "debit_amount": float(debit),
                "credit_amount": float(credit),
                "net_amount": float(net_amount),
                "running_balance": float(balance) if balance is not None else None
            })

        return cls._compile_extraction_result(transactions)

    @classmethod
    def parse_pdf(cls, file_path: Path) -> Dict[str, Any]:
        """Parses digital or text-based PDF using PyMuPDF table extraction, spatial reconstruction, or fallback regex."""
        # Tier 1 & 2: PyMuPDF high-fidelity extraction
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(str(file_path))
            tier1_txns = cls._parse_pdf_tables(doc)
            if tier1_txns:
                return cls._compile_extraction_result(tier1_txns)

            tier2_txns = cls._parse_pdf_spatial(doc)
            if tier2_txns:
                return cls._compile_extraction_result(tier2_txns)
        except Exception as e:
            logger.warning(f"PyMuPDF structured extraction encountered exception: {e}")

        # Tier 3: Text stream line parsing (PyMuPDF text or pypdf)
        lines = []
        try:
            import fitz
            doc = fitz.open(str(file_path))
            for page in doc:
                text = page.get_text("text")
                if text:
                    lines.extend(text.splitlines())
        except Exception:
            try:
                import pypdf
                reader = pypdf.PdfReader(str(file_path))
                for page in reader.pages:
                    text = page.extract_text()
                    if text:
                        lines.extend(text.splitlines())
            except Exception as e:
                return {"ok": False, "error": f"Failed to extract text from PDF: {e}"}

        if not lines:
            return {"ok": False, "error": "PDF has no selectable text. Scanned PDFs require OCR preprocessing."}

        tier3_txns = cls._parse_text_lines(lines)
        if not tier3_txns:
            return {"ok": False, "error": "No transaction records could be parsed from the PDF layout."}

        return cls._compile_extraction_result(tier3_txns)

    @classmethod
    def _parse_pdf_tables(cls, doc) -> List[Dict[str, Any]]:
        """Extracts transactions using PyMuPDF's built-in table detector."""
        transactions = []
        active_col_map = {}
        expected_cols = 0
        curr_txn = None

        for page in doc:
            try:
                tab_finder = page.find_tables()
            except Exception:
                continue
            if not tab_finder or not tab_finder.tables:
                continue

            for tab in tab_finder.tables:
                rows = tab.extract()
                if not rows or len(rows) < 1:
                    continue

                # Detect header row in first 5 rows
                header_row_idx = -1
                table_col_map = {}
                for r_idx, row in enumerate(rows[:5]):
                    row_str = [str(c or "").strip().lower() for c in row]
                    has_date = any("date" in c for c in row_str)
                    has_amt = any(any(k in c for k in ("debit", "credit", "withdrawal", "deposit", "amount", "balance", "dr", "cr")) for c in row_str)
                    if has_date and has_amt:
                        header_row_idx = r_idx
                        for c_idx, c_val in enumerate(row_str):
                            if "date" in c_val and "value" not in c_val and "val" not in c_val and "txn_date" not in table_col_map:
                                table_col_map["txn_date"] = c_idx
                            elif "value date" in c_val or "val date" in c_val or "val dt" in c_val:
                                table_col_map["val_date"] = c_idx
                            elif any(k in c_val for k in ("narration", "particular", "description", "details", "remarks")):
                                table_col_map["narration"] = c_idx
                            elif any(k in c_val for k in ("chq", "cheque", "ref", "reference", "utr")):
                                table_col_map["ref"] = c_idx
                            elif any(k in c_val for k in ("debit", "withdrawal", "dr")):
                                table_col_map["debit"] = c_idx
                            elif any(k in c_val for k in ("credit", "deposit", "cr")):
                                table_col_map["credit"] = c_idx
                            elif "balance" in c_val:
                                table_col_map["balance"] = c_idx
                            elif "amount" in c_val and "debit" not in table_col_map:
                                table_col_map["amount"] = c_idx
                        break

                if header_row_idx != -1:
                    active_col_map = table_col_map
                    expected_cols = len(rows[header_row_idx])
                    data_rows = rows[header_row_idx + 1:]
                elif active_col_map and len(rows[0]) == expected_cols:
                    data_rows = rows
                else:
                    continue

                for row in data_rows:
                    if not row or all(not str(c or "").strip() for c in row):
                        continue

                    date_idx = active_col_map.get("txn_date")
                    raw_d = str(row[date_idx] or "").strip() if date_idx is not None and date_idx < len(row) else ""
                    norm_d = normalize_date_string(raw_d)

                    narr_idx = active_col_map.get("narration")
                    narration = re.sub(r"\s+", " ", str(row[narr_idx] or "")).strip() if narr_idx is not None and narr_idx < len(row) else ""

                    ref_idx = active_col_map.get("ref")
                    ref = str(row[ref_idx] or "").strip() if ref_idx is not None and ref_idx < len(row) else ""

                    debit = Decimal("0.00")
                    credit = Decimal("0.00")
                    if "debit" in active_col_map and active_col_map["debit"] < len(row):
                        debit = parse_decimal_safe(str(row[active_col_map["debit"]] or ""))
                    if "credit" in active_col_map and active_col_map["credit"] < len(row):
                        credit = parse_decimal_safe(str(row[active_col_map["credit"]] or ""))

                    # Single amount column
                    if debit == Decimal("0.00") and credit == Decimal("0.00") and "amount" in active_col_map and active_col_map["amount"] < len(row):
                        raw_a = str(row[active_col_map["amount"]] or "")
                        parsed_a = parse_decimal_safe(raw_a)
                        if "dr" in raw_a.lower() or parsed_a < 0:
                            debit = abs(parsed_a)
                        else:
                            credit = abs(parsed_a)

                    balance = None
                    if "balance" in active_col_map and active_col_map["balance"] < len(row):
                        bal_str = str(row[active_col_map["balance"]] or "")
                        if re.search(r"\d", bal_str):
                            balance = parse_decimal_safe(bal_str)

                    if norm_d and (debit > Decimal("0.00") or credit > Decimal("0.00") or balance is not None):
                        curr_txn = {
                            "row_index": len(transactions) + 1,
                            "txn_date": norm_d,
                            "value_date": norm_d,
                            "original_narration": narration,
                            "normalized_narration": narration,
                            "ref_number": ref or extract_reference_number(narration) or "",
                            "debit_amount": float(debit),
                            "credit_amount": float(credit),
                            "net_amount": float(credit - debit),
                            "running_balance": float(balance) if balance is not None else None
                        }
                        transactions.append(curr_txn)
                    elif curr_txn and narration and not norm_d and debit == Decimal("0.00") and credit == Decimal("0.00"):
                        if not any(k in narration.lower() for k in ("total", "opening balance", "closing balance", "page")):
                            curr_txn["original_narration"] += " " + narration
                            curr_txn["normalized_narration"] = re.sub(r"\s+", " ", curr_txn["original_narration"]).strip()
                            if not curr_txn["ref_number"]:
                                curr_txn["ref_number"] = extract_reference_number(curr_txn["original_narration"]) or ""

        return transactions

    @classmethod
    def _parse_pdf_spatial(cls, doc) -> List[Dict[str, Any]]:
        """Reconstructs rows from visual 2D word coordinates."""
        spatial_lines = []
        for page in doc:
            try:
                words = page.get_text("words")
            except Exception:
                continue
            if not words:
                continue

            words.sort(key=lambda w: (w[1], w[0]))
            lines_on_page = []
            cur_line = []
            cur_y = None
            for w in words:
                if cur_y is None or abs(w[1] - cur_y) <= 4.0:
                    cur_line.append(w)
                    if cur_y is None:
                        cur_y = w[1]
                else:
                    cur_line.sort(key=lambda item: item[0])
                    lines_on_page.append(" ".join(item[4] for item in cur_line))
                    cur_line = [w]
                    cur_y = w[1]
            if cur_line:
                cur_line.sort(key=lambda item: item[0])
                lines_on_page.append(" ".join(item[4] for item in cur_line))

            spatial_lines.extend(lines_on_page)

        return cls._parse_text_lines(spatial_lines)

    @classmethod
    def _parse_text_lines(cls, lines: List[str]) -> List[Dict[str, Any]]:
        """Parses sequential text lines using enhanced regex matching."""
        date_pattern = re.compile(r"\b(\d{1,2}[-/.\s](?:[A-Za-z]{3,9}|\d{1,2})[-/.\s]\d{2,4})\b")
        amt_pattern = re.compile(r"(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})")

        transactions = []
        curr_txn = None
        row_counter = 1

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue

            m_date = date_pattern.search(line_str)
            if m_date:
                raw_d = m_date.group(1)
                norm_d = normalize_date_string(raw_d)
                if norm_d:
                    amounts = amt_pattern.findall(line_str)
                    if len(amounts) >= 1:
                        debit = Decimal("0.00")
                        credit = Decimal("0.00")
                        balance = None

                        if len(amounts) == 1:
                            amt = parse_decimal_safe(amounts[0])
                            if any(k in line_str.lower() for k in ("dr", "withdrawal", "debit")):
                                debit = amt
                            else:
                                credit = amt
                        elif len(amounts) == 2:
                            a1 = parse_decimal_safe(amounts[0])
                            a2 = parse_decimal_safe(amounts[1])
                            if "dr" in line_str.lower():
                                debit = a1
                                balance = a2
                            elif "cr" in line_str.lower():
                                credit = a1
                                balance = a2
                            else:
                                debit = a1
                                credit = a2
                        elif len(amounts) >= 3:
                            debit = parse_decimal_safe(amounts[-3])
                            credit = parse_decimal_safe(amounts[-2])
                            balance = parse_decimal_safe(amounts[-1])

                        narration_part = line_str
                        narration_part = narration_part.replace(raw_d, "")
                        for a in amounts:
                            narration_part = narration_part.replace(a, "")
                        narration_part = re.sub(r"(?i)\b(?:cr|dr|inr|rs\.?)\b", "", narration_part)
                        narration_part = re.sub(r"\s+", " ", narration_part).strip()

                        ref = extract_reference_number(narration_part)

                        curr_txn = {
                            "row_index": row_counter,
                            "txn_date": norm_d,
                            "value_date": norm_d,
                            "original_narration": narration_part,
                            "normalized_narration": narration_part,
                            "ref_number": ref or "",
                            "debit_amount": float(debit),
                            "credit_amount": float(credit),
                            "net_amount": float(credit - debit),
                            "running_balance": float(balance) if balance is not None else None
                        }
                        transactions.append(curr_txn)
                        row_counter += 1
                        continue

            if curr_txn and not any(k in line_str.lower() for k in ("page ", "statement summary", "account number", "opening balance", "closing balance", "total debits", "total credits")):
                curr_txn["original_narration"] += " " + line_str
                curr_txn["normalized_narration"] = re.sub(r"\s+", " ", curr_txn["original_narration"]).strip()
                if not curr_txn["ref_number"]:
                    curr_txn["ref_number"] = extract_reference_number(curr_txn["original_narration"]) or ""

        return transactions

    @classmethod
    def parse_xml(cls, file_path: Path) -> Dict[str, Any]:
        """Parses XML statements (CAMT.053 or standard XML structures)."""
        import xml.etree.ElementTree as ET
        try:
            tree = ET.parse(file_path)
            root = tree.getroot()
        except Exception as e:
            return {"ok": False, "error": f"Invalid XML statement format: {e}"}

        transactions = []
        row_counter = 1
        # Generic scan for transaction nodes
        for node in root.iter():
            tag = node.tag.split("}")[-1].lower()
            if tag in ("ntry", "transaction", "stmtentry", "row"):
                date_val = None
                narration = ""
                debit = Decimal("0.00")
                credit = Decimal("0.00")
                ref = ""

                for child in node.iter():
                    c_tag = child.tag.split("}")[-1].lower()
                    c_txt = (child.text or "").strip()
                    if not c_txt:
                        continue
                    if "date" in c_tag and not date_val:
                        date_val = normalize_date_string(c_txt)
                    elif any(k in c_tag for k in ("desc", "narr", "details", "ustrd", "particular")):
                        narration += " " + c_txt
                    elif any(k in c_tag for k in ("ref", "acctsvcrref", "endtoendid")):
                        ref = c_txt
                    elif "amt" in c_tag or "amount" in c_tag:
                        amt = parse_decimal_safe(c_txt)
                        # Check Dr/Cr indicator in attribute or sibling
                        indicator = child.attrib.get("CdtDbtInd", "").upper()
                        if indicator == "DBIT" or "dr" in c_txt.lower():
                            debit = amt
                        else:
                            credit = amt

                if date_val and (debit > 0 or credit > 0):
                    transactions.append({
                        "row_index": row_counter,
                        "txn_date": date_val,
                        "value_date": date_val,
                        "original_narration": narration.strip(),
                        "normalized_narration": re.sub(r"\s+", " ", narration).strip(),
                        "ref_number": ref or extract_reference_number(narration) or "",
                        "debit_amount": float(debit),
                        "credit_amount": float(credit),
                        "net_amount": float(credit - debit),
                        "running_balance": None
                    })
                    row_counter += 1

        if not transactions:
            return {"ok": False, "error": "No recognized statement transaction nodes found in XML."}

        return cls._compile_extraction_result(transactions)

    @classmethod
    def _compile_extraction_result(cls, transactions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculates deterministic totals, running balance reconciliation, and dates."""
        if not transactions:
            return {"ok": False, "error": "No transactions extracted"}

        total_debits = sum(Decimal(str(t["debit_amount"])) for t in transactions)
        total_credits = sum(Decimal(str(t["credit_amount"])) for t in transactions)
        
        dates = [t["txn_date"] for t in transactions if t.get("txn_date")]
        dates.sort()
        from_date = dates[0] if dates else None
        to_date = dates[-1] if dates else None

        # Check running balance reconciliation where available
        reconciliation_status = "unverified"
        opening_bal = None
        closing_bal = None
        calc_diff = Decimal("0.00")

        first_bal = transactions[0].get("running_balance")
        last_bal = transactions[-1].get("running_balance")

        if first_bal is not None and last_bal is not None:
            # First transaction: Opening balance = first running_bal - (credit - debit)
            t0_net = Decimal(str(transactions[0]["credit_amount"])) - Decimal(str(transactions[0]["debit_amount"]))
            opening_bal = Decimal(str(first_bal)) - t0_net
            closing_bal = Decimal(str(last_bal))
            expected_closing = opening_bal + total_credits - total_debits
            calc_diff = abs(closing_bal - expected_closing)
            if calc_diff < Decimal("0.05"):
                reconciliation_status = "verified"
            else:
                reconciliation_status = "difference_detected"

        return {
            "ok": True,
            "transactions": transactions,
            "count": len(transactions),
            "from_date": from_date,
            "to_date": to_date,
            "total_debits": float(total_debits),
            "total_credits": float(total_credits),
            "opening_balance": float(opening_bal) if opening_bal is not None else None,
            "closing_balance": float(closing_bal) if closing_bal is not None else None,
            "calculated_difference": float(calc_diff),
            "reconciliation_status": reconciliation_status
        }
