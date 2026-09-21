"""Conservative aircraft eligibility; no speculative ferry or type substitution."""

import math
from datetime import datetime, timedelta


def validate_decision_locks(decision_locks, schedule, aircraft):
    """Validate only supported dispatcher actions; never silently discard a lock."""
    if decision_locks is None:
        return []
    if not isinstance(decision_locks, list):
        raise ValueError("decision_locks must be a list")
    flight_ids = {f["id"] for f in schedule}
    tails = {a["id"] for a in aircraft}
    result, seen = [], set()
    for lock in decision_locks:
        if not isinstance(lock, dict) or set(lock) - {
            "flight_id",
            "cancel",
            "delay_minutes",
            "aircraft_id",
        }:
            raise ValueError("Unsupported dispatcher decision")
        fid = lock.get("flight_id")
        if not isinstance(fid, str) or fid not in flight_ids or fid in seen:
            raise ValueError("Unknown or duplicate locked flight")
        if len(lock) < 2:
            raise ValueError("A decision lock needs an action")
        if "cancel" in lock and not isinstance(lock["cancel"], bool):
            raise ValueError("cancel must be boolean")
        if "delay_minutes" in lock and (
            not isinstance(lock["delay_minutes"], int)
            or isinstance(lock["delay_minutes"], bool)
            or not 0 <= lock["delay_minutes"] <= 10080
        ):
            raise ValueError("delay_minutes must be an integer between 0 and 10080")
        if "aircraft_id" in lock and (
            not isinstance(lock["aircraft_id"], str) or lock["aircraft_id"] not in tails
        ):
            raise ValueError("Unknown locked aircraft")
        if lock.get("cancel") and ("aircraft_id" in lock or "delay_minutes" in lock):
            raise ValueError("A cancelled flight cannot also be delayed or assigned an aircraft")
        seen.add(fid)
        result.append(dict(lock))
    return result


def flight_window(flight, predictions):
    try:
        delay = timedelta(
            minutes=max(0, predictions.get(flight["id"], {}).get("expected_delay_min", 0))
        )
        start = datetime.fromisoformat(flight["scheduled_departure"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(flight["scheduled_arrival"].replace("Z", "+00:00"))
        if start.tzinfo is None or end.tzinfo is None or end <= start:
            return None
        return start + delay, end + delay
    except (KeyError, TypeError, ValueError, OverflowError):
        return None


def aircraft_available(flight, tail, flights, aircraft, predictions, grounded):
    """Require known capacity/type/location and room between adjacent rotations.

    The existing schedule is reserved even if another action might cancel a leg.
    This intentionally misses some feasible chains rather than inventing a ferry.
    """
    ac = aircraft.get(tail, {})
    original = aircraft.get(flight.get("aircraft_id"), {})
    window = flight_window(flight, predictions)
    if tail in grounded or not window or not flight.get("origin") or not flight.get("destination"):
        return False
    if not ac.get("type") or ac.get("type") != original.get("type"):
        return False
    seats, passengers, turn = ac.get("seats"), flight.get("passengers"), ac.get("min_turn_minutes")
    if any(
        isinstance(v, bool) or not isinstance(v, (int, float)) for v in (seats, passengers, turn)
    ):
        return False
    if not (
        all(math.isfinite(v) for v in (seats, passengers, turn))
        and seats >= passengers >= 0
        and 0 <= turn <= 1440
    ):
        return False
    start, end = window
    turn = timedelta(minutes=turn)
    previous, following = [], []
    for other in flights.values():
        if other.get("aircraft_id") != tail or other["id"] == flight["id"]:
            continue
        other_window = flight_window(other, predictions)
        if not other_window:
            return False
        dep, arr = other_window
        if arr + turn <= start:
            previous.append((arr, other))
        elif end + turn <= dep:
            following.append((dep, other))
        else:
            return False
    location = (
        max(previous, key=lambda item: item[0])[1].get("destination")
        if previous
        else (ac.get("current_airport_id") or ac.get("base_airport_id"))
    )
    if location != flight["origin"]:
        return False
    if (
        following
        and min(following, key=lambda item: item[0])[1].get("origin") != flight["destination"]
    ):
        return False
    return True
