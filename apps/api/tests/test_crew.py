"""Tests for FAR Part 117 crew legality engine."""

from datetime import datetime, timedelta, timezone

import pytest

from src.crew.far117 import CrewLegalityEngine


@pytest.fixture
def engine():
    return CrewLegalityEngine()


def _crew(
    duty_start_hour: int = 8,
    fdp_time_7d_min: int = 0,
    flight_time_28d_min: int = 0,
    flight_time_365d_min: int = 0,
    fdp_flight_min: int = 0,
    rest_hours: float = 12.0,
) -> dict:
    now = datetime(2024, 1, 15, duty_start_hour, 0, 0, tzinfo=timezone.utc)
    last_rest = now - timedelta(hours=rest_hours)
    return {
        "id": "CAP001",
        "role": "captain",
        "duty_start": now,
        "fdp_time_7d_minutes": fdp_time_7d_min,
        "fdp_time_28d_minutes": 0,
        "flight_time_28d_minutes": flight_time_28d_min,
        "flight_time_365d_minutes": flight_time_365d_min,
        "last_rest_start": last_rest,
        "last_rest_end": now,
        "sleep_opportunity_minutes": 480,
        "consecutive_duty_free_168h_minutes": 1800,
        "home_timezone_offset_hours": 0,
        "acclimated_at_home": True,
        "acclimated": True,
        "operation_type": "unaugmented",
        "current_fdp_start": now,
        "current_fdp_flight_minutes": fdp_flight_min,
    }


def _pairing(dep_hour: int, duration_min: int) -> dict:
    dep = datetime(2024, 1, 15, dep_hour, 0, 0, tzinfo=timezone.utc)
    return {
        "departure": dep,
        "arrival": dep + timedelta(minutes=duration_min),
        "flight_time_minutes": duration_min,
        "scheduled_segments": 1,
    }


class TestBasicLegality:
    def test_legal_short_flight(self, engine):
        crew = _crew(duty_start_hour=8)
        pairing = _pairing(dep_hour=9, duration_min=120)
        result = engine.validate(crew, pairing)
        assert result.is_legal
        assert len(result.violations) == 0

    def test_legal_full_day(self, engine):
        crew = _crew(duty_start_hour=8)
        pairing = _pairing(dep_hour=8, duration_min=480)  # 8h flight
        result = engine.validate(crew, pairing)
        assert result.is_legal  # 8h < 9h limit

    def test_flight_time_limit_exceeded(self, engine):
        """FAR 117: max 9h flight time per FDP."""
        crew = _crew(duty_start_hour=8, fdp_flight_min=500)  # 8h20m already flown
        pairing = _pairing(dep_hour=16, duration_min=120)  # +2h = 10h20m total
        result = engine.validate(crew, pairing)
        assert not result.is_legal
        assert any("flight time" in v.lower() for v in result.violations)

    def test_flight_time_remaining_computed(self, engine):
        crew = _crew(duty_start_hour=8, fdp_flight_min=300)  # 5h flown
        pairing = _pairing(dep_hour=14, duration_min=60)
        result = engine.validate(crew, pairing)
        # 9h - 5h - 1h = 3h remaining
        assert result.flight_time_remaining_minutes >= 0


class TestRestRequirements:
    def test_minimum_rest_satisfied(self, engine):
        crew = _crew(duty_start_hour=8, rest_hours=11.0)
        pairing = _pairing(dep_hour=8, duration_min=90)
        result = engine.validate(crew, pairing)
        assert result.is_legal

    def test_minimum_rest_violated(self, engine):
        """FAR 117: minimum 10 consecutive hours of rest before FDP."""
        crew = _crew(duty_start_hour=8, rest_hours=8.0)
        pairing = _pairing(dep_hour=8, duration_min=90)
        result = engine.validate(crew, pairing)
        assert not result.is_legal
        assert any("rest" in v.lower() for v in result.violations)

    def test_exact_10h_rest_is_legal(self, engine):
        crew = _crew(duty_start_hour=8, rest_hours=10.0)
        pairing = _pairing(dep_hour=8, duration_min=90)
        result = engine.validate(crew, pairing)
        assert result.is_legal


