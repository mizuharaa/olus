"""Supported Part 117 checks, not dispatch certification.
Source verified 2026-09-20: https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-117
Unaugmented acclimated lineholders only. Other operating modes require further rules.
"""

import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

MIN_REST_HOURS = 10.0
MAX_FT_PER_FDP_HOURS = 9.0
MAX_FT_28_DAYS_HOURS = 100.0
MAX_FT_365_DAYS_HOURS = 1000.0
MAX_FDP_7_DAYS_HOURS = 60.0
MAX_FDP_28_DAYS_HOURS = 190.0
MIN_TURN_MINUTES = 30  # Operational assumption, not Part 117.
RULE_SOURCE = "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-117"
SCOPE = "Supported acclimated unaugmented lineholder checks only; not complete FAR Part 117 certification."
FDP_TABLE = {
    **dict.fromkeys(range(4), (9, 9, 9, 9, 9, 9, 9)),
    4: (10, 10, 10, 10, 9, 9, 9),
    5: (12, 12, 12, 12, 11.5, 11, 10.5),
    6: (13, 13, 12, 12, 11.5, 11, 10.5),
    **dict.fromkeys(range(7, 12), (14, 14, 13, 13, 12.5, 12, 11.5)),
    12: (13, 13, 13, 13, 12.5, 12, 11.5),
    **dict.fromkeys(range(13, 17), (12, 12, 12, 12, 11.5, 11, 10.5)),
    **dict.fromkeys(range(17, 22), (12, 12, 11, 11, 10, 9, 9)),
    22: (11, 11, 10, 10, 9, 9, 9),
    23: (10, 10, 10, 9, 9, 9, 9),
}


def _number(value):
    return (
        float(value)
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
        else None
    )


@dataclass
class LegalityResult:
    is_legal: bool
    violations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    flight_time_remaining_minutes: int = 0
    fdp_remaining_minutes: int = 0
    rest_required_before_minutes: int | None = None
    status: str = "unknown"
    unknowns: list[str] = field(default_factory=list)
    checks: list[dict] = field(default_factory=list)
    scope: str = SCOPE

    def to_dict(self):
        return asdict(self)


@dataclass
class CrewState:
    id: str
    role: str
    last_rest_end: datetime | None = None
    last_rest_duration_hours: float | None = None
    current_fdp_start: datetime | None = None
    current_fdp_flight_minutes: int = 0
    flight_time_7d_minutes: int = 0  # Legacy data, NOT a statutory flight-time limit.
    flight_time_28d_minutes: int = 0
    flight_time_365d_minutes: int = 0
    home_timezone_offset_hours: float = 0.0

    def fdp_elapsed_minutes(self, at_time):
        return (
            int((at_time - self.current_fdp_start).total_seconds() / 60)
            if self.current_fdp_start
            else 0
        )

    def max_fdp_hours(self, report_time, wocl_check=True, scheduled_segments=1):
        # Compatibility argument only: no invented WOCL subtraction.
        return CrewLegalityEngine().fdp_limit_for_report_time(
            report_time, self.home_timezone_offset_hours, scheduled_segments
        )


