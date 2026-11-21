"""
VS AI Clarification Engine 2.1 - Regression Test Suite (Tests A to J)
Verifies:
- Answered-Fact Persistence
- Elimination of Duplicate Question Loop
- Distinct Concepts (Receipts, Turnover, Net Loss, Income)
- Provenance Protection
- Contradiction Detection
- GST Inward vs Outward Direction Handling
"""

import sys
import os
import tempfile
import sqlite3
from pathlib import Path

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from vs_ai_clarification import (
    FactExtractor,
    FactRepository,
    ContradictionDetector,
    ClarificationEngine,
    TaxFact
)

def run_tests():
    print("=" * 60)
    print("STARTING VS AI CLARIFICATION ENGINE 2.1 REGRESSION SUITE")
    print("=" * 60)

    db_path = Path("test_clarif_temp.db")
    if db_path.exists():
        try:
            db_path.unlink()
        except Exception:
            pass

    # Initialize tables
    with sqlite3.connect(db_path) as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_conversation_facts (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                fact_key TEXT NOT NULL,
                fact_value TEXT NOT NULL,
                fact_type TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL,
                raw_text TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(conversation_id, fact_key)
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS ai_clarification_sessions (
                session_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                domain TEXT NOT NULL,
                known_facts_json TEXT,
                missing_facts_json TEXT,
                questions_json TEXT,
                status TEXT NOT NULL,
                answers_json TEXT,
                round_number INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        con.commit()

    engine = ClarificationEngine(db_path)
    extractor = FactExtractor()
    repo = FactRepository(db_path)

    # ----------------------------------------------------
    # TEST A: Natural Language Custom Answer Extraction
    # ----------------------------------------------------
    print("\n[TEST A] Verifying NL extraction: 'My business receipts were around ₹4 lakh and I had a loss of ₹2 lakh.'")
    text_a = "My business receipts were around ₹4 lakh and I had a loss of ₹2 lakh."
    facts_a = extractor.extract_from_prompt(text_a, default_source="user_custom")

    assert "primary_activity" in facts_a, "primary_activity missing in facts_a"
    assert facts_a["primary_activity"].value == "business", f"Expected 'business', got {facts_a['primary_activity'].value}"
    
    assert "gross_receipts" in facts_a, "gross_receipts missing in facts_a"
    gr = facts_a["gross_receipts"].value
    assert isinstance(gr, dict), "gross_receipts should be an object"
    assert gr["value"] == 400000, f"Expected 400000, got {gr['value']}"
    assert gr["approximate"] is True, "Expected approximate == True"
    assert gr["currency"] == "INR", "Expected currency == INR"

    assert "business_result" in facts_a, "business_result missing in facts_a"
    assert facts_a["business_result"].value == "loss", f"Expected 'loss', got {facts_a['business_result'].value}"

    assert "net_business_loss" in facts_a, "net_business_loss missing in facts_a"
    nbl = facts_a["net_business_loss"].value
    assert isinstance(nbl, dict), "net_business_loss should be an object"
    assert nbl["value"] == 200000, f"Expected 200000, got {nbl['value']}"
    assert nbl["approximate"] is True, "Expected approximate == True"
    assert nbl["currency"] == "INR", "Expected currency == INR"
    print("✓ TEST A PASSED: All structured facts accurately extracted with exact types.")

    # ----------------------------------------------------
    # TEST B: Clarification Engine Does Not Re-Ask Gross Receipts
    # ----------------------------------------------------
    print("\n[TEST B] Verifying duplicate question prevention on gross receipts")
    cid_b = "conv_test_b_001"
    prompt_b1 = "My friend told me that if I don't have any profit then I don't have to file a return. Is that true? I didn't earn much this year so I'm confused."
    needs_c1, q1_list, facts_b1, domain_b1 = engine.evaluate_materiality(prompt_b1, cid_b)
    
    assert needs_c1 is True, "Round 1 should require clarification"
    q_ids_r1 = [q["id"] for q in q1_list]
    print(f"Round 1 Questions Asked: {q_ids_r1}")
    assert any("receipts" in qid or "income" in qid for qid in q_ids_r1), "Round 1 should ask about income or receipts"

    # User replies with custom answer in Round 2
    prompt_b2 = "My business receipts were around ₹4 lakh and I had a loss of ₹2 lakh."
    needs_c2, q2_list, facts_b2, domain_b2 = engine.evaluate_materiality(prompt_b2, cid_b)

    q_ids_r2 = [q["id"] for q in q2_list]
    print(f"Round 2 Questions Asked: {q_ids_r2}")
    # MUST NOT RE-ASK gross receipts or income range!
    assert "approx_gross_receipts" not in q_ids_r2, "Engine re-asked approx_gross_receipts!"
    assert "approx_income_range" not in q_ids_r2, "Engine re-asked approx_income_range!"
    assert "financial_result_status" not in q_ids_r2, "Engine re-asked financial_result_status!"
    assert "primary_income_source" not in q_ids_r2, "Engine re-asked primary_income_source!"
    
    # Must ask loss_carry_forward_intent
    assert "loss_carry_forward_intent" in q_ids_r2, "Engine should ask loss_carry_forward_intent in Round 2"
    print("✓ TEST B PASSED: Gross receipts not re-asked, progressive follow-up initiated.")

    # ----------------------------------------------------
    # TEST C: MCQ Answer 'Business / Trading / Shop' sets primary_activity
    # ----------------------------------------------------
    print("\n[TEST C] Verifying MCQ answer mapping for 'Business / Trading / Shop'")
    active_qs_c = [{"id": "primary_income_source", "question": "What was your primary source of income?"}]
    facts_c = extractor._parse_single_clarification_answer("Business / Trading / Shop", active_qs_c)
    assert facts_c.get("primary_activity") and facts_c["primary_activity"].value == "business", "primary_activity not set to business"
    assert facts_c.get("income_source") and facts_c["income_source"].value == "business", "income_source not set to business"
    print("✓ TEST C PASSED: MCQ option mapped to primary_activity = business.")

    # ----------------------------------------------------
    # TEST D: MCQ Range does NOT overwrite precise gross_receipts
    # ----------------------------------------------------
    print("\n[TEST D] Verifying provenance protection: broad MCQ range does NOT overwrite precise gross_receipts")
    cid_d = "conv_test_d_001"
    # Save precise fact first
    repo.save_facts(cid_d, {
        "gross_receipts": TaxFact("gross_receipts", {"value": 400000, "approximate": True, "currency": "INR"}, "object", "user_custom", 1.0, "₹4 lakh"),
        "primary_activity": TaxFact("primary_activity", "business", "enum", "user_custom", 1.0)
    })
    # User selects MCQ range
    active_qs_d = [{"id": "approx_gross_receipts", "question": "Gross receipts range?"}]
    mcq_ans_d = extractor._parse_single_clarification_answer("Between ₹3 Lakh and ₹7 Lakh", active_qs_d)
    repo.save_facts(cid_d, mcq_ans_d)

    loaded_d = repo.get_facts(cid_d)
    assert "gross_receipts" in loaded_d, "gross_receipts was lost!"
    assert loaded_d["gross_receipts"].value["value"] == 400000, f"gross_receipts was overwritten to {loaded_d['gross_receipts'].value}"
    assert loaded_d["gross_receipts"].source == "user_custom", "Source should remain user_custom"
    assert loaded_d.get("income_range") and loaded_d["income_range"].value == "300000-700000", "income_range fact should be saved alongside"
    print("✓ TEST D PASSED: Precise gross_receipts preserved, income_range stored non-destructively.")

    # ----------------------------------------------------
    # TEST E: Custom Answer 'Business loss of ₹2 lakh' sets business_loss
    # ----------------------------------------------------
    print("\n[TEST E] Verifying custom answer 'Business loss of ₹2 lakh'")
    facts_e = extractor.extract_from_prompt("Business loss of ₹2 lakh", default_source="user_custom")
    assert facts_e.get("business_result") and facts_e["business_result"].value == "loss", "business_result should be loss"
    assert facts_e.get("financial_result_status") and facts_e["financial_result_status"].value == "net_loss", "financial_result_status should be net_loss"
    assert facts_e.get("net_business_loss") and facts_e["net_business_loss"].value["value"] == 200000, "net_business_loss value mismatch"
    print("✓ TEST E PASSED: Custom business loss accurately parsed.")

    # ----------------------------------------------------
    # TEST F: Contradiction Handling (₹4 Lakh vs ₹10 Lakh)
    # ----------------------------------------------------
    print("\n[TEST F] Verifying turnover contradiction detection: ₹4 Lakh vs ₹10 Lakh")
    detector = ContradictionDetector()
    existing_f = {
        "gross_receipts": TaxFact("gross_receipts", {"value": 400000, "approximate": True, "currency": "INR"}, "object", "user_custom", 1.0)
    }
    new_f = {
        "gross_receipts": TaxFact("gross_receipts", {"value": 1000000, "approximate": False, "currency": "INR"}, "object", "user_explicit", 1.0)
    }
    contra = detector.check(existing_f, new_f)
    assert contra is not None, "Contradiction should be detected for 4L vs 10L"
    assert contra["conflict_type"] == "receipts_figure_conflict", "Conflict type should be receipts_figure_conflict"
    assert "reconcile_receipts_figure" == contra["question"]["id"], "Question ID should be reconcile_receipts_figure"
    print("✓ TEST F PASSED: Contradiction accurately flagged with reconciliation question.")

    # ----------------------------------------------------
    # TEST G: Conversation Switching Isolation
    # ----------------------------------------------------
    print("\n[TEST G] Verifying conversation isolation and multi-chat switching")
    cid_g1 = "conv_test_g1"
    cid_g2 = "conv_test_g2"
    repo.save_facts(cid_g1, {"primary_activity": TaxFact("primary_activity", "business", "enum", "user_explicit", 1.0)})
    repo.save_facts(cid_g2, {"primary_activity": TaxFact("primary_activity", "employment", "enum", "user_explicit", 1.0)})

    loaded_g1 = repo.get_facts(cid_g1)
    loaded_g2 = repo.get_facts(cid_g2)
    assert loaded_g1["primary_activity"].value == "business", "Conv 1 isolation failed"
    assert loaded_g2["primary_activity"].value == "employment", "Conv 2 isolation failed"
    print("✓ TEST G PASSED: Absolute conversation isolation confirmed.")

    # ----------------------------------------------------
    # TEST H: Database Refresh & Reload Persistence
    # ----------------------------------------------------
    print("\n[TEST H] Verifying database persistence across connection refresh")
    cid_h = "conv_test_h"
    fact_dict = {"gross_receipts": TaxFact("gross_receipts", {"value": 400000, "approximate": True, "currency": "INR"}, "object", "user_custom", 1.0, "My receipts ₹4 lakh")}
    repo.save_facts(cid_h, fact_dict)

    # Create fresh repository pointing to same database
    fresh_repo = FactRepository(db_path)
    loaded_h = fresh_repo.get_facts(cid_h)
    assert "gross_receipts" in loaded_h, "Fact not found after refresh"
    assert loaded_h["gross_receipts"].value == {"value": 400000, "approximate": True, "currency": "INR"}, "Object deserialization failed"
    assert loaded_h["gross_receipts"].raw_text == "My receipts ₹4 lakh", "raw_text not preserved"
    print("✓ TEST H PASSED: Complex object & raw text persistence verified after reload.")

    # ----------------------------------------------------
    # TEST I: Conceptual Query Generates 0 Clarification Questions
    # ----------------------------------------------------
    print("\n[TEST I] Verifying conceptual queries require 0 clarification")
    for q_text in ["What is GST?", "Can a person claim depreciation on a laptop in income tax?", "What is Section 80C?"]:
        needs_ci, q_list_i, _, _ = engine.evaluate_materiality(q_text, f"conv_i_{abs(hash(q_text))}")
        assert needs_ci is False, f"Conceptual query '{q_text}' required clarification!"
        assert len(q_list_i) == 0, f"Expected 0 questions, got {len(q_list_i)}"
    print("✓ TEST I PASSED: Conceptual queries directly handled with 0 questions.")

    # ----------------------------------------------------
    # TEST J: GST Transaction Direction (Rajasthan buyer / Gujarat supplier)
    # ----------------------------------------------------
    print("\n[TEST J] Verifying GST supply direction Rajasthan/Gujarat")
    prompt_j = "I am an unregistered buyer in Rajasthan purchasing machinery from a Gujarat supplier for local sale in Rajasthan. Can I claim ITC?"
    facts_j = extractor.extract_from_prompt(prompt_j)

    assert facts_j.get("supplier_state") and facts_j["supplier_state"].value == "Gujarat", "supplier_state should be Gujarat"
    assert facts_j.get("buyer_state") and facts_j["buyer_state"].value == "Rajasthan", "buyer_state should be Rajasthan"
    assert facts_j.get("inward_supply_type") and facts_j["inward_supply_type"].value == "inter_state", "inward_supply_type should be inter_state"
    assert facts_j.get("outward_supply_type") and facts_j["outward_supply_type"].value == "intra_state", "outward_supply_type should be intra_state"
    # Ensure outward is NOT inferred as inter_state!
    if db_path.exists():
        try:
            db_path.unlink()
        except Exception:
            pass
    print("\n" + "=" * 60)
    print("ALL 10 REGRESSION TESTS (A to J) PASSED PERFECTLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
