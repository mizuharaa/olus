"""Saved editable scenarios. Canned anonymous scenarios remain unchanged."""

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from src.events.catalog import normalize_event_params
from src.network import cache
from src.routes.account import require_account
from src.store.repository import default_db_path
from src.store.scenario_workspaces import ScenarioWorkspaceRepository

router = APIRouter(prefix="/scenario-workspaces", tags=["Scenario workspaces"])


class Constraints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    solver_timeout_secs: int = Field(default=30, ge=1, le=120)


class Disruption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    params: dict[str, Any] = Field(default_factory=dict)


class ScenarioConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schedule: list[dict[str, Any]] = Field(min_length=1, max_length=2000)
    aircraft: list[dict[str, Any]] = Field(min_length=1, max_length=500)
    crew_pairings: list[dict[str, Any]] = Field(max_length=5000)
    crew_members: list[dict[str, Any]] = Field(max_length=2000)
    constraints: Constraints = Field(default_factory=Constraints)
    disruptions: list[Disruption] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def validate_network(self):
        def ids(rows, name):
            values = [row.get("id") for row in rows]
            if any(not isinstance(v, str) or not v.strip() or len(v) > 80 for v in values) or len(
                set(values)
            ) != len(values):
                raise ValueError(
                    f"{name}: every row needs a unique nonempty id (max 80 characters)"
                )
            return set(values)

        flight_ids = ids(self.schedule, "Schedule")
        tails = ids(self.aircraft, "Fleet")
        members = ids(self.crew_members, "Crew members")
        ids(self.crew_pairings, "Crew pairings")
        airports = {row["id"] for row in cache.get_airports()}

        def number(row, field, low, high):
            value = row.get(field)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not low <= value <= high
            ):
                raise ValueError(f"{row.get('id')}: {field} must be between {low} and {high}")

        def stamp(row, field):
            try:
                value = datetime.fromisoformat(str(row[field]).replace("Z", "+00:00"))
                if value.tzinfo is None:
                    raise ValueError()
                return value
            except (KeyError, ValueError):
                raise ValueError(f"{row.get('id')}: {field} needs an ISO timestamp with timezone")

        for row in self.aircraft:
            number(row, "seats", 1, 900)
            number(row, "min_turn_minutes", 0, 240)
            if not isinstance(row.get("type"), str) or not row["type"].strip():
                raise ValueError("Aircraft type is required")
            if (
                not isinstance(row.get("base_airport_id"), str)
                or row["base_airport_id"] not in airports
            ):
                raise ValueError("Unknown fleet base airport")
        for row in self.schedule:
            if not isinstance(row.get("aircraft_id"), str) or row["aircraft_id"] not in tails:
                raise ValueError(f"{row['id']}: aircraft does not exist")
            if (
                not isinstance(row.get("origin"), str)
                or not isinstance(row.get("destination"), str)
                or row["origin"] not in airports
                or row["destination"] not in airports
                or row["origin"] == row["destination"]
            ):
                raise ValueError(f"{row['id']}: choose distinct known airports")
            number(row, "passengers", 0, 900)
            if stamp(row, "scheduled_arrival") <= stamp(row, "scheduled_departure"):
                raise ValueError(f"{row['id']}: arrival must follow departure")
        for row in self.crew_members:
            if row.get("role") not in ("captain", "first_officer", "flight_attendant"):
                raise ValueError(f"{row['id']}: unknown crew role")
            if (
                not isinstance(row.get("base_airport_id"), str)
                or row["base_airport_id"] not in airports
            ):
                raise ValueError(f"{row['id']}: unknown crew base")
            for key, maximum in (
                ("flight_hours_7d", 168),
                ("flight_hours_28d", 672),
                ("flight_hours_365d", 8760),
            ):
                if row.get(key) is not None:
                    number(row, key, 0, maximum)
            for window in (7, 28, 365):
                key = f"flight_time_{window}d_minutes"
                if row.get(key) is not None:
                    number(row, key, 0, window * 24 * 60)
            if row.get("home_timezone_offset_hours") is not None:
                number(row, "home_timezone_offset_hours", -12, 14)
            if row.get("last_rest_end") is not None:
                stamp(row, "last_rest_end")
        roles = {row["id"]: row["role"] for row in self.crew_members}
        assigned = set()
        for row in self.crew_pairings:
            if not isinstance(row.get("flight_id"), str) or row["flight_id"] not in flight_ids:
                raise ValueError(f"{row['id']}: unknown flight")
            if row["flight_id"] in assigned:
                raise ValueError("Only one crew pairing may be assigned per flight")
            assigned.add(row["flight_id"])
            for field in ("captain_id", "first_officer_id"):
                if not isinstance(row.get(field), str) or row[field] not in members:
                    raise ValueError(f"{row['id']}: unknown {field}")
            if (
                roles[row["captain_id"]] != "captain"
                or roles[row["first_officer_id"]] != "first_officer"
            ):
                raise ValueError(
                    f"{row['id']}: captain and first officer assignments must match crew roles"
                )
            if not isinstance(row.get("fa_ids", []), list) or any(
                not isinstance(v, str) or v not in members for v in row.get("fa_ids", [])
            ):
                raise ValueError(f"{row['id']}: unknown flight attendant")
            if any(roles[v] != "flight_attendant" for v in row.get("fa_ids", [])):
                raise ValueError(f"{row['id']}: cabin assignments require flight attendants")
            if stamp(row, "duty_end") <= stamp(row, "duty_start"):
                raise ValueError(f"{row['id']}: duty end must follow start")
            number(row, "flight_time_minutes", 0, 1440)
        if assigned != flight_ids:
            raise ValueError("Every scheduled flight needs a crew pairing")
        for event in self.disruptions:
            try:
                event.params = normalize_event_params(event.kind, event.params)
            except (TypeError, ValueError, OverflowError) as exc:
                raise ValueError(f"{event.kind}: invalid disruption parameters: {exc}") from exc
            for field in ("airport", "destination_airport", "location_airport", "base"):
                if event.params.get(field) and (
                    not isinstance(event.params[field], str) or event.params[field] not in airports
                ):
                    raise ValueError(f"{event.kind}: unknown {field}")
            if event.params.get("aircraft_tail") and (
                not isinstance(event.params["aircraft_tail"], str)
                or event.params["aircraft_tail"] not in tails
            ):
                raise ValueError(f"{event.kind}: unknown aircraft tail")
        json.dumps(self.model_dump(), allow_nan=False)
        return self


class CreateScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def nonempty_name(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Scenario name cannot be blank")
        return self


class SaveScenario(CreateScenario):
    revision: int = Field(ge=1)
    config: ScenarioConfig
    archived: bool = False


def repository(request):
    if not hasattr(request.app.state, "scenario_workspace_repository"):
        request.app.state.scenario_workspace_repository = ScenarioWorkspaceRepository(
            default_db_path()
        )
    return request.app.state.scenario_workspace_repository


def get_owned_scenario(request: Request, scenario_id: str, owner_id: str):
    scenario = repository(request).get(owner_id, scenario_id)
    if scenario is None:
        raise HTTPException(404, "Scenario not found")
    return scenario


@router.get("")
def list_scenarios(request: Request, account=Depends(require_account)):
    return {"scenarios": repository(request).list(account["id"])}


@router.post("", status_code=201)
def create_scenario(payload: CreateScenario, request: Request, account=Depends(require_account)):
    try:
        config = ScenarioConfig(
            schedule=cache.get_flights(),
            aircraft=cache.get_aircraft(),
            crew_pairings=cache.get_crew_pairings(),
            crew_members=cache.get_crew_members(),
        )
    except ValidationError as error:
        raise HTTPException(
            503,
            "The starter network is incomplete. Restore its schedule, fleet and crew data before creating a scenario.",
        ) from error
    return repository(request).create(account["id"], payload.name.strip(), config.model_dump())


@router.get("/{scenario_id}")
def get_scenario(scenario_id: str, request: Request, account=Depends(require_account)):
    return get_owned_scenario(request, scenario_id, account["id"])


@router.post("/{scenario_id}/save")
def save_scenario(
    scenario_id: str, payload: SaveScenario, request: Request, account=Depends(require_account)
):
    get_owned_scenario(request, scenario_id, account["id"])
    saved = repository(request).save(
        account["id"],
        scenario_id,
        payload.revision,
        payload.name.strip(),
        payload.config.model_dump(),
        payload.archived,
    )
    if saved is None:
        raise HTTPException(409, "Scenario changed in another window. Reload before saving.")
    return saved


@router.post("/{scenario_id}/duplicate", status_code=201)
def duplicate_scenario(scenario_id: str, request: Request, account=Depends(require_account)):
    source = get_owned_scenario(request, scenario_id, account["id"])
    return repository(request).create(
        account["id"], (source["name"] + " copy")[:120], source["config"]
    )
