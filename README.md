# Lantern Market

A tiny robed wanderer climbs a sleeping, colourless Covent Garden and sings it back to life.
See [lantern-market-design-doc.md](lantern-market-design-doc.md).

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/, works offline
```

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | WASD | Left stick |
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
- [ ] 7. Playtest slice, then districts 2–8

## Layout

- `src/world.js` — grey-box Piazza, Market Building, terraces, St Paul's, fog walls, fragment spots
- `src/wanderer.js` — movement/climb controller and procedural animation
- `src/scarf.js` — scarf rope; its lit length is the stamina meter
- `src/particles.js` — dust motes, petals, lantern sparks, footstep and landing puffs
- `src/camera.js` — spring-damped third-person camera
- `src/game.js` — chirp, fragments, lanterns, colour waves, atmosphere
- `src/materials.js` — toon materials with the shared "wake" shader patch and rim light
- `src/audio.js` — synthesised chirps, ambience and score (D major pentatonic): Piazza accordion + oom-pah, St Paul's carillon + choir
