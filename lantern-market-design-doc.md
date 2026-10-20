# Lantern Market — Game Design Doc

Oct 10, 2026 · @Osnat Katz Moon

## Pitch & pillars

A tiny robed wanderer climbs a sleeping, colourless Covent Garden and sings it back to life, one district at a time. Working title: Lantern Market.

The feel: Journey's wordless pilgrimage, Abzu's colour bursts, played on real London streets made soft and strange.

- **Gentle, not hard.** No death, no fail states. Falling just means a funny tumble and a climb back up.
- **The city is the puzzle.** Real rooftops, drainpipes and market arches are the routes. Height is progress.
- **Every action makes the world brighter.** Chirps, fragments and climbs all leave visible colour behind.

## The wanderer

A knee-high robed figure, roughly pigeon-sized next to the buildings. The scale gap is the joke and the wonder.

- **Silhouette:** cone-shaped robe, oversized hood that slips over its eyes, two dot eyes, stubby legs, no visible arms until it climbs.
- **Scarf:** a long ribbon that trails behind and glows. It shows stamina and charge, so the HUD stays empty.
- **Voice:** one chirp sound, pitched by how long you hold the button. Short peep to long warble.

**Comedy beats (all physical, no words):**

- Trips on cobbles when sprinting too long; rolls, sits up, shakes its hood.
- Hood flops down after big landings; it pushes it back up.
- Chirp too many times in a row and it hiccups.
- Pigeons walk past it like it's one of them. One follows it all game.
- Idle animations: watches buskers, sways to music, naps on a bench.

**Animation rules:** squash on landing, stretch on jumps, robe hem swings a beat behind the body. Every motion overshoots slightly and settles.

## Movement & camera

Everything eases in and out. The wanderer feels like it moves through warm syrup, but never sluggish.

| Action | Input | Feel |
| --- | --- | --- |
| Walk / run | WASD or stick | Slow ramp-up (~0.4 s to full speed), soft drift on stop |
| Turn | Mouse / stick | Body turns over ~0.25 s; robe swings after |
| Jump | Space | Floaty arc, low gravity at the peak |
| Glide | Hold Space in air | Scarf unfurls; slow descent; spends scarf charge |
| Chirp | E (tap or hold) | Ripple of light from the body; longer hold, bigger radius |
| Climb | Walk into a wall | Auto-grab; scarf drains while climbing |
| Carry | Automatic | Fragments orbit the wanderer, then trail behind like ducklings |

**Climbing: grab any ledge.** Façades, drainpipes, shop signs, columns and awnings are all climbable. Ledges and windowsills are rest points that refill the scarf. Run out of scarf and you slide down gently, not fall.

**Scarf as stamina.** Scarf length grows with each district woken. Longer scarf means longer climbs and glides, so the world opens upward as you progress. Chirping near a lit lantern refills it.

**Camera.** Third person, spring-damped follow with ~0.3 s lag. Slight overshoot on sharp turns. Pulls back and tilts up when you face a tall climb; pushes in close on landmarks and on comedy beats.

## Core loop & unlock mechanics

All three unlock ideas chain into one loop: chirp to find, fragments to carry, colour as the reward.

```mermaid
flowchart LR
    A["Explore and climb<br/>Find routes up real rooftops"] --> B["Chirp<br/>Reveals hidden fragments"]
    B --> C["Carry light fragments<br/>They trail behind you"]
    C --> D["Light the lantern<br/>Return them to the shrine"]
    D --> E["Colour floods in<br/>District wakes, music grows"]
    E --> F["New way opens<br/>Fog lifts, scarf grows"]
    F -- next district --> A
```

- **Chirp.** Wakes small things: glyphs glow, flowers open, sleeping pigeons lift off revealing fragments. Some ledges only appear while a chirp ripple passes.
- **Light fragments.** 3–6 per district, hidden high up. They follow you; drop them if you fall far, and they float back to the last ledge.
- **Colour restoration.** Lighting a lantern floods the district with its hue and builds the path onward: a bridge of awnings, a staircase of flower boxes, a rope of bunting.

Secondary secrets: hidden glyphs that lengthen the scarf, and busker spots where chirping along adds a music layer.

## World & districts

The real street layout stays. Each district is a zone with its own hue, sealed by a soft barrier until you earn the way in.

