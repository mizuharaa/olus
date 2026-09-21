"""
Airline and aircraft metadata.

ICAO ↔ IATA codes, aircraft type database with real operating parameters,
and per-type economics sourced from DOT Form 41, FAA, and A4A Annual Report 2023.
"""

# ── Airline code mappings ──────────────────────────────────────────────────────

# ICAO callsign prefix → IATA two-letter code
ICAO_TO_IATA: dict[str, str] = {
    # Major US carriers
    "AAL": "AA",
    "UAL": "UA",
    "DAL": "DL",
    "SWA": "WN",
    "JBU": "B6",
    "ASA": "AS",
    "NKS": "NK",
    "FFT": "F9",
    "AAY": "G4",
    "HAL": "HA",
    "SXJ": "XP",
    # Regional / Express
    "SKW": "OO",
    "RPA": "YV",
    "PDT": "OE",
    "ENY": "MQ",
    "GJS": "G7",
    "CPZ": "CP",
    "ERA": "7H",
    "ASH": "AX",
    "BTA": "WQ",
    "TSO": "KS",
    "GPD": "G1",
    # Cargo
    "FDX": "FX",
    "UPS": "5X",
    "GTI": "GB",
    "ATN": "8C",
    "ABX": "GB",
    "CLX": "C",
    # International (common US routes)
    "WJA": "WS",
    "ACA": "AC",
    "TRS": "TS",  # Canadian
    "BAW": "BA",
    "VIR": "VS",
    "EZY": "U2",  # UK
    "DLH": "LH",
    "CFG": "DE",  # German
    "AFR": "AF",
    "TOM": "BY",  # French
    "KLM": "KL",  # Dutch
    "IBE": "IB",
    "VLG": "VY",  # Spanish
    "AZA": "AZ",  # Italian
    "SAS": "SK",  # Scandinavian
    "JAL": "JL",
    "ANA": "NH",  # Japanese
    "KAL": "KE",
    "AAR": "OZ",  # Korean
    "CPA": "CX",  # HK
    "SIA": "SQ",  # Singapore
    "QFA": "QF",  # Australian
    "UAE": "EK",
    "ETD": "EY",
    "QTR": "QR",
    "SVA": "SV",  # Gulf
    "THY": "TK",  # Turkish
    "TAM": "JJ",
    "GLO": "G3",
    "AZU": "AD",  # Brazilian
    "AMX": "AM",
    "VOI": "Y4",  # Mexican
    "AVA": "AV",  # Colombian
    "LAN": "LA",
    "JKK": "JJ",  # LATAM
    "EIN": "EI",  # Irish
    "ETH": "ET",  # Ethiopian
    "MSR": "MS",  # EgyptAir
}

IATA_TO_ICAO: dict[str, str] = {v: k for k, v in ICAO_TO_IATA.items()}

# Friendly airline names
AIRLINE_NAMES: dict[str, str] = {
    "AA": "American Airlines",
    "UA": "United Airlines",
    "DL": "Delta Air Lines",
    "WN": "Southwest Airlines",
    "B6": "JetBlue Airways",
    "AS": "Alaska Airlines",
    "NK": "Spirit Airlines",
    "F9": "Frontier Airlines",
    "G4": "Allegiant Air",
    "HA": "Hawaiian Airlines",
    "OO": "SkyWest Airlines",
    "YV": "Mesa Airlines",
    "MQ": "Envoy Air",
    "G7": "GoJet Airlines",
    "FX": "FedEx Express",
    "5X": "UPS Airlines",
    "AC": "Air Canada",
    "WS": "WestJet",
    "BA": "British Airways",
    "VS": "Virgin Atlantic",
    "LH": "Lufthansa",
    "AF": "Air France",
    "KL": "KLM",
    "IB": "Iberia",
    "AZ": "ITA Airways",
    "SK": "SAS",
    "JL": "Japan Airlines",
    "NH": "All Nippon Airways",
    "KE": "Korean Air",
    "OZ": "Asiana Airlines",
    "CX": "Cathay Pacific",
    "SQ": "Singapore Airlines",
    "QF": "Qantas",
    "EK": "Emirates",
    "EY": "Etihad Airways",
    "QR": "Qatar Airways",
    "SV": "Saudia",
    "TK": "Turkish Airlines",
    "ET": "Ethiopian Airlines",
    "LA": "LATAM Airlines",
    "AM": "Aeroméxico",
    "AV": "Avianca",
}

