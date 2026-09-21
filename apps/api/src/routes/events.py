"""Disruption event endpoints."""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.events.catalog import (
    EVENT_DEFAULTS,
    EVENT_DESCRIPTIONS,
    normalize_event_params,
)

router = APIRouter()


class TriggerEventRequest(BaseModel):
    kind: str
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/events/types")
async def get_event_types():
    return {
        "event_types": [
            {
                "kind": kind,
                "label": kind.replace("_", " ").title(),
                "description": EVENT_DESCRIPTIONS[kind],
                "default_params": params,
            }
            for kind, params in EVENT_DEFAULTS.items()
        ]
    }


@router.get("/events/active")
async def get_active_events(request: Request):
    engine = request.app.state.engine
    if engine:
        return {"events": engine.state.active_events}
    return {"events": []}


@router.post("/events/trigger")
async def trigger_event(payload: TriggerEventRequest, request: Request):
    engine = request.app.state.engine
    predictor = request.app.state.predictor
    optimizer = request.app.state.optimizer
    weather = request.app.state.weather

    if not engine:
        raise HTTPException(status_code=503, detail="Simulation engine not initialized")

    try:
        merged_params = normalize_event_params(payload.kind, payload.params)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    event = {
        "id": str(uuid.uuid4()),
        "kind": payload.kind,
        "triggered_at": datetime.now(timezone.utc).isoformat(),
        "params": merged_params,
    }
    try:
        return await engine.trigger_event(event, predictor, optimizer, weather)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/events/{event_id}")
async def cancel_event(event_id: str, request: Request):
    engine = request.app.state.engine
    if not engine:
        raise HTTPException(status_code=503, detail="Simulation engine not initialized")

    try:
        removed = await engine.cancel_event(
            event_id,
            request.app.state.predictor,
            request.app.state.optimizer,
            request.app.state.weather,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"status": "cancelled", "event_id": event_id}


_SCENARIOS_DIR = Path(__file__).parent.parent.parent.parent.parent / "data" / "scenarios"


@router.get("/events/scenarios")
async def get_scenarios():
    import yaml

    scenarios = []
    try:
        for file in _SCENARIOS_DIR.glob("*.yaml"):
            with open(file) as handle:
                scenario = yaml.safe_load(handle)
                if scenario:
                    scenarios.append(scenario)
    except OSError:
        return {"scenarios": [], "error": "Scenario directory is unavailable"}
    return {"scenarios": scenarios}