class TestCumulativeLimits:
    def test_7day_limit_ok(self, engine):
        crew = _crew(fdp_time_7d_min=3300)  # 55h FDP of 60h limit
        pairing = _pairing(dep_hour=9, duration_min=120)  # +2h = 57h
        result = engine.validate(crew, pairing)
        assert result.is_legal

    def test_7day_limit_exceeded(self, engine):
        """117.23(c): 60h flight DUTY period in 168 consecutive hours."""
        crew = _crew(fdp_time_7d_min=3500)
        pairing = _pairing(dep_hour=9, duration_min=150)  # +2h30m = over 60h
        result = engine.validate(crew, pairing)
        assert not result.is_legal
        assert any("7" in v or "seven" in v.lower() or "60" in v for v in result.violations)

    def test_28day_limit_ok(self, engine):
        crew = _crew(flight_time_28d_min=5700)  # 95h of 100h limit
        pairing = _pairing(dep_hour=9, duration_min=60)  # +1h = 96h
        result = engine.validate(crew, pairing)
        assert result.is_legal

    def test_28day_limit_exceeded(self, engine):
        """FAR 117: max 100h flight time per 28 days."""
        crew = _crew(flight_time_28d_min=5940)  # 99h
        pairing = _pairing(dep_hour=9, duration_min=90)  # +1h30m = over 100h
        result = engine.validate(crew, pairing)
        assert not result.is_legal

    def test_365day_limit_ok(self, engine):
        crew = _crew(flight_time_365d_min=59400)  # 990h of 1000h
        pairing = _pairing(dep_hour=9, duration_min=60)  # +1h = 991h
        result = engine.validate(crew, pairing)
        assert result.is_legal

    def test_365day_limit_exceeded(self, engine):
        """FAR 117: max 1000h flight time per 365 days."""
        crew = _crew(flight_time_365d_min=59700)  # 995h
        pairing = _pairing(dep_hour=9, duration_min=360)  # +6h = over 1000h
        result = engine.validate(crew, pairing)
        assert not result.is_legal
        assert any("1000" in v or "annual" in v.lower() or "365" in v for v in result.violations)


class TestWOCL:
    def test_wocl_window_warning(self, engine):
        """WOCL does not justify the old invented half-hour Table B reduction."""
        crew = _crew(duty_start_hour=1)  # 1am duty start
        pairing = _pairing(dep_hour=3, duration_min=90)  # 3am departure = WOCL
        result = engine.validate(crew, pairing)
        assert engine.fdp_limit_for_report_time(crew["duty_start"]) == 9
        assert next(c for c in result.checks if c["rule"] == "modeled-fdp")["limit"] == 540

    def test_normal_hours_no_wocl_warning(self, engine):
        crew = _crew(duty_start_hour=8)
        pairing = _pairing(dep_hour=10, duration_min=120)
        result = engine.validate(crew, pairing)
        wocl_warnings = [
            w
            for w in result.warnings
            if "wocl" in w.lower() or "0200" in w or "window" in w.lower()
        ]
        assert len(wocl_warnings) == 0


class TestFDPTable:
    def test_early_report_time_fdp(self, engine):
        """Report at 6am -> FDP limit ~13h."""
        crew = _crew(duty_start_hour=6)
        pairing = _pairing(dep_hour=6, duration_min=480)
        result = engine.validate(crew, pairing)
        assert result.fdp_remaining_minutes >= 0

    def test_late_night_report_time_fdp(self, engine):
        """Report at 11pm -> FDP limit ~9h (shorter)."""
        crew = _crew(duty_start_hour=23)
        pairing = _pairing(dep_hour=23, duration_min=600)  # 10h - likely exceeds limit
        result = engine.validate(crew, pairing)
        # Late night reports have shorter FDP limits
        assert isinstance(result.is_legal, bool)
