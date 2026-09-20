"""Private isolated solver lifecycle, persisted benchmarks and modeled crew audit."""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from src.routes.account import require_account
from src.routes.scenario_workspaces import get_owned_scenario
from src.services.crew_audit import audit_crew

router = APIRouter(tags=["Recovery runs"])


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario_id: str = Field(min_length=1, max_length=100)


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_id: str | None = None


class ExplainRequest(BaseModel):
    plan_id: str
    top_n: int = Field(default=6, ge=1, le=30)


def manager(request):
    value = getattr(request.app.state, "run_manager", None)
    if value is None:
        raise HTTPException(503, "Run supervisor unavailable")
    return value


async def owned_call(function, *args):
    try:
        return await asyncio.to_thread(function, *args)
    except KeyError:
        raise HTTPException(404, "Run not found")
    except ValueError as error:
        raise HTTPException(422, str(error))
    except RuntimeError as error:
        raise HTTPException(409, str(error))


@router.post("/runs", status_code=202)
async def start_run(payload: RunRequest, request: Request, account=Depends(require_account)):
    scenario = get_owned_scenario(request, payload.scenario_id, account["id"])
    if scenario.get("archived"):
        raise HTTPException(409, "Unarchive this scenario before running it")
    weather = getattr(request.app.state, "weather", None)
    return await owned_call(
        manager(request).start, account["id"], scenario, weather.get_all_cached() if weather else {}
    )


@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request, account=Depends(require_account)):
    return await owned_call(manager(request).get, account["id"], run_id)


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request, account=Depends(require_account)):
    return await owned_call(manager(request).cancel, account["id"], run_id)


@router.post("/runs/{run_id}/apply")
async def apply_run(
    run_id: str, payload: ApplyRequest, request: Request, account=Depends(require_account)
):
    return await owned_call(manager(request).apply, account["id"], run_id, payload.plan_id)


@router.get("/benchmarks")
async def benchmarks(
    request: Request,
    start: datetime | None = None,
    end: datetime | None = None,
    account=Depends(require_account),
):
    if any(value is not None and value.tzinfo is None for value in (start, end)):
        raise HTTPException(422, "Date filters require an explicit UTC offset")
    if start and end and end < start:
        raise HTTPException(422, "End must follow start")
    return {
        "runs": await owned_call(
            manager(request).history,
            account["id"],
            start.astimezone(timezone.utc).isoformat() if start else None,
            end.astimezone(timezone.utc).isoformat() if end else None,
        ),
        "limit": 500,
    }


@router.get("/runs/{run_id}/crew-audit")
async def crew_audit(
    run_id: str, request: Request, plan_id: str | None = None, account=Depends(require_account)
):
    data = await owned_call(manager(request).get, account["id"], run_id)
    if not data["result"]:
        raise HTTPException(409, "Run has no completed result")
    return await owned_call(
        audit_crew, data["result"], plan_id or data["result"].get("applied_plan_id")
    )


@router.post("/runs/{run_id}/explain")
async def explain_run(
    run_id: str, payload: ExplainRequest, request: Request, account=Depends(require_account)
):
    from src.optimizer.explain import explain_plan

    data = await owned_call(manager(request).get, account["id"], run_id)
    result = data["result"]
    if not result:
        raise HTTPException(409, "Run has no completed result")
    plan = next((p for p in result["recovery_plans"] if p["plan_id"] == payload.plan_id), None)
    if not plan:
        raise HTTPException(404, "Plan not found in this run")
    return await asyncio.to_thread(
        explain_plan,
        plan=plan,
        flights=result["schedule"],
        aircraft=result["aircraft"],
        predictions=result.get("predictions", {}),
        event_kind=(result.get("active_events") or [{}])[-1].get("kind", ""),
        top_n=payload.top_n,
    )
