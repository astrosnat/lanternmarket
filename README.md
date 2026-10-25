# Lantern Market

A tiny robed wanderer climbs a sleeping, colourless Covent Garden and sings it back to life.
See [lantern-market-design-doc.md](lantern-market-design-doc.md).

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/, works offline
npm run playtest # headless bot plays the whole slice (--all for every player style, --verbose)
```

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | WASD | Left stick |
| Walk (climb down off edges) | Hold Shift | Push the stick gently |
| Look | Mouse (click to capture) | Right stick |
| Jump / glide | Space (hold in air) | A |
| Chirp | E (hold for a bigger ripple) | X / B |
| Climb | Walk into a wall | Push into a wall |
| Pause | Esc / P | Start |

## Status (build plan)

- [x] 1. Feel prototype: eased walk, floaty jump, glide, spring camera, gamepad
- [x] 2. Climbing: grab any surface, scarf stamina, ledges/awnings as rest points, mantle
- [x] 3. Chirp + colour: ripple, lantern lighting, saturation wave per district
- [x] 4. Fragments: 5 in the Piazza, 3 at St Paul's; carry, drop on big falls, deposit to unlock
- [x] 5. Look pass: rim-lit wanderer model, particles (motes, petals, lantern sparks, dust), composed music layers
- [~] 6. Comedy pass: trips, hood flops, hiccups done; pigeon friend to do
- [~] 7. Playtest slice: bot clears it end to end (`tools/playtest.mjs`); human playtest to do; then districts 2–8

## Layout

- `src/world.js` — grey-box Piazza, Market Building, terraces, St Paul's, fog walls, fragment spots
- `src/wanderer.js` — movement/climb controller and procedural animation
- `src/scarf.js` — scarf rope; its lit length is the stamina meter
- `src/particles.js` — dust motes, petals, lantern sparks, footstep and landing puffs
- `src/sky.js` — Milky Way sky dome: grey until every fragment is woken, then colour
- `src/camera.js` — spring-damped third-person camera
- `src/game.js` — chirp, fragments, lanterns, colour waves, atmosphere
- `src/materials.js` — toon materials with the shared "wake" shader patch and rim light
- `tools/playtest.mjs` — headless playtest bot (real game code, scripted route, blocker report)
- `src/audio.js` — synthesised chirps, ambience and score (D major pentatonic): Piazza accordion + oom-pah, St Paul's carillon + choir

## Credits

- Night sky: "Milchstraße im Internationalen Sternenpark Westhavelland" by Bautsch, [CC0 / public domain](https://commons.wikimedia.org/wiki/File:Internationaler.Sternenpark.Westhavelland.Hemisphaere.P1024398.jpg), via Wikimedia Commons. Cropped and resized in `public/sky/milky-way.jpg`.
