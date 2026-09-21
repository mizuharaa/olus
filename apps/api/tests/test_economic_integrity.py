"""Economics are explicit scenario estimates, not elapsed-time or legal claims."""

import asyncio
from types import SimpleNamespace

import pytest

from src.costs.calculator import AirlineDelayCalculator, economic_event_kind
from src.costs.carbon import carbon_for_cancellation, carbon_for_delay, portfolio_carbon
from src.optimizer.explain import explain_plan
from src.routes.passengers import (
    _compensation_for_flight,
    compensation_policy,
    passenger_impact,
    rebooking_options,
)


def flight(hours=1, **extra):
    return {
        "id": "F1",
        "passengers": 100,
        "aircraft_type": "B738",
        "scheduled_departure": "2026-09-20T10:00:00Z",
        "scheduled_arrival": f"2026-09-20T{10 + hours:02d}:00:00Z",
        **extra,
    }


def test_cancellation_carbon_uses_scheduled_block_time():
    short = carbon_for_cancellation(flight(1))
    long = carbon_for_cancellation(flight(5))
    assert long.fuel_kg == pytest.approx(short.fuel_kg * 5)
    assert short.breakdown["duration_source"] == "scheduled_block_time"


def test_missing_duration_discloses_fallback_and_delay_is_ground_by_default():
    cancel = carbon_for_cancellation({"id": "F1"})
    assert cancel.breakdown["duration_source"] == "assumed_stage_duration"
    assert cancel.breakdown["aircraft_model"] == "UNKN"
    ground = carbon_for_delay(flight(), 60)
    assert ground.fuel_kg == 110
    assert ground.breakdown["air_burn_kg"] == 0
    air = carbon_for_delay(flight(delay_air_fraction=1), 60)
    assert air.fuel_kg == 2650


@pytest.mark.parametrize("fraction", [-0.1, 1.1, float("nan")])
def test_invalid_airborne_assumptions_rejected(fraction):
    with pytest.raises(ValueError):
        carbon_for_delay(flight(delay_air_fraction=fraction), 60)


def test_carbon_exposes_estimate_provenance_and_delta_semantics():
    data = portfolio_carbon({"F1": flight()}, ["F1"], [], []).to_dict()
    assert data["estimate_only"] is True
    assert data["comparison_basis"] == "scheduled_operations"
    assert data["net_co2_delta_kg"] == data["total_co2_kg"] < 0
    assert data["carbon_price_source"] == "fixed_scenario_assumption"


def test_cancelled_passengers_are_unknown_not_zero_complete_delay():
    data = AirlineDelayCalculator().portfolio_cost({"F1": flight()}, ["F1"], [])
    assert data["passenger_delay_complete"] is False
    assert data["passengers_without_recovery_time"] == 100
    assert data["estimate_only"] is True
    assert data["per_cancelled"][0]["modeled_compensation_usd"] >= 0


def test_known_reaccommodation_delay_is_included_and_zero_pax_stays_zero():
    calc = AirlineDelayCalculator()
    data = calc.portfolio_cost({"F1": flight(reaccommodation_delay_minutes=180)}, ["F1"], [])
    assert data["passenger_delay_complete"] is True
    assert data["total_pax_delay_minutes"] == 18000
    assert calc.delay_cost(flight(passengers=0), 60).pax_cost == 0


def test_passenger_allowance_is_model_not_legal_entitlement_and_has_units():
    data = _compensation_for_flight(flight(), 240, True, "mechanical_aog", 1)
    assert data["estimate_only"] is True
    assert data["legal_entitlement_evaluated"] is False
    expected_per_pax = 15 + 30 + 150 + 1400 + 200
    assert data["estimated_total_usd"] == expected_per_pax * 100
    assert "denied boarding" not in " ".join(data["actions"]).lower()
    assert data["hotel_allowance_usd"] == 150
    components = (
        "meal_voucher_usd",
        "hotel_allowance_usd",
        "hotel_transport_usd",
        "modeled_cash_allowance_usd",
        "travel_credit_usd",
    )
    assert sum(data[key] for key in components) * data["passengers"] == data["estimated_total_usd"]


def test_missing_passenger_count_is_consistent_and_explicitly_incomplete():
    row = flight(aircraft_type="B77W", reaccommodation_delay_minutes=120)
    row.pop("passengers")
    calc = AirlineDelayCalculator()
    data = calc.portfolio_cost({"F1": row}, ["F1"], [])
    allowance = _compensation_for_flight(row, 120, True, "", 1)
    count = allowance["passengers"]
    assert data["total_pax_delay_minutes"] == count * 120
    assert calc.delay_cost(row, 60).pax_cost == pytest.approx(count * 44.4)
    assert data["passenger_delay_complete"] is False
    assert allowance["passenger_count_known"] is False
    assert data["flights_with_assumed_passenger_count"] == 1
    assert allowance["event_category"] == "Unknown"
    assert allowance["is_airline_fault"] is None
    assert "dot261_compensation_usd" not in data["per_cancelled"][0]


def test_unknown_event_not_treated_as_airline_fault_by_empty_string():
    calc = AirlineDelayCalculator()
    assert calc.cancellation_cost(flight(), "").compensation == 0
    assert calc.cancellation_cost(flight(), "typo").compensation == 0
    assert calc.cancellation_cost(flight(), "mechanical_aog").compensation > 0


