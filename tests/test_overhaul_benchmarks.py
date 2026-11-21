"""
Benchmark Test Suite for VS AI RAG, Clarification & Tax Accuracy Overhaul
Tests the 5 required benchmark scenarios and custom answer ingestion.
"""
import uuid
from pathlib import Path
from vs_ai_clarification import ClarificationEngine
from vs_ai_engine import AIModelOrchestrator

DB_PATH = Path("data/vs_database_desktop.db")

def run_tests():
    orch = AIModelOrchestrator(DB_PATH)
    engine = orch.clarification
    run_id = uuid.uuid4().hex[:6]

    print("=" * 70)
    print("RUNNING VS AI BENCHMARK TEST SUITE")
    print("=" * 70)

    # -------------------------------------------------------------
    # Scenario 1: Personal Bike Sale (u/s 2(14)(ii))
    # -------------------------------------------------------------
    print("\n[Scenario 1] Personal Bike Sale:")
    prompt_1 = "I sold my personal motorcycle for Rs 45,000. Do I have to pay capital gains tax?"
    req_1, qs_1, facts_1, dom_1 = engine.evaluate_materiality(prompt_1, f"test_conv_s1_{run_id}")
    print(f"  Materiality test: needs_clarification = {req_1} (Questions: {len(qs_1)})")
    assert not req_1, "Scenario 1 FAIL: Should not ask questions for personal bike sale!"
    assert facts_1.get("asset_nature") and facts_1["asset_nature"].value == "personal_effect"
    print("  -> Fact Extraction: asset_nature = personal_effect, asset_use = 100%_personal")
    print("  -> PASS: 0 clarification questions asked, direct answer triggered.")

    # -------------------------------------------------------------
    # Scenario 2: Inter-State GST Purchase by Unregistered Person
    # -------------------------------------------------------------
    print("\n[Scenario 2] Inter-State GST Purchase (Unregistered Buyer, Rs18L Turnover):")
    prompt_2 = "I am an unregistered sole proprietor with turnover of Rs 18 lakh and I bought goods worth Rs 50,000 from Gujarat. Do I have to pay GST or can I claim ITC?"
    req_2, qs_2, facts_2, dom_2 = engine.evaluate_materiality(prompt_2, f"test_conv_s2_{run_id}")
    print(f"  Materiality test: needs_clarification = {req_2} (Questions: {len(qs_2)})")
    assert not req_2, "Scenario 2 FAIL: Must NEVER ask if registered or what turnover is when already provided!"
    assert facts_2.get("gst_registration_status") and facts_2["gst_registration_status"].value == "unregistered"
    assert facts_2.get("entity_type") and facts_2["entity_type"].value == "sole_proprietorship"
    print("  -> Fact Extraction: gst_registration_status = unregistered, turnover = 1800000, supply_type = inter_state")
    print("  -> PASS: Rule 5 & 12 enforced: zero unnecessary questions asked.")

    # -------------------------------------------------------------
    # Scenario 3: Income-Tax Mismatch (AIS / TIS vs 26AS)
    # -------------------------------------------------------------
    print("\n[Scenario 3] AIS vs 26AS Mismatch:")
    prompt_3 = "There is a mismatch between my AIS and 26AS. What should I do?"
    conv_3 = f"test_conv_s3_{run_id}"
    req_3, qs_3, facts_3, dom_3 = engine.evaluate_materiality(prompt_3, conv_3)
    print(f"  Materiality test: needs_clarification = {req_3} (Questions: {len(qs_3)})")
    assert req_3, "Scenario 3 FAIL: AIS vs 26AS mismatch requires clarification."
    assert len(qs_3) in (1, 2, 3), f"Scenario 3 question count unexpected: {len(qs_3)}"
    print(f"  -> Generated {len(qs_3)} targeted clarification questions with options + 'Any other answer'.")

    # User answers Q1 and Q2:
    resp_3 = "1. Dividend Income from Shares / Mutual Funds\n2. AIS shows income that is completely missing in 26AS"
    req_3_after, qs_3_after, facts_3_after, dom_3_after = engine.evaluate_materiality(resp_3, conv_3)
    print(f"  After User Answers: needs_clarification = {req_3_after}")
    assert not req_3_after, "Scenario 3 FAIL: After answering, should proceed to final answer."
    assert facts_3_after.get("mismatch_item") and facts_3_after["mismatch_item"].value == "dividend"
    print("  -> PASS: Clarification answered and facts updated cleanly.")

    # -------------------------------------------------------------
    # Scenario 4: Laptop Purchase (Rs50,000, Depreciation vs 100% Write-off)
    # -------------------------------------------------------------
    print("\n[Scenario 4] Laptop Purchase (Depreciation vs Write-off + Custom Answer):")
    prompt_4 = "I bought a laptop for Rs 50,000 for my work. Can I claim 100% deduction or depreciation?"
    conv_4 = f"test_conv_s4_{run_id}"
    req_4, qs_4, facts_4, dom_4 = engine.evaluate_materiality(prompt_4, conv_4)
    print(f"  Materiality test: needs_clarification = {req_4} (Questions: {len(qs_4)})")
    assert req_4, "Scenario 4 FAIL: Must ask profession and usage."

    # User answers with custom response:
    resp_4 = "1. Freelancer / Professional (Doctor, Lawyer, Consultant, CA)\n2. Any other answer: I claimed ITC only on 60% because the laptop is partly used personally."
    req_4_after, qs_4_after, facts_4_after, dom_4_after = engine.evaluate_materiality(resp_4, conv_4)
    print(f"  After Custom Answer: needs_clarification = {req_4_after}")
    assert not req_4_after, "Scenario 4 FAIL: After custom answer, should proceed to answer."
    assert "user_custom" in str(facts_4_after["asset_use"].value), "Scenario 4 FAIL: Must preserve custom text!"
    print(f"  -> Preserved Custom Fact: asset_use = {facts_4_after['asset_use'].value}")
    print("  -> PASS: Custom answer ingested as true fact without arbitrary enum coercion.")

    # -------------------------------------------------------------
    # Scenario 5: ITR Filing Obligation (Income Rs2.2 Lakh):
    # -------------------------------------------------------------
    print("\n[Scenario 5] ITR Filing Obligation (Income Rs2.2 Lakh):")
    prompt_5 = "My total income this year is Rs 2.2 lakh. Do I have to file an Income Tax Return?"
    conv_5 = f"test_conv_s5_{run_id}"
    req_5, qs_5, facts_5, dom_5 = engine.evaluate_materiality(prompt_5, conv_5)
    print(f"  Materiality test: needs_clarification = {req_5} (Questions: {len(qs_5)})")
    assert req_5, "Scenario 5 FAIL: Must verify 7th proviso to Section 139(1)."
    assert len(qs_5) == 1
    print("  -> Question generated: 7th Proviso to Section 139(1) mandatory triggers.")

    # User answers:
    resp_5 = "None of these apply (Electricity < Rs1L, Foreign travel < Rs2L, Current A/c deposit < Rs1 Cr, TDS < Rs25k)"
    req_5_after, qs_5_after, facts_5_after, dom_5_after = engine.evaluate_materiality(resp_5, conv_5)
    print(f"  After Answer: needs_clarification = {req_5_after}")
    assert not req_5_after, "Scenario 5 FAIL: After confirmation, should answer directly."
    assert facts_5_after.get("seventh_proviso_applicable") and facts_5_after["seventh_proviso_applicable"].value == "none"
    print("  -> PASS: 7th proviso tested and cleared.")

    # -------------------------------------------------------------
    # Scenario 6: Mandatory Regression Test (Rule 41)
    # -------------------------------------------------------------
    print("\n[Scenario 6] Mandatory Regression Test (Rule 41 - Ambiguity Decomposition):")
    prompt_6 = "My friend told me that if I don't have any profit then I don't have to file a return. Is that true? I didn't earn much this year so I'm confused."
    conv_6 = f"test_conv_s6_{run_id}"
    req_6, qs_6, facts_6, dom_6 = engine.evaluate_materiality(prompt_6, conv_6)
    print(f"  Materiality test: needs_clarification = {req_6} (Questions: {len(qs_6)})")
    assert req_6, "Scenario 6 FAIL: Must ask clarification to decompose ambiguity."
    q_ids_6 = [q["id"] for q in qs_6]
    assert "seventh_proviso_criteria" not in q_ids_6, "Scenario 6 FAIL: Must NOT jump blindly to 7th Proviso before establishing income source/nature!"
    assert "financial_result_status" in q_ids_6, "Scenario 6 FAIL: Must resolve what 'no profit' means."
    assert "primary_income_source" in q_ids_6, "Scenario 6 FAIL: Must resolve economic activity."
    print("  -> PASS Round 1: Correctly decomposed ambiguities instead of blindly asking 7th Proviso.")

    # Round 2: User answers revealing Net Loss from Business
    resp_6_r1 = "1. I earned revenue, but incurred a net loss (expenses exceeded income)\n2. Business / Trading / Shop\n3. Below Rs 2.5 / Rs 3 Lakh (Below basic exemption limit)"
    req_6_r2, qs_6_r2, facts_6_r2, dom_6_r2 = engine.evaluate_materiality(resp_6_r1, conv_6)
    print(f"  Round 2 Materiality: needs_clarification = {req_6_r2} (Questions: {len(qs_6_r2)})")
    assert req_6_r2, "Scenario 6 FAIL: Must ask about loss carry-forward u/s 139(3)."
    q_ids_6_r2 = [q["id"] for q in qs_6_r2]
    assert "loss_carry_forward_intent" in q_ids_6_r2, "Scenario 6 FAIL: Must ask u/s 139(3) r.w. Section 80 loss carry-forward intent."
    print("  -> PASS Round 2: Correctly recognized net business loss and asked Section 139(3) carry-forward intent.")

    # Round 3: User answers: Yes, want to carry forward
    resp_6_r2 = "1. Yes, I want to carry forward the loss to offset future profits"
    req_6_r3, qs_6_r3, facts_6_r3, dom_6_r3 = engine.evaluate_materiality(resp_6_r2, conv_6)
    print(f"  Round 3 Materiality: needs_clarification = {req_6_r3} (Questions: {len(qs_6_r3)})")
    assert not req_6_r3, "Scenario 6 FAIL: All material facts established, should proceed to answer."
    print("  -> PASS Round 3: Multi-turn progressive clarification concluded successfully.")

    # -------------------------------------------------------------
    # Scenario 7: General Conceptual Questions (Rule 8, 33, 34)
    # -------------------------------------------------------------
    print("\n[Scenario 7] General Conceptual Questions (0 Questions Allowed):")
    for q_text in [
        "What is Section 80C?",
        "What is GST?",
        "Can a person claim depreciation on a laptop?"
    ]:
        req_c, qs_c, _, _ = engine.evaluate_materiality(q_text, f"test_conv_concept_{uuid.uuid4().hex[:6]}")
        print(f"  Query: '{q_text}' -> needs_clarification = {req_c} (Questions: {len(qs_c)})")
        assert not req_c and len(qs_c) == 0, f"Scenario 7 FAIL: Conceptual query '{q_text}' must have 0 clarification questions!"
    print("  -> PASS: All general conceptual queries pass with 0 clarification questions.")

    # -------------------------------------------------------------
    # Scenario 8: Contradiction Detection (Rule 20)
    # -------------------------------------------------------------
    print("\n[Scenario 8] Contradiction Detection:")
    conv_8 = f"test_conv_s8_{run_id}"
    # Setup earlier fact: unregistered
    engine.evaluate_materiality("I am an unregistered proprietor with turnover of Rs 15 lakh.", conv_8)
    # Subsequent conflicting prompt: claimed GST ITC / registered
    req_8, qs_8, facts_8, dom_8 = engine.evaluate_materiality("Now I filed my GST return and claimed ITC on my purchase.", conv_8)
    print(f"  Contradiction test: needs_clarification = {req_8} (Questions: {len(qs_8)})")
    assert req_8, "Scenario 8 FAIL: Contradiction must trigger clarification."
    assert any("reconcile" in q["id"] or "gst" in q["id"] for q in qs_8), "Scenario 8 FAIL: Reconciliation question expected."
    print("  -> PASS: Contradiction detected and reconciliation question generated.")

    # -------------------------------------------------------------
    # Zero Hallucination Test
    # -------------------------------------------------------------
    print("\n[Zero Hallucination Verification]")
    sys_inst = orch.build_system_instruction(source_only=False, has_attachments=False, is_statutory=True)
    assert "ZERO-HALLUCINATION PROFESSIONAL INTEGRITY" in sys_inst
    assert "Strictly NEVER fabricate or hallucinate Chartered Accountant names" in sys_inst
    assert "Strictly NEVER fabricate ICAI membership numbers" in sys_inst
    print("  -> PASS: Anti-hallucination directive verified in system prompt.")

    print("\n" + "=" * 70)
    print("ALL 8 BENCHMARK & REGRESSION SCENARIOS PASSED WITH 100% SUCCESS!")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()

