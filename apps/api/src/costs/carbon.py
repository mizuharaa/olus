"""
Carbon accounting for airline disruption recovery.

This module is the foundation for **Plan D — Green Recovery**, the carbon-aware
fourth strategy added in the Slice 4 revamp. It converts every operational
decision into modeled combustion CO₂ and applies a fixed scenario carbon price.
This is neither a live emissions inventory nor an EU ETS liability calculation.

Sources (all public):
  - ICAO Carbon Emissions Calculator Methodology v13 (2024) — fuel-to-CO₂ factor
  - EUROCONTROL Aviation Sustainability Briefing (2023) — block-hour fuel burn
    by ICAO type code
  - Airline Carbon Calculator (Atmosfair Airline Index 2023) — APU & taxi burn
  - EU ETS spot price: ~€85/tCO₂ (2024 avg) → ~$95/tCO₂ at 1.10 EUR/USD
  - ReFuelEU Aviation: SAF mandate baseline (we only model fossil Jet-A here)

The numbers below are deliberately conservative. The point of Plan D is to
expose the *trade-off shape* between cost-minimal and carbon-minimal recovery
decisions, not to publish a defensible Tier-2 emissions inventory.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from src.data.airlines import get_aircraft_info, resolve_aircraft_type

# ── Core constants ────────────────────────────────────────────────────────────

# 1 kg Jet-A fuel produces 3.16 kg CO₂ on combustion (ICAO ECCM v13, table 1-2).
KG_CO2_PER_KG_JETA = 3.16

# Block-hour fuel burn in kg/hr by ICAO category. Sourced from EUROCONTROL
# CO2/Atmosfair averages for typical flight profiles.
BLOCK_HOUR_FUEL_KG_PER_HR: dict[str, float] = {
    "regional": 1_700,  # CRJ/E-jet — short stage, high burn-rate per pax
    "narrowbody": 2_650,  # 737/A320 family
    "widebody": 6_900,  # 767/787/A330
    "cargo": 6_400,
}

# APU burn while the aircraft is parked at gate or held on taxiway during a
# delay. Roughly 110 kg/hr for narrowbody, 180 for widebody (FAA AEDT 3 default).
APU_FUEL_KG_PER_HR: dict[str, float] = {
    "regional": 70,
    "narrowbody": 110,
    "widebody": 180,
    "cargo": 180,
}

# When we cancel a flight we *save* the entire block-hour burn for that
# segment. Average US domestic stage is ~2.0 hours (BTS T-100 2023).
AVG_STAGE_HOURS = 2.0

# A ferry / repositioning leg burns the same per-hour as a revenue leg but
# carries no passengers — every kilogram is pure overhead.
FERRY_STAGE_HOURS = 1.6

# Fixed scenario assumption, not a live market quote or jurisdictional tax rule.
EU_ETS_USD_PER_TONNE = 95.0


# ── Per-event multipliers ─────────────────────────────────────────────────────
# Departure delays default to ground/APU. A scenario may explicitly provide
# delay_air_fraction when modeling an airborne hold; it is not observed telemetry.

DELAY_AIR_FRACTION = 0.0
DELAY_APU_FRACTION = 1.0


@dataclass
class CarbonInfo:
    flight_id: str
    co2_kg: float
    fuel_kg: float
    breakdown: dict
    note: str = ""


@dataclass
class PortfolioCarbon:
    """Carbon ledger for one full recovery plan."""

    total_co2_kg: float
    total_fuel_kg: float
    eu_ets_cost_usd: float
    saved_co2_kg: float  # cancellations / avoided ferries
    burned_co2_kg: float  # delays, ferries, swap repositioning
    per_flight: list[CarbonInfo]

    def to_dict(self) -> dict:
        return {
            "model_version": "scenario-carbon-2026-09-20",
            "estimate_only": True,
            "comparison_basis": "scheduled_operations",
            "carbon_price_source": "fixed_scenario_assumption",
            "carbon_charge_rule": "max(0, net_co2_delta_kg) / 1000 * scenario_price",
            "negative_delta_credit": False,
            "net_co2_delta_kg": round(self.total_co2_kg, 1),
            "net_fuel_delta_kg": round(self.total_fuel_kg, 1),
            "total_co2_kg": round(self.total_co2_kg, 1),
            "total_co2_tonnes": round(self.total_co2_kg / 1000, 3),
            "total_fuel_kg": round(self.total_fuel_kg, 1),
            "eu_ets_cost_usd": round(self.eu_ets_cost_usd, 2),
            "saved_co2_kg": round(self.saved_co2_kg, 1),
            "burned_co2_kg": round(self.burned_co2_kg, 1),
            "per_flight": [
                {
                    "flight_id": ci.flight_id,
                    "co2_kg": round(ci.co2_kg, 1),
                    "fuel_kg": round(ci.fuel_kg, 1),
                    "breakdown": ci.breakdown,
                    "note": ci.note,
                }
                for ci in self.per_flight[:25]  # truncate for API
            ],
            "ets_price_usd_per_tonne": EU_ETS_USD_PER_TONNE,
            "per_flight_count": len(self.per_flight),
            "per_flight_omitted": max(0, len(self.per_flight) - 25),
        }


def _category_for(aircraft_type: str) -> str:
    info = get_aircraft_info(aircraft_type or "UNKN")
    return info.get("category", "narrowbody")


def block_burn_kg_for(aircraft_type: str, hours: float) -> float:
    """Fuel kg consumed by `aircraft_type` over `hours` of block time."""
    cat = _category_for(aircraft_type)
    rate = BLOCK_HOUR_FUEL_KG_PER_HR.get(cat, BLOCK_HOUR_FUEL_KG_PER_HR["narrowbody"])
    return rate * max(0.0, hours)


def apu_burn_kg_for(aircraft_type: str, hours: float) -> float:
    cat = _category_for(aircraft_type)
    rate = APU_FUEL_KG_PER_HR.get(cat, APU_FUEL_KG_PER_HR["narrowbody"])
    return rate * max(0.0, hours)


def fuel_to_co2(fuel_kg: float) -> float:
    return fuel_kg * KG_CO2_PER_KG_JETA


# ── Per-decision carbon math ──────────────────────────────────────────────────


def carbon_for_delay(
    flight: dict,
    delay_minutes: int,
    aircraft_type: str = "",
) -> CarbonInfo:
    """Extra CO₂ produced by holding a flight for `delay_minutes`."""
    ac_type = aircraft_type or flight.get("aircraft_type", "") or "UNKN"
    if not math.isfinite(delay_minutes) or delay_minutes < 0:
        raise ValueError("delay_minutes must be finite and nonnegative")
    air_fraction = float(flight.get("delay_air_fraction", DELAY_AIR_FRACTION))
    if not math.isfinite(air_fraction) or not 0 <= air_fraction <= 1:
        raise ValueError("delay_air_fraction must be between zero and one")
    h = delay_minutes / 60.0
    air_kg = block_burn_kg_for(ac_type, h * air_fraction)
    apu_kg = apu_burn_kg_for(ac_type, h * (1 - air_fraction))
    total_fuel = air_kg + apu_kg
    total_co2 = fuel_to_co2(total_fuel)
    return CarbonInfo(
        flight_id=flight.get("id", ""),
        co2_kg=total_co2,
        fuel_kg=total_fuel,
        breakdown={
            "aircraft_model": resolve_aircraft_type(ac_type),
            "air_burn_kg": round(air_kg, 1),
            "apu_burn_kg": round(apu_kg, 1),
            "delay_min": delay_minutes,
            "air_fraction": air_fraction,
            "phase_source": "scenario_assumption"
            if "delay_air_fraction" in flight
            else "ground_delay_default",
        },
        note=f"+{delay_minutes}m delay",
    )


def carbon_for_cancellation(
    flight: dict,
    aircraft_type: str = "",
) -> CarbonInfo:
    """Cancelling a revenue leg removes the full block-hour burn (negative ledger)."""
    ac_type = aircraft_type or flight.get("aircraft_type", "") or "UNKN"
    hours = AVG_STAGE_HOURS
    duration_source = "assumed_stage_duration"
    departure = flight.get("scheduled_departure")
    arrival = flight.get("scheduled_arrival")
    if departure and arrival:
        try:
            start = datetime.fromisoformat(departure.replace("Z", "+00:00"))
            end = datetime.fromisoformat(arrival.replace("Z", "+00:00"))
            if start.tzinfo is None or end.tzinfo is None:
                raise ValueError("Scheduled times require time zones")
            scheduled_hours = (end - start).total_seconds() / 3600
            if scheduled_hours <= 0:
                raise ValueError("Arrival must follow departure")
            hours = scheduled_hours
            duration_source = "scheduled_block_time"
        except (ValueError, TypeError, AttributeError):
            duration_source = "invalid_schedule_assumed_stage_duration"
    fuel = block_burn_kg_for(ac_type, hours)
    co2 = fuel_to_co2(fuel)
    return CarbonInfo(
        flight_id=flight.get("id", ""),
        co2_kg=-co2,
        fuel_kg=-fuel,
        breakdown={
            "aircraft_model": resolve_aircraft_type(ac_type),
            "stage_hr": hours,
            "duration_source": duration_source,
            "block_burn_kg": round(fuel, 1),
        },
        note="cancelled — burn avoided",
    )


def carbon_for_ferry(
    aircraft_type: str = "",
    hours: float = FERRY_STAGE_HOURS,
) -> CarbonInfo:
    """Repositioning / ferry leg — pure overhead carbon."""
    fuel = block_burn_kg_for(aircraft_type, hours)
    co2 = fuel_to_co2(fuel)
    return CarbonInfo(
        flight_id="(ferry)",
        co2_kg=co2,
        fuel_kg=fuel,
        breakdown={
            "aircraft_model": resolve_aircraft_type(aircraft_type),
            "stage_hr": hours,
            "burn_kg": round(fuel, 1),
            "passengers": 0,
        },
        note="ferry / aircraft swap",
    )


# ── Plan-level rollup ────────────────────────────────────────────────────────


def portfolio_carbon(
    flights: dict[str, dict],
    cancelled: list[str],
    delayed: list[dict],
    swaps: list[dict],
    aircraft_type_map: dict[str, str] | None = None,
) -> PortfolioCarbon:
    """
    Roll up CO₂ for one recovery plan.

    Convention: cancellations are *negative* (we saved fuel), delays + ferries
    are positive (we burned more fuel than the schedule baseline).
    """
    ac_map = aircraft_type_map or {}
    per_flight: list[CarbonInfo] = []

    saved_co2 = 0.0
    burned_co2 = 0.0
    total_fuel = 0.0

    for fid in cancelled:
        flight = flights.get(fid, {})
        ac_type = ac_map.get(fid, "")
        info = carbon_for_cancellation(flight, ac_type)
        per_flight.append(info)
        saved_co2 += abs(info.co2_kg)
        total_fuel += info.fuel_kg

    for d in delayed:
        fid = d.get("flight_id", "")
        flight = flights.get(fid, {})
        ac_type = ac_map.get(fid, "")
        info = carbon_for_delay(flight, int(d.get("delay_minutes", 0)), ac_type)
        per_flight.append(info)
        burned_co2 += info.co2_kg
        total_fuel += info.fuel_kg

    for s in swaps:
        ac_type = s.get("aircraft_type", "") or ac_map.get(s.get("flight_id", ""), "")
        info = carbon_for_ferry(ac_type)
        per_flight.append(info)
        burned_co2 += info.co2_kg
        total_fuel += info.fuel_kg

    net_co2 = burned_co2 - saved_co2
    eu_ets_cost = (net_co2 / 1000.0) * EU_ETS_USD_PER_TONNE  # net tonnes × $/t

    return PortfolioCarbon(
        total_co2_kg=net_co2,
        total_fuel_kg=total_fuel,
        eu_ets_cost_usd=max(0.0, eu_ets_cost),  # scenario charge; no credit for negative deltas
        saved_co2_kg=saved_co2,
        burned_co2_kg=burned_co2,
        per_flight=per_flight,
    )