# ── Aircraft type database ─────────────────────────────────────────────────────
# Block-hour costs from DOT Form 41 Schedule P-5.2 (2022-2023, US carriers)
# Min turn times from IATA Ground Handling Manual + FAA advisory
# Seats = typical domestic config

AIRCRAFT_DB: dict[str, dict] = {
    # Narrow-body — Boeing
    "B737": {
        "name": "Boeing 737-700",
        "seats": 140,
        "block_hr_usd": 3_100,
        "min_turn_min": 40,
        "range_nm": 3440,
        "category": "narrowbody",
    },
    "B738": {
        "name": "Boeing 737-800",
        "seats": 162,
        "block_hr_usd": 3_400,
        "min_turn_min": 45,
        "range_nm": 2935,
        "category": "narrowbody",
    },
    "B739": {
        "name": "Boeing 737-900ER",
        "seats": 178,
        "block_hr_usd": 3_650,
        "min_turn_min": 45,
        "range_nm": 2950,
        "category": "narrowbody",
    },
    "B38M": {
        "name": "Boeing 737 MAX 8",
        "seats": 178,
        "block_hr_usd": 3_250,
        "min_turn_min": 45,
        "range_nm": 3550,
        "category": "narrowbody",
    },
    "B39M": {
        "name": "Boeing 737 MAX 9",
        "seats": 193,
        "block_hr_usd": 3_450,
        "min_turn_min": 45,
        "range_nm": 3550,
        "category": "narrowbody",
    },
    # Narrow-body — Airbus
    "A319": {
        "name": "Airbus A319",
        "seats": 124,
        "block_hr_usd": 2_900,
        "min_turn_min": 40,
        "range_nm": 3750,
        "category": "narrowbody",
    },
    "A320": {
        "name": "Airbus A320",
        "seats": 150,
        "block_hr_usd": 3_100,
        "min_turn_min": 45,
        "range_nm": 3300,
        "category": "narrowbody",
    },
    "A321": {
        "name": "Airbus A321",
        "seats": 185,
        "block_hr_usd": 3_600,
        "min_turn_min": 50,
        "range_nm": 3200,
        "category": "narrowbody",
    },
    "A20N": {
        "name": "Airbus A320neo",
        "seats": 165,
        "block_hr_usd": 2_950,
        "min_turn_min": 45,
        "range_nm": 3400,
        "category": "narrowbody",
    },
    "A21N": {
        "name": "Airbus A321neo",
        "seats": 194,
        "block_hr_usd": 3_400,
        "min_turn_min": 50,
        "range_nm": 4000,
        "category": "narrowbody",
    },
    # Boeing identifies the 757 as single-aisle, not widebody:
    # https://secure.boeingimages.com/archive/757-200-Taxis-Toward-its-First-Flight-2F3XC5G9AB0.html
    # https://boeing.mediaroom.com/news-releases-statements?item=123583
    "B752": {
        "name": "Boeing 757-200",
        "seats": 200,
        "block_hr_usd": 4_800,
        "min_turn_min": 55,
        "range_nm": 3915,
        "category": "narrowbody",
    },
    "B753": {
        "name": "Boeing 757-300",
        "seats": 243,
        "block_hr_usd": 5_100,
        "min_turn_min": 60,
        "range_nm": 3395,
        "category": "narrowbody",
    },
    # Wide-body — Boeing
    "B762": {
        "name": "Boeing 767-200",
        "seats": 224,
        "block_hr_usd": 5_600,
        "min_turn_min": 65,
        "range_nm": 6385,
        "category": "widebody",
    },
    "B763": {
        "name": "Boeing 767-300ER",
        "seats": 261,
        "block_hr_usd": 6_200,
        "min_turn_min": 70,
        "range_nm": 5990,
        "category": "widebody",
    },
    "B764": {
        "name": "Boeing 767-400ER",
        "seats": 304,
        "block_hr_usd": 6_800,
        "min_turn_min": 75,
        "range_nm": 5625,
        "category": "widebody",
    },
    "B772": {
        "name": "Boeing 777-200",
        "seats": 314,
        "block_hr_usd": 9_500,
        "min_turn_min": 80,
        "range_nm": 5240,
        "category": "widebody",
    },
    "B77W": {
        "name": "Boeing 777-300ER",
        "seats": 396,
        "block_hr_usd": 11_200,
        "min_turn_min": 90,
        "range_nm": 7370,
        "category": "widebody",
    },
    "B788": {
        "name": "Boeing 787-8",
        "seats": 242,
        "block_hr_usd": 8_100,
        "min_turn_min": 75,
        "range_nm": 7355,
        "category": "widebody",
    },
    "B789": {
        "name": "Boeing 787-9",
        "seats": 296,
        "block_hr_usd": 8_900,
        "min_turn_min": 80,
        "range_nm": 7635,
        "category": "widebody",
    },
    "B78X": {
        "name": "Boeing 787-10",
        "seats": 330,
        "block_hr_usd": 9_400,
        "min_turn_min": 85,
        "range_nm": 6430,
        "category": "widebody",
    },
    "B744": {
        "name": "Boeing 747-400",
        "seats": 416,
        "block_hr_usd": 14_000,
        "min_turn_min": 100,
        "range_nm": 7260,
        "category": "widebody",
    },
    "B748": {
        "name": "Boeing 747-8",
        "seats": 410,
        "block_hr_usd": 15_500,
        "min_turn_min": 105,
        "range_nm": 8000,
        "category": "widebody",
    },
    # Wide-body — Airbus
    "A330": {
        "name": "Airbus A330-200",
        "seats": 247,
        "block_hr_usd": 7_800,
        "min_turn_min": 70,
        "range_nm": 7250,
        "category": "widebody",
    },
    "A333": {
        "name": "Airbus A330-300",
        "seats": 293,
        "block_hr_usd": 8_500,
        "min_turn_min": 75,
        "range_nm": 5400,
        "category": "widebody",
    },
    "A339": {
        "name": "Airbus A330-900neo",
        "seats": 287,
        "block_hr_usd": 7_900,
        "min_turn_min": 75,
        "range_nm": 7200,
        "category": "widebody",
    },
    "A359": {
        "name": "Airbus A350-900",
        "seats": 369,
        "block_hr_usd": 9_800,
        "min_turn_min": 85,
        "range_nm": 7700,
        "category": "widebody",
    },
    "A35K": {
        "name": "Airbus A350-1000",
        "seats": 410,
        "block_hr_usd": 10_800,
        "min_turn_min": 90,
        "range_nm": 8100,
        "category": "widebody",
    },
    "A388": {
        "name": "Airbus A380-800",
        "seats": 555,
        "block_hr_usd": 18_500,
        "min_turn_min": 110,
        "range_nm": 8200,
        "category": "widebody",
    },
    # Regional jets
    "E170": {
        "name": "Embraer E170",
        "seats": 70,
        "block_hr_usd": 1_800,
        "min_turn_min": 30,
        "range_nm": 2100,
        "category": "regional",
    },
    "E175": {
        "name": "Embraer E175",
        "seats": 76,
        "block_hr_usd": 1_950,
        "min_turn_min": 30,
        "range_nm": 2200,
        "category": "regional",
    },
    "E190": {
        "name": "Embraer E190",
        "seats": 100,
        "block_hr_usd": 2_300,
        "min_turn_min": 35,
        "range_nm": 2450,
        "category": "regional",
    },
    "E195": {
        "name": "Embraer E195",
        "seats": 118,
        "block_hr_usd": 2_500,
        "min_turn_min": 35,
        "range_nm": 2450,
        "category": "regional",
    },
    "CRJ2": {
        "name": "Bombardier CRJ-200",
        "seats": 50,
        "block_hr_usd": 1_450,
        "min_turn_min": 25,
        "range_nm": 1650,
        "category": "regional",
    },
    "CRJ7": {
        "name": "Bombardier CRJ-700",
        "seats": 70,
        "block_hr_usd": 1_700,
        "min_turn_min": 30,
        "range_nm": 1876,
        "category": "regional",
    },
    "CRJ9": {
        "name": "Bombardier CRJ-900",
        "seats": 90,
        "block_hr_usd": 1_900,
        "min_turn_min": 30,
        "range_nm": 1550,
        "category": "regional",
    },
    "DH8D": {
        "name": "Dash 8 Q400",
        "seats": 78,
        "block_hr_usd": 1_600,
        "min_turn_min": 25,
        "range_nm": 1100,
        "category": "regional",
    },
    # Cargo (no pax seats)
    "B744F": {
        "name": "Boeing 747-400F",
        "seats": 0,
        "block_hr_usd": 14_000,
        "min_turn_min": 120,
        "range_nm": 4445,
        "category": "cargo",
    },
    "MD11": {
        "name": "McDonnell Douglas MD-11F",
        "seats": 0,
        "block_hr_usd": 11_000,
        "min_turn_min": 100,
        "range_nm": 7240,
        "category": "cargo",
    },
    # Default fallback
    "UNKN": {
        "name": "Unknown type",
        "seats": 150,
        "block_hr_usd": 3_500,
        "min_turn_min": 45,
        "range_nm": 3000,
        "category": "narrowbody",
    },
}


