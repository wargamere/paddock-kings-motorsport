# Visibility and driving feedback

The Assists panel, available from race setup and pause, includes a **Visibility & feedback** section. These saved preferences are separate from driving aids: selecting Beginner or Expert does not change them.

- **Cockpit centre pillar** defaults to Off. The driver's own cockpit view hides the central halo pillar, preserving the upper halo, steering wheel and bodywork. On restores the complete pillar. Exterior views keep the complete car. Each split-screen camera applies its own view, including while following another car after retirement; damaged wings remain damaged when visibility changes.
- **Proximity warnings** defaults to On. A small left/right badge appears for a car alongside or closing into the space beside you. Tight overlap turns the badge red. The calculation uses positions and relative velocity in the driver's frame, excludes distant cars and cars on another vertical level, and separates cars inside/outside the pit lane. It is a proximity aid, not a collision-avoidance controller.
- **Tyre feedback** defaults to On. Sustained braking slip, wheelspin or front tyre saturation produces a brief label. Short spikes are suppressed, and a warning stays briefly after a correction so it can be read. Front saturation is distinguished from a slide involving the whole car. Feedback clears at low speed, while paused, after finishing and while spectating. Both human players have their own indicators.

These features do not change grip, car performance or AI difficulty. Race weather rendering reuses the filtered sky reflection when only road wetness changes; rain strength, time of day and scenery theme still refresh it. Road roughness/reflection strength continues to follow wetness. Fuel below 10 kg now refreshes by tenths rather than being cached until the rounded integer changes.

`tests/drivingAwareness.test.ts` covers rotated proximity, closing motion, height/pit separation, tyre-warning persistence, damage-safe cockpit geometry and fuel precision. The real-browser physics check also verifies both camera views in split screen, real preference controls, saved settings, mobile layout, tyre feedback and reflection reuse.