| # | District | Hue when woken | Signature climb | Opens the way to |
| --- | --- | --- | --- | --- |
| 0 | The Piazza & Market Building | Warm amber | Market hall glass roof | Tutorial; all paths start here |
| 1 | St Paul's Church | Lavender & sage | Portico columns to the bell | Opera House |
| 2 | Royal Opera House | Crimson & rose gold | Floral Hall arches | Neal's Yard |
| 3 | Neal's Yard | Lime, pink, sky blue | Painted window boxes | Seven Dials |
| 4 | Seven Dials | Teal & copper | The sundial pillar | Drury Lane |
| 5 | Drury Lane theatres | Magenta & gold | Stage-door fire escapes | Kingsway rooftops |
| 6 | Kingsway & High Holborn | Cobalt & white | Long rooftop run | The Strand |
| 7 | The Strand | Deep coral sunset | Riverside rooftops | Final ascent |
| 8 | Sky-market (finale) | All hues together | Floating rooftops above the Piazza | Ending |

**How the real city is stylised:** rooflines exaggerated taller, windows become warm glowing tiles, cobbles become soft rounded stones, chimneys sprout flowers once a district wakes. Scale stays human-faithful so Londoners recognise it.

**Barriers:** grey fog walls at district edges. They thin as fragments return, then dissolve in a colour wave.

## Story: wake the sleeping city

The market's great lantern went out, and the city fell asleep grey. The wanderer is the last spark. No dialogue, no text.

1. **Opening.** The wanderer pops out of a flower pot in the dark Piazza. One flicker of colour where it lands.
2. **First lantern.** Chirping lights the hub lantern. Amber floods the market. Sleeping buskers start to hum.
3. **The rise.** Each district woken adds a ghostly figure going about its old life: flower sellers, opera singers, actors rehearsing.
4. **Low point.** At the Strand, a storm drains every colour. The wanderer climbs on with only its scarf glowing.
5. **Finale.** All fragments lift the wanderer to the sky-market. One long chirp relights the great lantern.
6. **Ending.** Dawn breaks over a fully coloured Covent Garden. The pigeon friend lands beside the wanderer. Credits roll as you can freely wander.

**Environmental storytelling:** murals, shop signs and theatre posters slowly reveal the story of the lantern as districts wake.

## Art & audio direction

Flat, soft and bright: colour does the work, not texture detail.

**Visuals**

- Toon shading with 3 light bands, soft rim light on the wanderer and on climbable edges.
- Sleeping districts: desaturated blue-grey, thick fog. Woken districts: full saturation, light fog tinted with the district hue.
- Colour spreads outward from each lit lantern as a visible wave across façades.
- Particles everywhere once awake: petals, dust motes, lantern sparks.
- Day/night: the existing daylight toggle becomes a slow cycle; each district looks best at one time of day.

**Audio**

- Adaptive score: one instrument layer added per district woken (strings at the Opera House, brass at Drury Lane, accordion at the Piazza).
- Chirps are always in the current key, so spam-chirping sounds musical.
- Ambient city: faint muffled hum while asleep; market chatter, footsteps and buskers once awake.

## Reusing the existing prototype

The current Covent Garden Explorer is a first-person browser walk with OpenStreetMap buildings, 10 landmarks and a district map. Its world is the foundation; its play layer gets replaced.

| Keep | Change | Drop |
| --- | --- | --- |
| Street layout and building footprints | First-person walker → third-person wanderer | Landmark photo cards |
| Built-in offline district | Realistic façades → toon-shaded, exaggerated rooflines | Live OSM swap at runtime (bake one version instead) |
| 10 landmarks as district anchors | Landmarks counter → lantern and fragment progress | Distance counter |
| Daylight toggle | Toggle → slow day cycle | Text-heavy intro screen |
| District map (M) | Map reveals only woken districts, drawn as a painted map | Control hints on screen |
| Pause menu, fullscreen, sensitivity | Sprint / jump → glide, climb, chirp | |

**Key technical additions:** climbable-surface tagging on every building mesh, a colour-saturation mask per district, a scarf physics rope, and a spring follow camera.

Note: this review is based on the site's visible page and controls, not its source code.

## Build plan

First playable target: the Piazza hub plus St Paul's Church, fully woken, in the browser.

1. **Feel prototype.** Grey-box wanderer: floaty walk, jump, glide, spring camera. Tune until moving feels good on its own.
2. **Climbing.** Grab-any-ledge on the Market Building; scarf stamina; rest ledges.
3. **Chirp + colour.** Chirp ripple, lantern lighting, saturation wave across the Piazza.
4. **Fragments.** Hide 5 fragments around the Piazza; carry-and-return to unlock St Paul's.
5. **Look pass.** Toon shader, wanderer model, scarf, particles, first music layer.
6. **Comedy pass.** Trips, hood flops, hiccups, pigeon friend.
7. **Playtest slice**, then roll the pattern out to districts 2–8.

**Decisions**

- **Platform:** browser only. Build on three.js, extending the existing prototype.
- **Input:** gamepad support from day one, alongside keyboard and mouse. Tune feel on both in step 1.
- **Wanderer:** stays nameless.
- **Online:** none. Fully solo, works offline.
- **Length:** aim for about 2 hours; running longer is fine.
