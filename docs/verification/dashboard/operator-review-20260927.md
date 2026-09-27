# Operator console verification — 2026-09-27

The console follows the existing landing identity: deep teal, warm white, the Olus loop mark and clear type. Shared panels have more space and 44px controls; live contacts use small dots at wide zoom and aircraft at detailed zoom. Recovery detail returns to the existing plan confirmation flow. Native copilot dialog escapes menu clipping and restores keyboard focus.

## Evidence measured in this run

- Backend: 164 passed, 1 optional provider test skipped; Ruff and mypy passed.
- Next production build passed, including type/lint validation; six pre-existing warnings remain.
- Browser checks against `next start`: isolated account sign-in, HttpOnly session, CSRF rejection, persisted profile, key creation/rotation/revocation and sign-out passed.
- Browser checks against `next start`: all six scenario steps, saved edited inputs, owner-isolated solver, four recovery plans, private map and no shared simulation mutations passed.
- Layout checks passed at 320, 390, 768, 1024, 1280, 1440 and 1920px. Covered navigation, control hit tests, panel separation, resizing, timeline, command search, menus and confirmation routing.
- Copilot dialog bounds, input hit test, Escape and focus restoration passed at 320, 390, 768 and 1440px. No AI requests were made by UI tests.
- Impeccable source detector returned no findings in the targeted console sources. Independent finishing review found a clipped copilot and an empty metric; both were repaired and independently rechecked.
- Mobbin: 14 screens inspected across incident management, travel maps, plan comparison and API-key settings. No popularity ranking is claimed.

## Deployment configuration

Google model lookup and a minimal generic generation request both returned 200. The approved Gemini key is stored in SSM SecureString and loaded on the AWS instance into a mode-0600 file. Compose reads it only for the API container. The loader rejects unsafe dotenv characters, retains existing configuration if the parameter is absent, and stops deployment on access errors.

Vercel's public API and WebSocket URLs match the AWS endpoint. The account routes were missing because the older release did not contain this workspace. The obsolete CARTO basemap is replaced by the existing OpenStreetMap configuration in this branch.

These are local production-build checks and configuration verification. Exact deployed revision checks are performed separately after release; this report does not establish production parity or a full accessibility audit.

[Open the screenshot gallery](operator-review-20260927.html).