def test_financial_aliases_are_consistent_but_physical_alias_is_not_fault_evidence():
    calc = AirlineDelayCalculator()
    assert (
        calc.cancellation_cost(flight(), "labor_action").compensation
        == calc.cancellation_cost(flight(), "crew_sickout").compensation
    )
    assert economic_event_kind([{"kind": "mechanical_aog"}, {"kind": "weather_closure"}]) == ""
    assert economic_event_kind([{"kind": "bird_strike"}]) == "bird_strike"
    assert calc.cancellation_cost(flight(), "bird_strike").compensation == 0
    policy = asyncio.run(compensation_policy())
    assert "labor_action" in policy["fault_classification"]["modeled_airline_fault_events"]
    assert "bird_strike" in policy["fault_classification"]["modeled_external_events"]


def test_cancelled_passenger_delay_is_unknown_and_aircraft_map_resolves_missing_load():
    row = flight(aircraft_id="T1")
    row.pop("passengers")
    row.pop("aircraft_type")
    other = flight(id="F2")
    states = {
        "F1": {"cascade_order": 0, "status": "cancelled", "delay_minutes": 0},
        "F2": {"cascade_order": 0, "status": "delayed", "delay_minutes": 120},
    }
    engine = SimpleNamespace(
        schedule={"F1": row, "F2": other},
        aircraft={"T1": {"type": "E175"}},
        state=SimpleNamespace(flight_states=states, active_events=[{"kind": "weather_closure"}]),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(engine=engine)))
    result = asyncio.run(passenger_impact(request))["flights"]
    assert result[0]["flight_id"] == "F1"
    assert result[0]["delay_minutes"] is None
    assert result[0]["confidence_interval"]["high_min"] is None
    assert result[0]["passengers"] == 76
    assert result[0]["passenger_count_known"] is False
    assert result[0]["compensation"]["hotel_required"] is False


def test_counterfactual_rank_scores_every_candidate_before_truncating():
    rows = [flight(id=f"F{i}", passengers=1 if i < 7 else 300) for i in range(8)]
    plan = {"plan_id": "A", "cancelled_flights": [row["id"] for row in rows]}
    data = explain_plan(plan, rows, [], {}, top_n=1)
    assert data["decisions_evaluated"] == 8
    assert data["counterfactuals"][0]["flight_id"] == "F7"


def test_rebooking_uses_current_scenario_sorted_times_real_capacity_and_unknowns():
    rows = [flight(id="F0", origin="A", destination="B", aircraft_id="T1")]
    for fid, hour, pax in [
        ("late", 20, 100),
        ("middle", 17, 140),
        ("early", 12, 110),
        ("full", 11, 160),
        ("cancelled", 11, 10),
    ]:
        rows.append(
            flight(
                id=fid,
                origin="A",
                destination="B",
                aircraft_id="T1",
                passengers=pax,
                scheduled_departure=f"2026-09-20T{hour}:00:00Z",
                scheduled_arrival=f"2026-09-20T{hour+1}:00:00Z",
            )
        )
    rows.append(flight(id="bad", origin="A", destination="B", scheduled_arrival=None))
    engine = SimpleNamespace(
        schedule={row["id"]: row for row in rows},
        aircraft={"T1": {"seats": 160}},
        state=SimpleNamespace(
            flight_states={
                "F0": {"cascade_order": 0, "status": "cancelled"},
                "cancelled": {"status": "cancelled"},
            }
        ),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(engine=engine)))
    result = asyncio.run(rebooking_options(request))["rebooking_options"][0]
    assert [row["flight_id"] for row in result["alternatives"]] == ["early", "middle"]
    assert result["alternatives"][0]["seats_avail"] == 50
    engine.aircraft = {}
    result = asyncio.run(rebooking_options(request))["rebooking_options"][0]
    assert result["alternatives"][0]["seats_avail"] is None
    rows[0]["scheduled_departure"] = "bad"
    result = asyncio.run(rebooking_options(request))["rebooking_options"][0]
    assert result["alternatives"] == []
    assert result["reason"] == "invalid_original_departure"


def test_explanation_discloses_unvalidated_alternatives_not_solver_rationale():
    plan = {"plan_id": "A", "cancelled_flights": ["F1"]}
    data = explain_plan(plan, [flight()], [], {"F1": {"expected_delay_min": 90}})
    assert data["feasibility_checked"] is False
    assert data["comparison_kind"] == "single_decision_ledger_estimate"
    assert "DOT 261" not in data["rationale"]


def test_cancel_counterfactual_removes_swap_that_would_no_longer_operate():
    plan = {
        "plan_id": "A",
        "delayed_flights": [{"flight_id": "F1", "delay_minutes": 90}],
        "aircraft_swaps": [{"flight_id": "F1", "new_aircraft": "A2"}],
    }
    data = explain_plan(plan, [flight()], [], {"F1": {"expected_delay_min": 90}})
    cancellation = AirlineDelayCalculator().portfolio_cost({"F1": flight()}, ["F1"], [])
    assert (
        data["base_cost_usd"] + data["counterfactuals"][0]["delta_cost_usd"]
        == cancellation["grand_total_usd"]
    )
