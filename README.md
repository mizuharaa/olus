# Olus — Airline Disruption Simulation & Recovery Engine

![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![OR-Tools](https://img.shields.io/badge/OR--Tools-9.10-4285F4?logo=google&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## The Problem

Airline operational disruptions — weather, mechanical failures, crew duty limits, and ATC ground stops — cost the global aviation industry an estimated **$34 billion per year**. When a single hub airport closes for three hours, the ripple effect can ground hundreds of flights, strand thousands of passengers, and cascade crew duty-time violations across an entire network for days.

Traditional airline operations control (AOC) systems rely on manual recovery decisions made under extreme time pressure with incomplete information. Dispatchers juggle spreadsheets, phone calls, and aging terminals to reassign aircraft, reroute crews, and reaccommodate passengers — often optimising one constraint while unknowingly violating another.

**Olus** gives operations engineers, researchers, and airline strategists a platform to:

- **Simulate** realistic disruption scenarios across a full flight network
- **Predict** cascade failures before they propagate
- **Optimise** recovery plans that satisfy FAR 117 crew-duty regulations and a MILP cost objective simultaneously
- **Compare** recovery strategies side by side under four competing objectives

It runs on a synthetic carrier — **Nimbus Air** — and optionally overlays *live* US flight positions and weather/ATC events pulled from public feeds.

---

## Design Philosophy: a deterministic in-memory simulator

Olus is intentionally **stateless and in-memory**. On startup the API loads the
Nimbus Air network from YAML and holds the entire world in process — there is **no
database, no cache, no message queue, and no auth tier** to provision. Every
simulation run is deterministic and reproducible, which makes the engine easy to
reason about, test, and deploy: a single API container plus the web frontend.

Live data (real ADS-B positions, weather alerts, ATC ground stops) is fetched over
HTTPS on demand and cached in memory; the app degrades gracefully to the synthetic
network when those feeds are unavailable.

---

## Architecture

```
+---------------------------------------------------------------+
|                        Browser / Client                       |
|                Next.js 15 (App Router, TypeScript)            |
|        Leaflet  |  Recharts  |  Zustand  |  TanStack Query    |
+---------------------------+-----------------------------------+
                            |  REST + WebSocket (/ws/simulation)
+---------------------------v-----------------------------------+
|                      FastAPI (Python 3.11)                    |
|                      in-memory, stateless                     |
|                                                               |
|  +------------------+  +----------------+  +--------------+   |
|  | Disruption Engine|  | FAR 117 Engine |  | MILP Solver  |   |
|  | (11 event types) |  | (duty limits)  |  | (OR-Tools)   |   |
|  +------------------+  +----------------+  +--------------+   |
|                                                               |
|  +------------------+  +----------------+  +--------------+   |
|  | Cascade Predictor|  | Recovery       |  | Heuristic    |   |
|  | (physics +       |  | Explainer +    |  | Fallback     |   |
|  |  optional XGB)   |  | Cost model     |  |              |   |
|  +------------------+  +----------------+  +--------------+   |
+----------------+--------------------+-------------------------+
                 |                    |
        +--------v------+    +--------v--------+
        | YAML network  |    |  Live feeds     |
        | airports /    |    |  OpenSky (ADS-B)|
        | aircraft /    |    |  NWS alerts     |
        | flights /crew |    |  FAA NAS status |
        +---------------+    +-----------------+
```

---

## Features

### Disruption Simulation (11 Event Types)

| Event Type | Description |
|---|---|
| `weather_closure` | Airport made unavailable by severe weather |
| `ground_stop` | ATC halts departures to/from an airport |
| `airspace_closure` | A polygon of airspace is blocked, forcing reroutes |
| `security_event` | Airport closed for a security incident |
| `mechanical_aog` | A specific aircraft grounded (aircraft-on-ground) |
| `crew_sickout` | N% of crews become unavailable |
| `runway_closure` | Reduced airport capacity |
| `atc_staffing` | Reduced ATC throughput |
| `volcanic_ash` | Ash cloud forces wide-area rerouting |
| `cyber_incident` | Slower aircraft turnarounds network-wide |
| `drone_incursion` | Runway operations suspended — **duration unknown at trigger time** |

Eleven canned scenarios ship in `data/scenarios/` (e.g. `chicago_ground_stop`,
`dfw_runway_closure`, `volcanic_ash_pacific`, `atl_security`,
`tan_son_nhat_drone`).

`drone_incursion` is the one event type whose duration is **not** known when it
fires. It carries a log-normal closure-length distribution (default: median
45 min, p95 3 h) instead of an end time, its length depends on detection
confidence (pilot report vs. radar), and repeated suspensions of the same
sighting fold into a single incident rather than stacking as independent
events.

### MILP Recovery Optimizer (OR-Tools CP-SAT)

- Constraint-programming model minimising weighted delay cost + cancellation penalty + crew-disruption cost
- Hard constraints: FAR 117 rest periods, aircraft availability, turnaround times
- Four competing objectives solved per disruption — **Minimize Cost**, **Minimize Passenger Impact**, **Protect Tomorrow's Schedule**, and **Green Recovery** — so operators can compare trade-offs
- Configurable solver timeout with an automatic heuristic fallback
- **Uncertain horizon** (`optimizer/uncertain.py`): when a disruption's duration
  is a distribution, the same CP-SAT model is solved across sampled closure
  lengths. Each plan then reports an expected cost, a cost band, and **regret**
  — how much more it costs than the best recovery available with hindsight

### Cascade Predictor

- Predicts which downstream flights are at risk after a disruption (direct → 1st-order → 2nd-order propagation)
- Pure-physics propagation by default; an **optional** XGBoost model can be trained for sharper estimates
- Outputs counts and a ranked list of affected flights with delay estimates

### FAR 117 Duty-Time Engine

- Implements FAR Part 117 rest and duty-limit logic
- Flags crew-legality violations introduced by candidate recovery plans
- Integrated directly into the optimizer's constraint layer

### Live Data Overlay (no API keys required)

- **OpenSky Network** — real US ADS-B flight positions on the live map
- **NWS** (`api.weather.gov`) — active weather alerts, geo-matched to Nimbus airports
- **FAA NAS Status** (`nasstatus.faa.gov`) — live ground stops, GDPs, and departure delays
- METARs are fetched for monitored airports and refreshed on an interval

---

## Quick Start

### Option A — Docker Compose (full stack)

**Prerequisites:** Docker ≥ 24 and Docker Compose ≥ 2.20.

```bash
git clone https://github.com/mizuharaa/olus.git olus
cd olus
docker compose up --build
```

Two services start: `olus-api` (FastAPI, port 8000) and `olus-web`
(Next.js, port 3000). No external database or cache is provisioned — the API
loads its network from YAML at startup. Simulation/scenario state (disruption
timeline, recovery plans) is persisted locally to `apps/api/state/olus.db`
(SQLite) so a restart mid-scenario doesn't lose it; see
`apps/api/NONDETERMINISM.md` for what replay does and doesn't pin.

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API docs (Swagger) | http://localhost:8000/docs |
| API docs (ReDoc) | http://localhost:8000/redoc |
| Health check | http://localhost:8000/health |

> **Optional:** for higher-resolution live ADS-B, create an OpenSky API client at
> <https://opensky-network.org/my-opensky> and set `OPENSKY_CLIENT_ID` /
> `OPENSKY_CLIENT_SECRET` (or drop a `credentials/credentials.json`). Without
> credentials the app uses anonymous OpenSky access and the synthetic network.

### Option B — Local development

**Backend** (requires Python 3.11 and [Poetry](https://python-poetry.org/)):

```bash
cd apps/api
poetry install                      # API runtime only
# poetry install --with train       # add XGBoost/sklearn for predictor training
poetry run uvicorn src.main:app --reload --port 8000
```

**Frontend** (requires Node 18+):

```bash
cd apps/web
npm install
npm run dev                         # http://localhost:3000
```

---

## API Reference

All endpoints are prefixed with `/api/v1`. Full interactive docs at `/docs`.

### Network

| Method | Endpoint | Description |
|---|---|---|
| GET | `/network` | Full Nimbus Air network snapshot |
| GET | `/airports` · `/airports/{id}` | Airports |
| GET | `/aircraft` · `/aircraft/{tail}` | Aircraft fleet |
| GET | `/crews` | Crew pairings |
| GET | `/schedule` | Scheduled flights |

### Flights (live + synthetic)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/flights` · `/flights/{id}` | Scheduled flights |
| GET | `/flights/live` | Live ADS-B positions (OpenSky) |
| GET | `/flights/search` | Search flights |
| GET | `/flights/status/opensky` | OpenSky feed status |

### Events / Disruptions

| Method | Endpoint | Description |
|---|---|---|
| GET | `/events/types` | The 11 disruption event types |
| GET | `/events/scenarios` | Canned scenarios |
| POST | `/events/trigger` | Inject a disruption |
| GET | `/events/active` | Active disruptions |
| DELETE | `/events/{event_id}` | Clear a disruption |

### Recovery Optimizer

| Method | Endpoint | Description |
|---|---|---|
| POST | `/recovery/solve` | Solve recovery (returns the 4 objective plans) |
| GET | `/recovery/plans` | Retrieve computed plans |
| POST | `/recovery/apply` | Apply a plan to the live schedule |
| POST | `/recovery/explain` | Plain-language explanation of a plan |
| POST | `/recovery/crew-overbooking` | Crew-overbooking recovery analysis |

### Prediction & Simulation

| Method | Endpoint | Description |
|---|---|---|
| POST | `/predict/cascade` | Predict cascade impact of a disruption |
| GET | `/predict/history` | Prediction history |
| GET | `/simulator/state` | Current simulator state |
| POST | `/simulator/trigger` · `/simulator/reset` | Drive the simulator |
| GET | `/simulator/scenarios` · POST `/simulator/scenarios/{name}/load` | Load a scenario |
| POST | `/network/stress-test` | Run a network stress test |
| POST | `/playtest/cascade` | Interactive cascade playtest |

### Passengers, Weather & Live Feeds

| Method | Endpoint | Description |
|---|---|---|
| GET | `/passengers/impact` · `/passengers/rebooking` | Passenger impact & rebooking |
| GET | `/passengers/hotels/{airport}` · `/passengers/compensation-policy` | Reaccommodation |
| GET | `/weather/metars` · `/weather/metar/{id}` · POST `/weather/refresh` | METARs |
| GET | `/live/faa-status` · `/live/weather-alerts` · `/live/national-snapshot` | Live US ops feeds |

### WebSocket

Connect to `ws://localhost:8000/ws/simulation` for real-time simulation updates
(`simulation_update` messages carry the active event, flight states, cascade
summary, and recovery plans; an initial `connected` message includes a full
state snapshot).

---

## Tech Stack

### Backend

| Component | Technology |
|---|---|
| Language | Python 3.11 |
| Web framework | FastAPI 0.115 + Uvicorn (REST + WebSocket) |
| Validation / config | Pydantic v2 + pydantic-settings |
| Optimiser | Google OR-Tools 9.10 (CP-SAT) |
| Numerics | NumPy |
| Cascade predictor (optional training) | XGBoost + scikit-learn |
| HTTP clients | httpx (OpenSky / NWS / FAA) |
| Logging | structlog |
| Network data | YAML (`pyaml`) |

### Frontend

| Component | Technology |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 |
| Language | TypeScript 5 |
| Map | Leaflet + react-leaflet (Carto Positron basemap) |
| Charts | Recharts |
| Client state | Zustand |
| Server state | TanStack Query |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives) |
| Forms | React Hook Form + Zod |
| Motion / Icons | Framer Motion · lucide-react |

### Infrastructure

| Component | Technology |
|---|---|
| Containerisation | Docker + Docker Compose (api + web) |
| Deployment | Vercel website; API container on AWS EC2 behind CloudFront |
| Prod IaC | Terraform (`infra/aws/`); `infra/terraform/` is the retired ECS reference |

---

## Project Structure

```
olus/
├── apps/
│   ├── api/                       # FastAPI backend (in-memory)
│   │   ├── Dockerfile
│   │   ├── pyproject.toml
│   │   ├── smoke_test.py          # end-to-end engine smoke test
│   │   ├── src/
│   │   │   ├── main.py            # app entry point + lifespan
│   │   │   ├── core/              # config + logging
│   │   │   ├── routes/            # API route handlers
│   │   │   ├── events/            # 11 disruption event handlers + registry
│   │   │   ├── optimizer/         # OR-Tools MILP, explainer, crew overbooking
│   │   │   ├── predictor/         # cascade predictor
│   │   │   ├── crew/              # FAR 117 duty-time engine
│   │   │   ├── simulator/         # simulation engine
│   │   │   ├── network/           # stress-test engine
│   │   │   ├── costs/             # cost / carbon models
│   │   │   ├── data/              # OpenSky client
│   │   │   ├── weather/           # METAR / NWS client
│   │   │   └── ws/                # WebSocket handler
│   │   └── tests/                 # pytest suite
│   └── web/                       # Next.js 15 frontend
│       ├── app/                   # App Router pages
│       ├── components/            # UI + simulator components
│       ├── stores/                # Zustand stores
│       └── lib/                   # API client + WS hook
├── data/
│   ├── network/                   # airports / aircraft / flights / crews YAML
│   └── scenarios/                 # 11 canned disruption scenarios
├── scripts/
│   ├── generate_network.py        # regenerate the Nimbus Air network
│   └── train_predictor.py         # train the optional XGBoost cascade model
├── infra/terraform/               # AWS reference infrastructure
├── packages/schemas/              # shared Pydantic + TypeScript schemas
└── docker-compose.yml
```

---

## Development

### Tests

```bash
# Backend
cd apps/api
poetry run pytest -q
poetry run python smoke_test.py     # end-to-end engine check

# Frontend
cd apps/web
npm run type-check
npm run build
```

### Linting & Formatting

```bash
# Python
cd apps/api
poetry run ruff check src/
poetry run black src/

# TypeScript
cd apps/web
npm run lint
```

### Regenerating the network

```bash
cd apps/api                         # uses repo-root data/ paths
poetry run python ../../scripts/generate_network.py
```

---

## License

MIT License — Copyright (c) 2026 Olus Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

*Named after Olus, keeper of the winds in Greek mythology — because in aviation, the wind always has the final say.*