class CrewLegalityEngine:
    MIN_REST = timedelta(hours=MIN_REST_HOURS)
    MIN_TURN = timedelta(minutes=MIN_TURN_MINUTES)

    @staticmethod
    def _local_report(report, offset):
        utc = report.astimezone(timezone.utc) if report.tzinfo else report
        return utc + timedelta(hours=offset)

    def fdp_limit_for_report_time(self, report_time, tz_offset_hours=0.0, scheduled_segments=1):
        if (
            not isinstance(scheduled_segments, int)
            or isinstance(scheduled_segments, bool)
            or scheduled_segments < 1
        ):
            raise ValueError("scheduled_segments must be a positive integer")
        return float(
            FDP_TABLE[self._local_report(report_time, tz_offset_hours).hour][
                min(scheduled_segments, 7) - 1
            ]
        )

    def flight_time_limit_for_report_time(self, report_time, tz_offset_hours=0.0):
        return 9.0 if 5 <= self._local_report(report_time, tz_offset_hours).hour < 20 else 8.0

    def validate(self, crew, proposed_pairing):
        """History totals exclude this FDP; current_fdp_flight_minutes includes
        its earlier legs. scheduled_segments is the total scheduled FDP count.
        last_rest_start/end describe rest itself, not elapsed time since rest.
        """
        out = LegalityResult(False)

        def check(rule, label, value, limit, inputs=None, minimum=False):
            slack = (
                None
                if value is None or limit is None
                else value - limit
                if minimum
                else limit - value
            )
            status = "unknown" if slack is None else "pass" if slack >= 0 else "fail"
            out.checks.append(
                dict(
                    rule=rule,
                    label=label,
                    value=value,
                    limit=limit,
                    slack=slack,
                    unit="minutes",
                    status=status,
                    inputs=inputs or {},
                    source=RULE_SOURCE,
                )
            )
            if status == "fail":
                out.violations.append(f"{label}: {value:g} minutes; limit {limit:g} minutes")
            elif status == "unknown":
                out.unknowns.append(label)
            return slack

        dep = self._to_dt(proposed_pairing.get("departure"))
        arr = self._to_dt(proposed_pairing.get("arrival"))
        report = self._to_dt(crew.get("current_fdp_start") or crew.get("duty_start"))
        timestamps = [t for t in (dep, arr, report) if t]
        if len({t.tzinfo is not None for t in timestamps}) > 1:
            out.status = "fail"
            out.violations.append("Mixed timezone-aware and naive timestamps")
            return out
        if not dep or not arr or arr <= dep or (report and report > dep):
            out.violations.append("Invalid departure, arrival or duty report chronology")
            out.status = "fail"
            return out
        if any(t.tzinfo is None for t in timestamps):
            out.unknowns.append("Timezone-aware timestamps required")
        ft = _number(proposed_pairing.get("flight_time_minutes"))
        prior_ft = _number(crew.get("current_fdp_flight_minutes"))
        total_ft = prior_ft + ft if ft is not None and prior_ft is not None else None
        elapsed = (arr - report).total_seconds() / 60 if report else None
        segments = proposed_pairing.get("scheduled_segments", crew.get("scheduled_segments"))
        offset = crew.get("acclimated_timezone_offset_hours")
        if offset is None and crew.get("acclimated_at_home") is True:
            offset = crew.get("home_timezone_offset_hours")
        offset_valid = (
            isinstance(offset, (int, float))
            and not isinstance(offset, bool)
            and math.isfinite(offset)
            and -14 <= offset <= 14
        )
        scope_known = crew.get("acclimated") is True and crew.get("operation_type") == "unaugmented"
        if not scope_known:
            out.unknowns.append("Acclimated unaugmented lineholder scope not confirmed")
        clock_known = bool(report and report.tzinfo and offset_valid and scope_known)
        max_ft = (
            self.flight_time_limit_for_report_time(report, offset) * 60 if clock_known else None
        )
        segment_known = (
            isinstance(segments, int) and not isinstance(segments, bool) and segments > 0
        )
        max_fdp = (
            self.fdp_limit_for_report_time(report, offset, segments) * 60
            if clock_known and segment_known
            else None
        )
        fdp_slack = check(
            "modeled-fdp",
            "117.13 Table B flight duty period",
            elapsed,
            max_fdp,
            {
                "report": report.isoformat() if report else None,
                "scheduled_segments": segments,
                "timezone_offset_hours": offset,
            },
        )
        ft_slack = check(
            "modeled-flight-time",
            "117.11 Table A flight time",
            total_ft,
            max_ft,
            {"prior_duty_minutes": prior_ft, "proposed_flight_minutes": ft},
        )
        rest_start = self._to_dt(crew.get("last_rest_start"))
        rest_end = self._to_dt(crew.get("last_rest_end"))
        rest_duration = _number(crew.get("last_rest_duration_hours"))
        rest_times = [t for t in (rest_start, rest_end, report) if t]
        rest_clock_valid = len({t.tzinfo is not None for t in rest_times}) <= 1
        rest = None
        if rest_clock_valid:
            rest = (
                (rest_end - rest_start).total_seconds() / 60
                if rest_start and rest_end
                else rest_duration * 60
                if rest_duration is not None and rest_end
                else None
            )
            if rest_end and report and rest_end > report:
                out.violations.append("117.25: duty overlaps declared rest")
            if rest_end and report and rest_end != report:
                out.unknowns.append(
                    "Rest does not end at report; immediately preceding rest not established"
                )
        rest_slack = check(
            "modeled-rest",
            "117.25(e) preceding rest",
            rest,
            600,
            {
                "last_rest_start": str(crew.get("last_rest_start")),
                "last_rest_end": str(crew.get("last_rest_end")),
                "formula": "rest end - rest start, or declared duration",
            },
            True,
        )
        check(
            "sleep-opportunity",
            "117.25(e) uninterrupted sleep opportunity",
            _number(crew.get("sleep_opportunity_minutes")),
            480,
            minimum=True,
        )
        check(
            "weekly-rest",
            "117.25(b) consecutive duty-free time within 168 hours",
            _number(crew.get("consecutive_duty_free_168h_minutes")),
            1800,
            minimum=True,
        )
        for window, limit in ((28, 6000), (365, 60000)):
            prior = _number(crew.get(f"flight_time_{window}d_minutes"))
            if prior is None:
                hours = _number(crew.get(f"flight_hours_{window}d"))
                prior = hours * 60 if hours is not None else None
            check(
                f"modeled-{window}d",
                f"117.23(b) {window}-day flight time",
                prior + total_ft if prior is not None and total_ft is not None else None,
                limit,
                {"history_before_fdp_minutes": prior, "proposed_flight_minutes": ft},
            )
        for window, limit in ((7, 3600), (28, 11400)):
            prior = _number(crew.get(f"fdp_time_{window}d_minutes"))
            check(
                f"modeled-fdp-{window}d",
                f"117.23(c) {window}-day flight duty period",
                prior + elapsed if prior is not None and elapsed is not None else None,
                limit,
                {"history_before_fdp_minutes": prior, "current_fdp_minutes": elapsed},
            )
        previous = self._to_dt(proposed_pairing.get("last_arrival"))
        if previous and (previous.tzinfo is not None) == (dep.tzinfo is not None):
            check(
                "modeled-turn",
                "Operational minimum turn (not a statutory limit)",
                (dep - previous).total_seconds() / 60,
                MIN_TURN_MINUTES,
                minimum=True,
            )
        elif previous:
            out.unknowns.append("Previous arrival timezone incompatible")
        out.flight_time_remaining_minutes = max(0, int(ft_slack or 0))
        out.fdp_remaining_minutes = max(0, int(fdp_slack or 0))
        out.rest_required_before_minutes = (
            None if rest_slack is None else max(0, math.ceil(-rest_slack))
        )
        out.status = "fail" if out.violations else "unknown" if out.unknowns else "pass"
        out.is_legal = out.status == "pass"
        return out

    def validate_crew_pairing(self, crew_list, pairing):
        return {c.get("id", "unknown"): self.validate(c, pairing) for c in crew_list}

    def compute_legal_pairings(self, available_crews, open_flights):
        pairs = []
        for flight in open_flights:
            for crew in available_crews:
                result = self.validate(
                    crew,
                    {
                        "departure": flight.get("scheduled_departure"),
                        "arrival": flight.get("scheduled_arrival"),
                        "flight_time_minutes": flight.get("flight_time_minutes"),
                        "scheduled_segments": flight.get("scheduled_segments"),
                    },
                )
                if result.is_legal:
                    pairs.append(
                        dict(
                            crew_id=crew.get("id"),
                            flight_id=flight.get("id"),
                            role=crew.get("role"),
                            legality=result.to_dict(),
                        )
                    )
        return pairs

    def compute_required_rest(self, crew, last_fdp_end):
        """Baseline only; not a determination of special recovery rest."""
        return last_fdp_end + self.MIN_REST

    @staticmethod
    def _to_dt(value):
        if isinstance(value, datetime):
            return value
        if value is None:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
