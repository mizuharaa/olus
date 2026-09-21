"""
Plan counterfactual explainer.

Slice 5 — answers the question "Why this plan?" by re-evaluating each plan
with one decision flipped. Given a plan and a single counterfactual ("what if
we hadn't cancelled NB123?"), it recomputes the cost / pax-delay / carbon
ledger so the UI can show the trade-off as a glass box rather than a black box.

This deliberately does *not* re-run the CP-SAT solver. Counterfactuals are
single-decision flips evaluated through the same cost + carbon engines that
score the original plan, using the same scenario assumptions as
what the dashboard already reports.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.costs.calculator import AIRCRAFT_REPOSITION_COST_USD, AirlineDelayCalculator
from src.costs.carbon import portfolio_carbon

_calc = AirlineDelayCalculator()


@dataclass
class Counterfactual:
    """One single-flip what-if applied to a plan."""

    flight_id: str
    flip: str  # "cancel→keep" | "keep→cancel" | "delay→ontime" | "ontime→delay"
    delta_cost_usd: float
    delta_pax_delay_min: int
    delta_co2_kg: float
    delta_eu_ets_usd: float
    summary: str

    def to_dict(self) -> dict:
        return {
            "flight_id": self.flight_id,
            "flip": self.flip,
            "delta_cost_usd": round(self.delta_cost_usd, 2),
            "delta_pax_delay_min": self.delta_pax_delay_min,
            "delta_co2_kg": round(self.delta_co2_kg, 1),
            "delta_eu_ets_usd": round(self.delta_eu_ets_usd, 2),
            "summary": self.summary,
        }


def _ac_type_map(flights: list[dict], aircraft: list[dict]) -> dict[str, str]:
    by_id = {a["id"]: a.get("type", "") for a in aircraft}
    return {f["id"]: by_id.get(f.get("aircraft_id", ""), "") for f in flights}


def _plan_ledgers(
    plan: dict,
    flights_map: dict[str, dict],
    ac_type_map: dict[str, str],
    event_kind: str,
) -> tuple[float, int, float, float]:
    """Return (cost_usd, pax_delay_min, co2_kg, ets_usd) for a plan dict."""
    cancelled = list(plan.get("cancelled_flights") or [])
    delayed = list(plan.get("delayed_flights") or [])
    swaps = list(plan.get("aircraft_swaps") or [])

    cost_data = _calc.portfolio_cost(
        flights=flights_map,
        cancelled=cancelled,
        delayed=delayed,
        event_kind=event_kind,
        aircraft_type_map=ac_type_map,
    )
    swap_cost = len(swaps) * AIRCRAFT_REPOSITION_COST_USD
    cost_usd = cost_data["grand_total_usd"] + swap_cost

    carbon = portfolio_carbon(
        flights=flights_map,
        cancelled=cancelled,
        delayed=delayed,
        swaps=swaps,
        aircraft_type_map=ac_type_map,
    )

    return (
        cost_usd,
        cost_data.get("total_pax_delay_minutes", 0),
        carbon.total_co2_kg,
        carbon.eu_ets_cost_usd,
    )


def explain_plan(
    plan: dict,
    flights: list[dict],
    aircraft: list[dict],
    predictions: dict[str, dict],
    event_kind: str = "",
    top_n: int = 6,
) -> dict:
    """
    Compute counterfactuals for the most impactful flights in `plan`.

    For each candidate flight we flip the decision and re-score using the same
    cost + carbon engines that scored the original plan. The frontend uses
    these deltas to render the "Why this plan?" panel.
    """
    flights_map = {f["id"]: f for f in flights}
    ac_type_map = _ac_type_map(flights, aircraft)

    base_cost, base_pax, base_co2, base_ets = _plan_ledgers(
        plan,
        flights_map,
        ac_type_map,
        event_kind,
    )

    # ponytail: full rescoring is O(n²); use per-flight ledger deltas if large-network profiling warrants it.
    cancelled_ids = list(plan.get("cancelled_flights") or [])
    delayed_ids = [d["flight_id"] for d in (plan.get("delayed_flights") or [])]

    counterfactuals: list[Counterfactual] = []

    # ── Cancellation flips ("what if we kept this one alive?") ─────────────
    for fid in cancelled_ids:
        cf_plan = {
            "cancelled_flights": [c for c in plan.get("cancelled_flights") or [] if c != fid],
            "delayed_flights": [
                *(plan.get("delayed_flights") or []),
                {
                    "flight_id": fid,
                    "delay_minutes": int(predictions.get(fid, {}).get("expected_delay_min", 90)),
                },
            ],
            "aircraft_swaps": list(plan.get("aircraft_swaps") or []),
        }
        cf_cost, cf_pax, cf_co2, cf_ets = _plan_ledgers(
            cf_plan,
            flights_map,
            ac_type_map,
            event_kind,
        )
        counterfactuals.append(
            Counterfactual(
                flight_id=fid,
                flip="cancel→keep",
                delta_cost_usd=cf_cost - base_cost,
                delta_pax_delay_min=cf_pax - base_pax,
                delta_co2_kg=cf_co2 - base_co2,
                delta_eu_ets_usd=cf_ets - base_ets,
                summary=_summarise(
                    fid, "cancel→keep", cf_cost - base_cost, cf_pax - base_pax, cf_co2 - base_co2
                ),
            )
        )

    # ── Delay flips ("what if we cancelled this one?") ─────────────────────
    for fid in delayed_ids:
        cf_plan = {
            "cancelled_flights": [*(plan.get("cancelled_flights") or []), fid],
            "delayed_flights": [
                d for d in (plan.get("delayed_flights") or []) if d.get("flight_id") != fid
            ],
            "aircraft_swaps": [
                swap for swap in (plan.get("aircraft_swaps") or []) if swap.get("flight_id") != fid
            ],
        }
        cf_cost, cf_pax, cf_co2, cf_ets = _plan_ledgers(
            cf_plan,
            flights_map,
            ac_type_map,
            event_kind,
        )
        counterfactuals.append(
            Counterfactual(
                flight_id=fid,
                flip="keep→cancel",
                delta_cost_usd=cf_cost - base_cost,
                delta_pax_delay_min=cf_pax - base_pax,
                delta_co2_kg=cf_co2 - base_co2,
                delta_eu_ets_usd=cf_ets - base_ets,
                summary=_summarise(
                    fid, "keep→cancel", cf_cost - base_cost, cf_pax - base_pax, cf_co2 - base_co2
                ),
            )
        )

    # Sort by absolute cost-delta — biggest swing first. The UI shows
    # ~6 of these so the user immediately sees the most consequential
    # what-if scenarios.
    counterfactuals.sort(key=lambda c: abs(c.delta_cost_usd), reverse=True)

    return {
        "plan_id": plan.get("plan_id"),
        "comparison_kind": "single_decision_ledger_estimate",
        "feasibility_checked": False,
        "estimate_only": True,
        "carbon_charge_delta_basis": "difference_of_zero_floored_scenario_charges_not_marginal_carbon_price",
        "decisions_evaluated": len(counterfactuals),
        "base_cost_usd": round(base_cost, 2),
        "base_pax_delay_min": base_pax,
        "base_co2_kg": round(base_co2, 1),
        "base_eu_ets_usd": round(base_ets, 2),
        "counterfactuals": [cf.to_dict() for cf in counterfactuals[: top_n * 2]],
        "rationale": _build_rationale(plan, counterfactuals, base_cost, base_co2),
    }


def _summarise(fid: str, flip: str, dcost: float, dpax: int, dco2: float) -> str:
    cost_word = "saves" if dcost < 0 else "costs"
    co2_word = "saves" if dco2 < 0 else "burns"
    if flip == "cancel→keep":
        return (
            f"Keeping {fid} {cost_word} an estimated ${abs(dcost):,.0f}, "
            f"changes known pax-delay-min by {dpax:+,}, and {co2_word} {abs(dco2):.0f} kg CO₂."
        )
    if flip == "keep→cancel":
        return (
            f"Cancelling {fid} {cost_word} ${abs(dcost):,.0f}, "
            f"changes known pax-delay-min by {dpax:+,}, and {co2_word} {abs(dco2):.0f} kg CO₂."
        )
    return f"{fid}: {flip}"


def _build_rationale(
    plan: dict,
    counterfactuals: list[Counterfactual],
    base_cost: float,
    base_co2: float,
) -> str:
    """A one-paragraph plain-English explanation of *why* this plan is shaped the way it is."""
    plan_id = plan.get("plan_id", "?")
    n_cancel = len(plan.get("cancelled_flights") or [])
    n_delay = len(plan.get("delayed_flights") or [])

    if not counterfactuals:
        return (
            f"Plan {plan_id} has no cancellation/delay decisions to compare. "
            f"This does not establish feasibility or optimality."
        )

    # Identify the dominant flip direction
    cancel_to_keep = [c for c in counterfactuals if c.flip == "cancel→keep"]
    keep_to_cancel = [c for c in counterfactuals if c.flip == "keep→cancel"]

    parts = [
        f"Plan {plan_id} cancels {n_cancel} flight{'s' if n_cancel != 1 else ''} and delays {n_delay}, "
        f"for an estimated economic impact of ${base_cost:,.0f} and {base_co2/1000:+.1f} tCO₂ net change."
    ]
    if cancel_to_keep:
        worst = max(cancel_to_keep, key=lambda c: abs(c.delta_cost_usd))
        parts.append(
            f"Of the cancellations, {worst.flight_id} is the most consequential: "
            f"keeping it changes the modeled cost by ${worst.delta_cost_usd:+,.0f} "
            f"and known passenger-delay-minutes by {worst.delta_pax_delay_min:+,}."
        )
    if keep_to_cancel:
        cheapest_to_cancel = min(keep_to_cancel, key=lambda c: c.delta_cost_usd)
        if cheapest_to_cancel.delta_cost_usd < 0:
            parts.append(
                f"Conversely, cancelling {cheapest_to_cancel.flight_id} would have saved "
                f"an estimated ${abs(cheapest_to_cancel.delta_cost_usd):,.0f} in this ledger comparison."
            )
        else:
            parts.append(
                f"Cancelling {cheapest_to_cancel.flight_id} instead of delaying it would "
                f"add an estimated ${cheapest_to_cancel.delta_cost_usd:,.0f}."
            )
    parts.append(
        "These decision flips are not feasibility-checked alternatives; use a what-if re-solve. Cancelled-passenger arrival times may be unknown."
    )
    return " ".join(parts)
