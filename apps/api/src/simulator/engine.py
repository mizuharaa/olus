"""
Olus simulation engine.

Manages the simulation clock, applies disruption events, tracks schedule
state changes, coordinates between the cascade predictor and recovery
optimizer, and broadcasts real-time updates to WebSocket subscribers.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from src.events.catalog import constraint_kind_for
from src.events.drone_incursion import duration_distribution as drone_duration_distribution
from src.events.drone_incursion import fold_into_incident

if TYPE_CHECKING:
    from fastapi import WebSocket

    from src.optimizer.milp import RecoveryOptimizer
    from src.predictor.cascade import CascadePredictor
    from src.store.repository import ScenarioRepository
    from src.weather.client import WeatherClient

logger = logging.getLogger(__name__)


@dataclass
class SimulationState:
    """Mutable simulation state — mutated in place as events are triggered."""

    sim_time: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc).replace(
            hour=6, minute=0, second=0, microsecond=0
        )
    )
    active_events: list[dict] = field(default_factory=list)
    flight_states: dict[str, dict] = field(default_factory=dict)
    recovery_plans: list[dict] = field(default_factory=list)
    # Persisted so fresh WS clients (page navigation, deep-link, refresh) can
    # rebuild the cascade panel without re-triggering the event. Previously
    # only sent inline on broadcast and lost on reconnect.
    cascade_summary: dict = field(default_factory=dict)
    # Which plan letter (A/B/C/D) the operator has committed to, plus a
    # snapshot of `flight_states` taken right before apply so we can roll
    # back cleanly on unapply. Without this the dashboard's "apply" button
    # was a no-op outside the right rail — secondary tabs never refreshed.
    applied_plan_id: str | None = None
    flight_states_pre_apply: dict[str, dict] = field(default_factory=dict)
    ws_subscribers: set = field(default_factory=set)
    is_running: bool = False
    event_history: list[dict] = field(default_factory=list)
    plan_context_hash: str | None = None
    predictions: dict = field(default_factory=dict)


class SimulationEngine:
    """
    Core simulation engine for Olus.

    Owns:
      - The canonical schedule (dict of flight dicts)
      - Per-flight state (status, delay, cascade info)
      - Active events list
      - WebSocket subscriber set

    Does NOT own the predictor, optimizer, or weather client —
    these are injected at trigger time to allow clean dependency injection.
    """

    # ─── Built-in scenarios ───────────────────────────────────────────────

    BUILT_IN_SCENARIOS: dict[str, dict] = {
        "ord_thunderstorm": {
            "name": "Chicago O'Hare Thunderstorm",
            "description": "Severe convective activity closes ORD for 4 hours.",
            "event": {
                "kind": "weather_closure",
                "params": {
                    "airport": "KORD",
                    "start": "T+0h",
                    "end": "T+4h",
                    "severity": "severe",
                    "conditions": "thunderstorm",
                },
            },
        },
        "atl_ground_stop": {
            "name": "Atlanta Ground Stop",
            "description": "FAA GS at KATL due to volume — holds all inbounds 2 hours.",
            "event": {
                "kind": "ground_stop",
                "params": {
                    "destination_airport": "KATL",
                    "start": "T+0h",
                    "end": "T+2h",
                    "reason": "weather",
                    "severity": "moderate",
                },
            },
        },
        "n042nb_engine_aog": {
            "name": "Engine AOG at Denver",
            "description": "Engine defect grounds N042NB at KDEN cascading 4 downstream flights.",
            "event": {
                "kind": "mechanical_aog",
                "params": {
                    "aircraft_tail": "N042NB",
                    "defect_category": "engine",
                    "location_airport": "KDEN",
                    "duration_hours": 8,
                    "severity": "severe",
                },
            },
        },
        "dfw_runway_incident": {
            "name": "DFW Runway 18L Incident",
            "description": "Aircraft incident closes runway 18L reducing DFW capacity 40%.",
            "event": {
                "kind": "runway_closure",
                "params": {
                    "airport": "KDFW",
                    "runway": "18L",
                    "reason": "incident",
                    "capacity_cut_pct": 40,
                    "start": "T+0h",
                    "end": "T+3h",
                    "severity": "moderate",
                },
            },
        },
        "crowdstrike_outage": {
            "name": "IT Outage (CrowdStrike-style)",
            "description": "Full IT infrastructure failure grounds Nimbus Air fleet for 3 hours.",
            "event": {
                "kind": "cyber_incident",
                "params": {
                    "incident_type": "full_it_outage",
                    "affected_hubs": [],
                    "system_restored_at": "T+4h",
                    "manual_workaround": True,
                    "severity": "extreme",
                },
            },
        },
    }

    def __init__(
        self,
        schedule: list[dict],
        aircraft: list[dict],
        crews: list[dict],
        repository: "ScenarioRepository | None" = None,
        *,
        crew_members: list[dict] | None = None,
        decision_locks: list[dict] | None = None,
    ):
        # Immutable network data (aircraft/crews)
        self.aircraft: dict[str, dict] = {a["id"]: a.copy() for a in aircraft}
        self.crews: dict[str, dict] = {c["id"]: c.copy() for c in crews}
        self.crew_members = crew_members
        self.decision_locks = decision_locks or []
        self._services: tuple[CascadePredictor, RecoveryOptimizer, WeatherClient] | None = None
        self._generation = 0

        # Mutable schedule
        self.schedule: dict[str, dict] = {f["id"]: f.copy() for f in schedule}

        # Simulation state
        self.state = SimulationState()
        self._event_lock = asyncio.Lock()

        # Initialise per-flight state
        for fid in self.schedule:
            self.state.flight_states[fid] = self._default_flight_state(fid)

        # ── Persistence ─────────────────────────────────────────────────
        # `repository`, when set, gets a snapshot after every state
        # transition (trigger/cancel/apply/unapply/reset) so a restart can
        # restore the timeline instead of losing it. One "scenario" spans
        # the engine's life between resets; a fresh scenario_id + RNG seed
        # is minted lazily on the first event triggered after boot/reset.
        self._repo = repository
        self.scenario_id: str | None = None
        self.rng_seed: int | None = None
        self._event_seq = 0

    def restore_from_repository(self) -> bool:
        """On boot, resume the most recent open scenario if the repository
        has one. Returns True if state was restored."""
        if self._repo is None:
            return False
        record = self._repo.load_latest_open_scenario()
        if record is None or record.state is None:
            return False
        self.scenario_id = record.id
        self.rng_seed = record.seed
        self._event_seq = len(record.events)
        self._restore_state_dict(record.state)
        logger.info(
            "Restored scenario %s (%s) — %d events, %d recovery plans",
            record.id,
            record.kind,
            len(record.events),
            len(self.state.recovery_plans),
        )
        return True

    def to_state_dict(self) -> dict:
        """Serialize the mutable SimulationState for persistence."""
        return {
            "sim_time": self.state.sim_time.isoformat(),
            "active_events": self.state.active_events,
            "flight_states": self.state.flight_states,
            "recovery_plans": self.state.recovery_plans,
            "cascade_summary": self.state.cascade_summary,
            "applied_plan_id": self.state.applied_plan_id,
            "flight_states_pre_apply": self.state.flight_states_pre_apply,
            "is_running": self.state.is_running,
            "event_history": self.state.event_history,
            "plan_context_hash": self.state.plan_context_hash,
            "predictions": self.state.predictions,
        }

    def _restore_state_dict(self, data: dict) -> None:
        self.state.sim_time = datetime.fromisoformat(data["sim_time"])
        self.state.active_events = data.get("active_events", [])
        self.state.flight_states = data.get("flight_states", {})
        self.state.recovery_plans = data.get("recovery_plans", [])
        self.state.cascade_summary = data.get("cascade_summary", {})
        self.state.applied_plan_id = data.get("applied_plan_id")
        self.state.flight_states_pre_apply = data.get("flight_states_pre_apply", {})
        self.state.is_running = data.get("is_running", False)
        self.state.event_history = data.get("event_history", [])
        self.state.plan_context_hash = data.get("plan_context_hash")
        self.state.predictions = data.get("predictions", {})

    def _snapshot(self) -> None:
        if self._repo is not None and self.scenario_id is not None:
            self._repo.snapshot(self.scenario_id, self.to_state_dict())

    # ─── Public API ───────────────────────────────────────────────────────

    async def trigger_event(
        self,
        event: dict,
        predictor: "CascadePredictor",
        optimizer: "RecoveryOptimizer",
        weather_client: "WeatherClient",
    ) -> dict:
        """Serialize state mutations while keeping the event loop responsive."""
        async with self._event_lock:
            self._services = (predictor, optimizer, weather_client)
            previous = copy.deepcopy(self.to_state_dict())
            generation = self._generation
            try:
                return await self._trigger_event_unlocked(
                    event, predictor, optimizer, weather_client
                )
            except BaseException:
                if generation == self._generation:
                    self._restore_state_dict(previous)
                raise

    async def _trigger_event_unlocked(
        self,
        event: dict,
        predictor: "CascadePredictor",
        optimizer: "RecoveryOptimizer",
        weather_client: "WeatherClient",
    ) -> dict:
        """
        Trigger a disruption event and compute cascade predictions + recovery plans.

        Returns the full simulation update payload that is also broadcast to
        all connected WebSocket clients.
        """
        # Stamp the event. A replayed event already carries its original id
        # and triggered_at — overwriting them here was the main source of
        # replay drift, since the cascade predictor's RNG seed is derived
        # from the event's own content (see CascadePredictor._rotation_predict).
        event = {
            **event,
            "id": event.get("id") or str(uuid.uuid4()),
            "triggered_at": event.get("triggered_at") or datetime.now(timezone.utc).isoformat(),
        }
        # A re-closure of an incident already in flight (a drone that reappears)
        # replaces that event with a merged one instead of stacking a second
        # independent disruption on the same airport.
        folded = fold_into_incident(self.state.active_events, event)
        if folded is not None:
            index, event = folded
            self.state.active_events[index] = event
        else:
            self.state.active_events.append(event)
        self.state.event_history.append(event)

        if self._repo is not None and self.scenario_id is None:
            self.scenario_id = str(uuid.uuid4())
            self.rng_seed = random.SystemRandom().randrange(1, 2**32)
            self._repo.create_scenario(
                self.scenario_id, event.get("kind", "unknown"), self.rng_seed
            )

        logger.info("Triggering event kind=%s id=%s", event.get("kind"), event["id"])

        # Gather weather context
        metar_data = weather_client.get_all_cached()

        predictions = await self._solve_active(predictor, optimizer, metar_data)

        # Build broadcast payload
        update: dict = {
            "type": "simulation_update",
            "event": event,
            "flight_states": self.state.flight_states,
            "cascade_summary": self.state.cascade_summary,
            "active_events": self.state.active_events,
            "applied_plan_id": self.state.applied_plan_id,
            "recovery_plans": self.state.recovery_plans,
            "predictions": predictions,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        if self._repo is not None and self.scenario_id is not None:
            self._repo.record_event(self.scenario_id, self._event_seq, event, metar_data)
            self._event_seq += 1
        self._snapshot()

        await self._broadcast(update)
        return update

    async def cancel_event(
        self, event_id: str, predictor=None, optimizer=None, weather_client=None
    ) -> bool:
        """Recompute remaining disruptions; never retain a plan for removed constraints."""
        async with self._event_lock:
            services = (
                (predictor, optimizer, weather_client) if predictor is not None else self._services
            )
            return await self._cancel_event_unlocked(event_id, services)

    async def _cancel_event_unlocked(self, event_id, services):
        remaining = [event for event in self.state.active_events if event.get("id") != event_id]
        if len(remaining) == len(self.state.active_events):
            return False

        if remaining and (services is None or any(service is None for service in services)):
            raise RuntimeError("Recovery services unavailable; cannot recompute remaining events")
        previous = copy.deepcopy(self.to_state_dict())
        generation = self._generation
        self.state.active_events = remaining
        metar_data = {}
        if remaining:
            predictor, optimizer, weather_client = services
            try:
                metar_data = weather_client.get_all_cached()
                await self._solve_active(predictor, optimizer, metar_data)
            except BaseException:
                if generation == self._generation:
                    self._restore_state_dict(previous)
                raise
        else:
            self.state.flight_states = {
                fid: self._default_flight_state(fid) for fid in self.schedule
            }
            self.state.recovery_plans = []
            self.state.cascade_summary = {}
            self.state.applied_plan_id = None
            self.state.flight_states_pre_apply = {}
            self.state.plan_context_hash = None
            self.state.predictions = {}

        if self._repo is not None and self.scenario_id is not None:
            self._repo.record_event(
                self.scenario_id,
                self._event_seq,
                {"operation": "cancel", "event_id": event_id},
                metar_data,
            )
            self._event_seq += 1
        self._snapshot()
        await self._broadcast(
            {
                "type": "event_cancelled",
                "event_id": event_id,
                "active_events": remaining,
                "applied_plan_id": self.state.applied_plan_id,
                "flight_states": self.state.flight_states,
                "cascade_summary": self.state.cascade_summary,
                "recovery_plans": self.state.recovery_plans,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        return True

    def _context_hash(self):
        inputs = [
            self.schedule,
            self.aircraft,
            self.crews,
            self.crew_members,
            self.state.active_events,
            self.decision_locks,
        ]
        return hashlib.sha256(json.dumps(inputs, sort_keys=True, default=str).encode()).hexdigest()

    async def solve_current(self, predictor, optimizer, weather_client, disrupted_flight_ids=None):
        """Re-solve the full active state, including dispatcher locks."""
        async with self._event_lock:
            self._services = (predictor, optimizer, weather_client)
            if set(disrupted_flight_ids or []) - set(self.schedule):
                raise ValueError("Unknown disrupted flight")
            predictions = await self._solve_active(
                predictor, optimizer, weather_client.get_all_cached(), disrupted_flight_ids
            )
            self._snapshot()
            update = {
                "type": "simulation_update",
                **self.to_state_dict(),
                "predictions": predictions,
            }
            await self._broadcast(update)
            return update

    async def _solve_active(self, predictor, optimizer, metar_data, disrupted_flight_ids=None):
        """One solve against all active constraints and their joint affected-flight union."""
        from src.optimizer.uncertain import horizon_from_constraints, solve_with_uncertain_horizon

        predictions = {}
        causes = {}
        context_hash = self._context_hash()
        generation = self._generation
        flights = list(self.schedule.values())
        for event in self.state.active_events:
            current = predictor.predict(
                flights=flights,
                event=event,
                metar_data=metar_data,
                current_time=datetime.fromisoformat(event["triggered_at"].replace("Z", "+00:00")),
            )
            for fid, pred in current.items():
                old = predictions.get(fid)
                if old is None or pred.get("expected_delay_min", 0) > old.get(
                    "expected_delay_min", 0
                ):
                    predictions[fid] = dict(pred)
                    causes[fid] = event["id"]
                if old and pred.get("cascade_order", -1) >= 0:
                    selected = predictions[fid]
                    selected["cascade_order"] = min(
                        v for v in (old.get("cascade_order", -1), pred["cascade_order"]) if v >= 0
                    )
                    selected["p_delayed"] = max(old.get("p_delayed", 0), pred.get("p_delayed", 0))
        # ponytail: simultaneous modeled impacts use max delay, not a sum that
        # double-counts overlapping closures; sequential event-time propagation is a future model.
        constraints = [
            {**constraint, "kind": event.get("kind", "")}
            for event in self.state.active_events
            for constraint in self._event_to_constraints(event)
        ]
        kwargs = dict(
            schedule=flights,
            aircraft=list(self.aircraft.values()),
            crews=list(self.crews.values()),
            events=constraints,
            disrupted_flights=sorted(
                set(disrupted_flight_ids or [])
                | {fid for fid, pred in predictions.items() if pred.get("cascade_order", -1) >= 0}
            ),
            cascade_predictions=predictions,
        )
        if self.decision_locks:
            kwargs["decision_locks"] = self.decision_locks
        if self.crew_members is not None:
            kwargs["crew_members"] = self.crew_members
        horizon = horizon_from_constraints(constraints)
        if horizon and len(self.state.active_events) == 1:
            plans = await asyncio.to_thread(
                solve_with_uncertain_horizon, optimizer, horizon=horizon, **kwargs
            )
        else:
            plans = await asyncio.to_thread(optimizer.solve, **kwargs)
        if generation != self._generation or context_hash != self._context_hash():
            raise RuntimeError(
                "Simulation inputs changed while solving; discard stale result and retry"
            )
        self.state.flight_states = {fid: self._default_flight_state(fid) for fid in self.schedule}
        for fid, pred in predictions.items():
            if fid in self.state.flight_states and pred.get("cascade_order", -1) >= 0:
                delay = pred.get("expected_delay_min", 0)
                self.state.flight_states[fid].update(
                    status="delayed" if delay > 0 else "scheduled",
                    delay_minutes=delay,
                    cascade_order=pred["cascade_order"],
                    p_delayed=pred.get("p_delayed", 0),
                    last_event_id=causes.get(fid),
                    reason=pred.get("reason", ""),
                )
        self.state.recovery_plans = [
            p.to_dict() if hasattr(p, "to_dict") else self._plan_to_dict(p) for p in plans
        ]
        self.state.cascade_summary = self._compute_cascade_summary(predictions)
        self.state.cascade_summary["composition"] = "simultaneous_max_delay"
        self.state.cascade_summary["uncertainty_evaluation"] = (
            "not_evaluated_joint_events"
            if horizon and len(self.state.active_events) > 1
            else "sampled_single_event"
            if horizon
            else "not_requested"
        )
        self.state.cascade_summary["weather_basis"] = "frozen_at_solve"
        self.state.cascade_summary["weather_snapshot_hash"] = hashlib.sha256(
            json.dumps(metar_data, sort_keys=True, default=str).encode()
        ).hexdigest()
        self.state.applied_plan_id = None
        self.state.flight_states_pre_apply = {}
        self.state.plan_context_hash = context_hash
        self.state.predictions = predictions
        return predictions

    def reset(self) -> None:
        """Reset simulation to clean initial state (no events, no delays)."""
        self._generation += 1
        for fid in self.schedule:
            self.state.flight_states[fid] = self._default_flight_state(fid)
        self.state.active_events.clear()
        self.state.recovery_plans.clear()
        self.state.cascade_summary = {}
        self.state.applied_plan_id = None
        self.state.flight_states_pre_apply = {}
        self.state.plan_context_hash = None
        self.state.predictions = {}
        # Keep event_history for audit log

        # Close out the persisted scenario (if any) — the next triggered
        # event mints a fresh scenario_id/seed rather than appending to a
        # timeline that's just been wiped.
        if self._repo is not None and self.scenario_id is not None:
            self._repo.close_scenario(self.scenario_id)
        self.scenario_id = None
        self.rng_seed = None
        self._event_seq = 0
        logger.info("Simulation state reset")

    def reseed(self, schedule: list[dict], aircraft: list[dict]) -> None:
        """Replace the working schedule + fleet (e.g. with one derived from a
        live ADS-B snapshot) and re-initialise per-flight state. Events,
        plans, and the persisted scenario are cleared — same lifecycle as
        reset(). Crews are left untouched: live traffic carries no pairings,
        and both the predictor and the optimizer tolerate flights without
        pairings (they just report zero crew violations)."""
        self._generation += 1
        self.schedule = {f["id"]: f.copy() for f in schedule}
        self.aircraft = {a["id"]: a.copy() for a in aircraft}
        self.state.flight_states = {fid: self._default_flight_state(fid) for fid in self.schedule}
        self.state.active_events.clear()
        self.state.recovery_plans.clear()
        self.state.cascade_summary = {}
        self.state.applied_plan_id = None
        self.state.flight_states_pre_apply = {}
        self.state.plan_context_hash = None
        self.state.predictions = {}
        if self._repo is not None and self.scenario_id is not None:
            self._repo.close_scenario(self.scenario_id)
        self.scenario_id = None
        self.rng_seed = None
        self._event_seq = 0
        logger.info(
            "Simulation reseeded — %d flights now in the working schedule", len(self.schedule)
        )

    # ── Apply / unapply a recovery plan ───────────────────────────────────────
    #
    # The right-rail Apply button only flipped a client-side flag before this
    # was wired in. Now applying a plan mutates the canonical flight_states
    # and broadcasts an `apply_plan` update so every connected tab (cascade,
    # carbon, crew, passengers, plans) sees the committed action set without
    # having to refresh.
    #
    # We snapshot the prior flight_states into `flight_states_pre_apply` so
    # the operator can unapply and revert exactly — no re-running the
    # cascade predictor required.

    async def apply_plan(self, plan_id: str) -> dict:
        """Commit the chosen plan's cancellations + delays + swaps onto the
        live simulation state and broadcast."""
        async with self._event_lock:
            return await self._apply_plan_unlocked(plan_id)

    async def _apply_plan_unlocked(self, plan_id: str) -> dict:
        plan = next(
            (p for p in self.state.recovery_plans if p.get("plan_id") == plan_id),
            None,
        )
        if plan is None:
            raise KeyError(f"Plan {plan_id} not found — solve first.")
        if plan.get("status") not in {"optimal", "feasible", "heuristic"}:
            raise ValueError(f"Plan {plan_id} cannot be applied: status {plan.get('status')!r}.")
        if plan.get("crew_violations", 0) or (plan.get("validation") or {}).get("status") == "fail":
            raise ValueError(f"Plan {plan_id} has failed modeled constraints; solve again")
        if (
            self.state.plan_context_hash is not None
            and self.state.plan_context_hash != self._context_hash()
        ) or (self.state.active_events and self.state.plan_context_hash is None):
            raise RuntimeError("Plan inputs are stale; solve again before applying")

        # If a different plan is already applied, restore from snapshot first
        # so we don't compound two plans' decisions on top of each other.
        if self.state.applied_plan_id and self.state.flight_states_pre_apply:
            for fid, snap in self.state.flight_states_pre_apply.items():
                self.state.flight_states[fid] = dict(snap)

        # Snapshot whatever we are about to overwrite, but only on the FIRST
        # apply of this disruption cycle. Subsequent applies still revert to
        # the *original* cascade state, not the previously-applied state.
        if not self.state.applied_plan_id:
            self.state.flight_states_pre_apply = {
                fid: dict(s) for fid, s in self.state.flight_states.items()
            }

        # 1. Cancelled flights → status: cancelled, delay reset to 0.
        for fid in plan.get("cancelled_flights", []) or []:
            if fid in self.state.flight_states:
                self.state.flight_states[fid].update(
                    {
                        "status": "cancelled",
                        "delay_minutes": 0,
                        "applied_action": "cancelled",
                        "applied_plan_id": plan_id,
                    }
                )

        # 2. Delayed flights → set the new delay_minutes.
        for d in plan.get("delayed_flights", []) or []:
            fid = d.get("flight_id")
            if fid and fid in self.state.flight_states:
                self.state.flight_states[fid].update(
                    {
                        "status": "delayed",
                        "delay_minutes": int(d.get("delay_minutes", 0) or 0),
                        "new_departure": d.get("new_departure"),
                        "applied_action": "delayed",
                        "applied_plan_id": plan_id,
                    }
                )

        # 3. Aircraft swaps → update the tail on the affected flight. The
        # schedule snapshot merges state OVER the flight dict, so writing
        # `aircraft_id` here is what actually surfaces the new tail in the
        # UI (which keys on aircraft_id, not `tail`).
        for s in plan.get("aircraft_swaps", []) or []:
            fid = s.get("flight_id")
            if fid and fid in self.state.flight_states:
                new_tail = s.get("new_aircraft", "")
                self.state.flight_states[fid].update(
                    {
                        "aircraft_id": new_tail or self.schedule.get(fid, {}).get("aircraft_id"),
                        "tail": new_tail or self.state.flight_states[fid].get("tail"),
                        "applied_action": "swapped",
                        "applied_plan_id": plan_id,
                    }
                )

        self.state.applied_plan_id = plan_id
        # Refresh the cascade summary so secondary pages reading
        # cascadeSummary.total_affected get the post-apply view.
        self.state.cascade_summary = self._cascade_summary_from_states()
        self._snapshot()

        update = {
            "type": "plan_applied",
            "plan_id": plan_id,
            "applied_plan_id": plan_id,
            "flight_states": self.state.flight_states,
            "cascade_summary": self.state.cascade_summary,
            "recovery_plans": self.state.recovery_plans,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(update)
        logger.info(
            "Plan %s applied — %d cancelled, %d delayed, %d swapped",
            plan_id,
            len(plan.get("cancelled_flights") or []),
            len(plan.get("delayed_flights") or []),
            len(plan.get("aircraft_swaps") or []),
        )
        return update

    async def unapply_plan(self) -> dict:
        """Restore flight_states from the pre-apply snapshot and broadcast."""
        async with self._event_lock:
            return await self._unapply_plan_unlocked()

    async def _unapply_plan_unlocked(self) -> dict:
        if not self.state.flight_states_pre_apply:
            # Nothing to revert — just clear the marker and announce.
            self.state.applied_plan_id = None
        else:
            for fid, snap in self.state.flight_states_pre_apply.items():
                self.state.flight_states[fid] = dict(snap)
            self.state.flight_states_pre_apply = {}
            self.state.applied_plan_id = None
            self.state.cascade_summary = self._cascade_summary_from_states()

        self._snapshot()

        update = {
            "type": "plan_unapplied",
            "applied_plan_id": None,
            "flight_states": self.state.flight_states,
            "cascade_summary": self.state.cascade_summary,
            "recovery_plans": self.state.recovery_plans,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._broadcast(update)
        logger.info("Plan unapplied — reverted to pre-apply snapshot")
        return update

    def _cascade_summary_from_states(self) -> dict:
        """Recompute the cascade summary from current flight_states. Used
        after apply/unapply so the dashboard's cascade strip stays in sync
        with the committed plan."""
        orders = [s.get("cascade_order", -1) for s in self.state.flight_states.values()]
        delays = [s.get("delay_minutes", 0) for s in self.state.flight_states.values()]
        return {
            **{
                key: value
                for key, value in self.state.cascade_summary.items()
                if key
                in {
                    "composition",
                    "uncertainty_evaluation",
                    "weather_basis",
                    "weather_snapshot_hash",
                }
            },
            "directly_affected": orders.count(0),
            "cascade_1": orders.count(1),
            "cascade_2": orders.count(2),
            "total_affected": sum(1 for o in orders if o >= 0),
            "unaffected": orders.count(-1),
            "total_delay_minutes": sum(delays),
        }

    def add_subscriber(self, ws: "WebSocket") -> None:
        self.state.ws_subscribers.add(ws)
        logger.debug("WebSocket subscriber added (total: %d)", len(self.state.ws_subscribers))

    def remove_subscriber(self, ws: "WebSocket") -> None:
        self.state.ws_subscribers.discard(ws)
        logger.debug("WebSocket subscriber removed (total: %d)", len(self.state.ws_subscribers))

    def get_schedule_snapshot(self) -> list[dict]:
        """Return merged schedule + current state for each flight."""
        result = []
        for fid, flight in self.schedule.items():
            state = self.state.flight_states.get(fid, {})
            result.append({**flight, **state})
        return result

    def get_state_summary(self) -> dict:
        """Return a summary of the current simulation state."""
        statuses = [s.get("status", "scheduled") for s in self.state.flight_states.values()]
        return {
            "sim_time": self.state.sim_time.isoformat(),
            "is_running": self.state.is_running,
            "active_events": len(self.state.active_events),
            "total_flights": len(self.schedule),
            "status_breakdown": {
                "scheduled": statuses.count("scheduled"),
                "delayed": statuses.count("delayed"),
                "cancelled": statuses.count("cancelled"),
                "diverted": statuses.count("diverted"),
            },
            "recovery_plans_available": len(self.state.recovery_plans),
            "ws_subscribers": len(self.state.ws_subscribers),
        }

    # ─── Internal helpers ─────────────────────────────────────────────────

    def _default_flight_state(self, fid: str) -> dict:
        return {
            "flight_id": fid,
            "status": "scheduled",
            "delay_minutes": 0,
            "cascade_order": -1,
            "p_delayed": 0.0,
            "last_event_id": None,
        }

    def _event_to_constraints(self, event: dict) -> list[dict]:
        """Convert a triggered event dict into optimizer constraint dicts."""
        original_kind = event.get("kind", "")
        kind = constraint_kind_for(original_kind)
        params = event.get("params", {})
        constraints: list[dict] = []

        if kind in ("weather_closure", "security_event"):
            constraints.append(
                {
                    "type": "airport_unavailable",
                    "airport": params.get("airport", ""),
                    "start": params.get("start", "T+0h"),
                    "end": params.get("end", "T+4h"),
                    "severity": params.get("severity", "moderate"),
                }
            )

        elif kind == "ground_stop":
            constraints.append(
                {
                    "type": "ground_stop",
                    "destination_airport": params.get("destination_airport", ""),
                    "affected_origins": params.get("affected_origins", []),
                    "start": params.get("start", "T+0h"),
                    "end": params.get("end", "T+2h"),
                }
            )

        elif kind == "mechanical_aog":
            constraints.append(
                {
                    "type": "aircraft_grounded",
                    "aircraft_tail": params.get("aircraft_tail", ""),
                    "duration_hours": params.get("duration_hours", 6),
                    "location_airport": params.get("location_airport", ""),
                }
            )

        elif kind == "runway_closure":
            constraints.append(
                {
                    "type": "capacity_reduced",
                    "airport": params.get("airport", ""),
                    "capacity_reduction_pct": params.get("capacity_cut_pct", 40),
                    "start": params.get("start", "T+0h"),
                    "end": params.get("end", "T+3h"),
                }
            )

        elif kind == "drone_incursion":
            constraints.append(
                {
                    "type": "capacity_reduced",
                    "airport": params.get("airport", ""),
                    "runways": params.get("runways", []),
                    "capacity_reduction_pct": params.get("capacity_cut_pct", 100),
                    "detection": params.get("detection", "radar"),
                    "start": params.get("start", "T+0h"),
                    # Deliberately no `end` — the closure length is unknown.
                    # The distribution is what the optimizer solves across.
                    "duration_dist": drone_duration_distribution(params),
                    "reopen_count": params.get("reopen_count", 0),
                }
            )

        elif kind == "atc_staffing":
            constraints.append(
                {
                    "type": "atc_gdp",
                    "facility_id": params.get("facility_id", ""),
                    "affected_airports": params.get("affected_airports", []),
                    "average_delay_minutes": params.get("average_delay_minutes", 30),
                    "start": params.get("start", "T+0h"),
                    "end": params.get("end", "T+6h"),
                }
            )

        elif kind == "crew_sickout":
            constraints.append(
                {
                    "type": "crew_unavailable",
                    "affected_bases": params.get("affected_bases", []),
                    # UI sends "percent_affected"; YAML scenarios use "callout_pct"
                    "callout_pct": params.get("callout_pct", params.get("percent_affected", 15)),
                    "duration_hours": params.get("duration_hours", 24),
                }
            )

        elif kind == "airspace_closure":
            constraints.append(
                {
                    "type": "airspace_unavailable",
                    "center_lat": params.get("center_lat"),
                    "center_lon": params.get("center_lon"),
                    "radius_nm": params.get("radius_nm", 30),
                    "start": params.get("start", "T+0h"),
                    "end": params.get("end", "T+3h"),
                }
            )

        elif kind == "volcanic_ash":
            constraints.append(
                {
                    "type": "airspace_unavailable",
                    "subtype": "ash_exclusion",
                    "center_lat": params.get("volcano_lat"),
                    "center_lon": params.get("volcano_lon"),
                    "radius_nm": params.get("ash_cloud_radius_nm", 150),
                    "start": params.get("start", "T+0h"),
                    "end": params.get("end", "T+12h"),
                }
            )

        elif kind == "cyber_incident":
            constraints.append(
                {
                    "type": "system_degradation",
                    "incident_type": params.get("incident_type", "check_in_outage"),
                    "affected_hubs": params.get("affected_hubs", []),
                    "degradation_pct": float(params.get("degradation_pct", 0)),
                    "end": params.get("system_restored_at", "T+4h"),
                }
            )

        for constraint in constraints:
            constraint["kind"] = original_kind
        return constraints

    def _compute_cascade_summary(self, predictions: dict[str, dict]) -> dict:
        orders = [p.get("cascade_order", -1) for p in predictions.values()]
        delays = [
            p.get("expected_delay_min", 0)
            for p in predictions.values()
            if p.get("cascade_order", -1) >= 0
        ]
        return {
            "directly_affected": orders.count(0),
            "cascade_1": orders.count(1),
            "cascade_2": orders.count(2),
            "total_affected": sum(1 for o in orders if o >= 0),
            "unaffected": orders.count(-1),
            "total_delay_minutes": sum(delays),
        }

    def _plan_to_dict(self, plan: Any) -> dict:
        """Convert a RecoveryPlan to a plain dict (handles both dataclass and object)."""
        try:
            from dataclasses import asdict

            return asdict(plan)
        except Exception:
            attrs = [
                "plan_id",
                "objective_label",
                "status",
                "solve_time_ms",
                "cancelled_flights",
                "delayed_flights",
                "aircraft_swaps",
                "crew_reassignments",
                "total_cost_usd",
                "total_passenger_delay_minutes",
                "crew_violations",
                "aircraft_out_of_position",
                "summary",
            ]
            return {attr: getattr(plan, attr, None) for attr in attrs}

    async def _broadcast(self, message: dict) -> None:
        """Send a JSON message to all active WebSocket subscribers."""
        if not self.state.ws_subscribers:
            return

        payload = json.dumps(message, default=str)
        dead: set = set()

        # Iterate a SNAPSHOT: each `await send_text` yields to the event loop,
        # where a tab connecting/disconnecting mutates the live subscriber set
        # — iterating it directly raises "Set changed size during iteration"
        # and 500s the triggering request with 2+ tabs open.
        for ws in list(self.state.ws_subscribers):
            try:
                await ws.send_text(payload)
            except Exception as exc:
                logger.debug("WebSocket send failed: %s", exc)
                dead.add(ws)

        self.state.ws_subscribers -= dead
