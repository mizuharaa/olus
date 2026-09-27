"""REST polling must preserve the same recovery state as a WebSocket connection."""

from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.routes.simulator import router
from src.ws.handlers import _snapshot_payload


def test_rest_snapshot_preserves_recovery_metrics_and_commit():
    state = SimpleNamespace(
        sim_time=datetime(2026, 9, 27, tzinfo=timezone.utc),
        active_events=[{"id": "wind", "kind": "wind_shear"}],
        flight_states={"NB101": {"delay_minutes": 90}},
        recovery_plans=[{"plan_id": "A", "total_cost_usd": 12500}],
        cascade_summary={
            "total_affected": 3,
            "directly_affected": 1,
            "cascade_1": 2,
            "cascade_2": 0,
        },
        applied_plan_id="A",
    )
    engine = SimpleNamespace(state=state, get_schedule_snapshot=lambda: [{"id": "NB101"}])
    app = FastAPI()
    app.state.engine = engine
    app.include_router(router)
    with TestClient(app) as client:
        for applied, summary in [("A", state.cascade_summary), (None, {})]:
            state.applied_plan_id = applied
            state.cascade_summary = summary
            rest = client.get("/simulator/state").json()
            socket = _snapshot_payload(engine, "connected")
            for key in (
                "cascade_summary",
                "applied_plan_id",
                "recovery_plans",
                "active_events",
                "flight_states",
                "schedule",
            ):
                assert rest.get(key) == socket[key], key