AIRCRAFT_TYPE_ALIASES = {"B737-800": "B738", "B757-200": "B752"}


def resolve_aircraft_type(aircraft_type: str) -> str:
    """Resolve known seed-fleet names/ICAO keys; never guess unknown variants."""
    key = aircraft_type.strip().upper()
    key = AIRCRAFT_TYPE_ALIASES.get(key, key)
    return key if key in AIRCRAFT_DB else "UNKN"


def get_aircraft_info(icao_type: str) -> dict:
    """Return aircraft info for a known type/alias, otherwise the UNKN model."""
    return AIRCRAFT_DB[resolve_aircraft_type(icao_type)]


def callsign_to_iata_flight(callsign: str) -> tuple[str, str]:
    """
    Convert ICAO callsign (e.g. 'AAL123') to (IATA airline, flight number).
    Returns ('AA', '123') or ('', callsign) if unknown.
    """
    cs = callsign.strip().upper()
    for prefix, iata in ICAO_TO_IATA.items():
        if cs.startswith(prefix):
            return iata, cs[len(prefix) :].lstrip("0") or cs[len(prefix) :]
    return "", cs


def iata_flight_to_icao_callsign(iata_code: str, flight_num: str) -> str:
    """
    Convert IATA flight code (e.g. 'AA', '123') to ICAO callsign 'AAL123'.
    """
    icao_prefix = IATA_TO_ICAO.get(iata_code.upper(), "")
    return f"{icao_prefix}{flight_num}" if icao_prefix else f"{iata_code}{flight_num}"


def parse_flight_query(query: str) -> tuple[str, str, str]:
    """
    Parse a flight search query like 'AA123', 'UAL456', 'N12345'.
    Returns (icao_prefix, iata_code, flight_number).
    """
    q = query.strip().upper()

    # Try 3-char ICAO prefix
    for prefix in sorted(ICAO_TO_IATA, key=len, reverse=True):
        if q.startswith(prefix):
            iata = ICAO_TO_IATA[prefix]
            num = q[len(prefix) :]
            return prefix, iata, num

    # Try 2-char IATA code
    if len(q) >= 3 and q[:2].isalpha():
        iata = q[:2]
        num = q[2:]
        icao = IATA_TO_ICAO.get(iata, "")
        return icao, iata, num

    return "", "", q
