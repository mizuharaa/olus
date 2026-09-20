# Landing aircraft asset

`aircraft-clean.webp` is a deterministic top-down Three.js render of the repository's `public/models/cesium-air.glb`, with neutral replacement materials. It is a generic turboprop illustration, not an aircraft-type claim. No AI image generation was used.

Source license: `public/models/CESIUM-LICENSE.txt` (CesiumJS contributors, Apache-2.0).
Reproduce from apps/web: `node scripts/render-flyover-aircraft.mjs`.

The export has transparent alpha; it replaces the old purple-tail sprite. The geometry intentionally retains the source model's level of detail. A detailed commercial jet render with a specific livery is not represented by this asset.
