# Worldviewer

Browser-based Earth twin built with MapLibre GL JS. It starts in orbit, supports globe projection, terrain, 3D buildings, location search, and cinematic fly-to jumps into street-scale views.

## Run

```powershell
npm install
npm run dev
```

## Stack

- MapLibre GL JS for globe rendering and camera control
- OpenFreeMap vector tiles and labels
- EOX Sentinel-2 Cloudless imagery for realistic satellite texture
- MapLibre demo terrain tiles for browser-friendly terrain DEM
- OpenStreetMap Nominatim search for lightweight geocoding

## Notes

- This is the realistic open-data version of the feature. It reaches street-scale navigation with terrain, roads, labels, and extruded buildings, but it is not worldwide photogrammetry.
- The external services above are public community/demo services. For sustained production traffic, swap them for self-hosted or contracted equivalents.
