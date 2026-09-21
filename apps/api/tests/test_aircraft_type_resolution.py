"""Fleet names must resolve to the same economic model as their ICAO types."""

from pathlib import Path

import pytest
import yaml

from src.costs.calculator import AirlineDelayCalculator
from src.costs.carbon import block_burn_kg_for
from src.data.airlines import AIRCRAFT_DB, get_aircraft_info, resolve_aircraft_type


@pytest.mark.parametrize(
    "fleet_type,icao",
    [("B737-800", "B738"), ("B757-200", "B752"), ("A320", "A320"), ("E175", "E175")],
)
def test_actual_fleet_types_resolve_without_generic_fallback(fleet_type, icao):
    assert resolve_aircraft_type(fleet_type) == icao
    assert resolve_aircraft_type(f"  {fleet_type.lower()} ") == icao
    assert get_aircraft_info(fleet_type) == AIRCRAFT_DB[icao]
    flight = {"id": "F1", "passengers": 100}
    calc = AirlineDelayCalculator()
    assert (
        calc.delay_cost(flight, 60, "weather_closure", fleet_type).total
        == calc.delay_cost(flight, 60, "weather_closure", icao).total
    )
    assert block_burn_kg_for(fleet_type, 1) == block_burn_kg_for(icao, 1)


def test_every_seed_fleet_type_has_an_explicit_model():
    path = Path(__file__).resolve().parents[3] / "data/network/aircraft.yaml"
    fleet = yaml.safe_load(path.read_text(encoding="utf-8"))["aircraft"]
    assert fleet
    assert all(get_aircraft_info(tail["type"]) != AIRCRAFT_DB["UNKN"] for tail in fleet)


@pytest.mark.parametrize("icao", ["B752", "B753"])
def test_boeing_757_is_single_aisle_not_widebody(icao):
    assert get_aircraft_info(icao)["category"] == "narrowbody"


def test_unknown_types_keep_the_explicit_generic_fallback():
    assert resolve_aircraft_type("made-up-type") == "UNKN"
    assert get_aircraft_info("made-up-type") == AIRCRAFT_DB["UNKN"]
