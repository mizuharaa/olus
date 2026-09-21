"""Small fictional training network; explicit history, no operational-data claim."""


def reference_scenario():
    schedule, pairings, members = [], [], []
    for index, destination in enumerate(("KATL", "KDFW"), start=1):
        fid, tail = f"DEMO{index}", f"DEMO-T{index}"
        report = f"2026-09-20T{10 + index:02d}:00:00+00:00"
        schedule.append(
            {
                "id": fid,
                "aircraft_id": tail,
                "aircraft_type": "B737-800",
                "origin": "KORD",
                "destination": destination,
                "passengers": 100,
                "scheduled_departure": f"2026-09-20T{11 + index:02d}:00:00+00:00",
                "scheduled_arrival": f"2026-09-20T{13 + index:02d}:00:00+00:00",
            }
        )
        pairings.append(
            {
                "id": f"DEMO-P{index}",
                "flight_id": fid,
                "captain_id": f"DEMO-C{index}",
                "first_officer_id": f"DEMO-O{index}",
                "duty_start": report,
                "duty_end": f"2026-09-20T{14 + index:02d}:00:00+00:00",
                "flight_time_minutes": 120,
                "fa_ids": [],
            }
        )
        for prefix, role in (("C", "captain"), ("O", "first_officer")):
            members.append(
                {
                    "id": f"DEMO-{prefix}{index}",
                    "role": role,
                    "base_airport_id": "KORD",
                    "current_airport": "KORD",
                    "cert_types": ["B737-800"],
                    "current_fdp_start": report,
                    "last_rest_start": "2026-09-19T21:00:00+00:00",
                    "last_rest_end": report,
                    "current_fdp_flight_minutes": 0,
                    "flight_time_28d_minutes": 0,
                    "flight_time_365d_minutes": 0,
                    "fdp_time_7d_minutes": 0,
                    "fdp_time_28d_minutes": 0,
                    "sleep_opportunity_minutes": 480,
                    "consecutive_duty_free_168h_minutes": 1800,
                    "home_timezone_offset_hours": -5,
                    "acclimated_at_home": True,
                    "acclimated": True,
                    "operation_type": "unaugmented",
                }
            )
    return {
        "schedule": schedule,
        "aircraft": [
            {
                "id": f"DEMO-T{index}",
                "type": "B737-800",
                "seats": 160,
                "min_turn_minutes": 45,
                "base_airport_id": "KORD",
            }
            for index in (1, 2, 3)
        ],
        "crew_pairings": pairings,
        "crew_members": members,
        "constraints": {"solver_timeout_secs": 10},
        "disruptions": [],
    }
