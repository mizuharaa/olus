"""Cascade prediction endpoints."""

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

DATA_DIR = Path(__file__).parent.parent.parent.parent.parent / "data" / "network"


class PredictRequest(BaseModel):
    event: dict[str, Any]
    current_time: str | None = None


@router.post("/predict/cascade")
def predict_cascade(payload: PredictRequest, request: Request):
    """Predict cascade delay effects from a disruption event."""
    predictor = request.app.state.predictor
    weather = request.app.state.weather

    if not predictor:
        raise HTTPException(status_code=503, detail="Predictor not initialized")

    # Load flights
    try:
        with open(DATA_DIR / "flights.yaml") as f:
            flights = yaml.safe_load(f).get("flights", [])
    except FileNotFoundError:
        flights = []

    metar_data = weather.get_all_cached() if weather else {}
    current_time = (
        datetime.fromisoformat(payload.current_time)
        if payload.current_time
        else datetime.now(timezone.utc)
    )

    predictions = predictor.predict(flights, payload.event, metar_data, current_time)

    # Compute summary stats
    affected = {k: v for k, v in predictions.items() if v["cascade_order"] >= 0}
    return {
        "predictions": predictions,
        "summary": {
            "total_flights": len(flights),
            "directly_affected": sum(1 for v in predictions.values() if v["cascade_order"] == 0),
            "cascade_1": sum(1 for v in predictions.values() if v["cascade_order"] == 1),
            "cascade_2": sum(1 for v in predictions.values() if v["cascade_order"] == 2),
            "total_affected": len(affected),
            "avg_expected_delay_min": round(
                sum(v["expected_delay_min"] for v in affected.values()) / len(affected), 1
            )
            if affected
            else 0,
            "model_type": "ml" if predictor.is_trained else "rule_based",
        },
    }


@router.get("/predict/history")
async def get_prediction_history(request: Request):
    """Return historical predictions from this session."""
    # For MVP, just return from simulation state
    engine = request.app.state.engine
    if engine and engine.state.active_events:
        return {"has_predictions": True, "event_count": len(engine.state.active_events)}
    return {"has_predictions": False, "event_count": 0}
