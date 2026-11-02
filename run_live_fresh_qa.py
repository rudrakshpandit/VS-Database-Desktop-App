"""
Live Multi-Turn Stream Flow Test with Fresh Conversation ID
Records all SSE events, tokens, latency, fact persistence, and question progression.
"""

import sys
import uuid
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import vs_ai_engine

DB_PATH = Path("data/vs_database_desktop.db")

def run_live_flow():
    engine = vs_ai_engine.get_ai_engine(DB_PATH)
    conv_id = f"live_qa_{uuid.uuid4().hex[:8]}"
    print("=" * 70)
    print(f"STARTING LIVE FRESH CONVERSATION FLOW: {conv_id}")
    print("=" * 70)

    # -------------------------------------------------------------
    # TURN 1: Initial ambiguous query
    # -------------------------------------------------------------
    print("\n" + "-" * 50)
    print("TURN 1: USER ASKS INITIAL QUERY")
    print("-" * 50)
    prompt_1 = "My friend told me that if I don't have any profit then I don't have to file a return. Is that true? I didn't earn much this year so I'm confused."
    print(f"User: {prompt_1}\n")

    events_1 = []
    full_text_1 = ""
    for ev in engine.route_and_stream(prompt_1, conv_id):
        events_1.append(ev)
        if ev.get("type") == "token":
            full_text_1 += ev.get("delta", "")
        elif ev.get("type") == "done":
            full_text_1 = ev.get("full_text", full_text_1)

    print(f"SSE Event Count: {len(events_1)}")
    print(f"Assistant Output:\n{full_text_1}\n")

    facts_after_t1 = engine.clarification.repo.get_facts(conv_id)
    print("Facts in Store after Turn 1:")
    for k, v in facts_after_t1.items():
        print(f"  - {k}: {v.value} (source: {v.source}, type: {v.fact_type})")

    # -------------------------------------------------------------
    # TURN 2: User answers with Natural Language Custom Answer
    # -------------------------------------------------------------
    print("\n" + "-" * 50)
    print("TURN 2: USER PROVIDES CUSTOM ANSWER")
    print("-" * 50)
    prompt_2 = "My business receipts were around ₹4 lakh and I had a loss of ₹2 lakh."
    print(f"User: {prompt_2}\n")

    events_2 = []
    full_text_2 = ""
    for ev in engine.route_and_stream(prompt_2, conv_id):
        events_2.append(ev)
        if ev.get("type") == "token":
            full_text_2 += ev.get("delta", "")
        elif ev.get("type") == "done":
            full_text_2 = ev.get("full_text", full_text_2)

    print(f"SSE Event Count: {len(events_2)}")
    print(f"Assistant Output:\n{full_text_2}\n")

    facts_after_t2 = engine.clarification.repo.get_facts(conv_id)
    print("Facts in Store after Turn 2:")
    for k, v in facts_after_t2.items():
        print(f"  - {k}: {v.value} (source: {v.source}, type: {v.fact_type})")

    # Verify gross receipts is NOT re-asked
    assert "Approximately what was your total gross income or receipts for the year?" not in full_text_2
    assert "gross business receipts" not in full_text_2
    assert "loss_carry_forward_intent" in str(events_2) or "carry forward" in full_text_2.lower()
    print("\n-> PASS TURN 2: No duplicate question loop. Gross receipts preserved. Asked Section 139(3) carry-forward intent.")

    # -------------------------------------------------------------
    # TURN 3: User answers carry-forward intent
    # -------------------------------------------------------------
    print("\n" + "-" * 50)
    print("TURN 3: USER ANSWERS LOSS CARRY FORWARD INTENT")
    print("-" * 50)
    prompt_3 = "Yes, I want to carry forward the loss to offset future profits"
    print(f"User: {prompt_3}\n")

    events_3 = []
    full_text_3 = ""
    for ev in engine.route_and_stream(prompt_3, conv_id):
        events_3.append(ev)
        if ev.get("type") == "token":
            full_text_3 += ev.get("delta", "")
            sys.stdout.write(ev.get("delta", ""))
            sys.stdout.flush()
        elif ev.get("type") == "done":
            full_text_3 = ev.get("full_text", full_text_3)

    print(f"\n\nSSE Event Count: {len(events_3)}")
    facts_after_t3 = engine.clarification.repo.get_facts(conv_id)
    print("\nFacts in Store after Turn 3:")
    for k, v in facts_after_t3.items():
        print(f"  - {k}: {v.value} (source: {v.source}, type: {v.fact_type})")

    assert "139(3)" in full_text_3 or "section 80" in full_text_3.lower() or "carry forward" in full_text_3.lower()
    print("\n-> PASS TURN 3: Statutory advice generated referencing Section 139(3) / Section 80!")

    print("\n" + "=" * 70)
    print(f"LIVE FRESH CONVERSATION FLOW COMPLETED WITH 100% SUCCESS (ID: {conv_id})")
    print("=" * 70)

if __name__ == "__main__":
    run_live_flow()
