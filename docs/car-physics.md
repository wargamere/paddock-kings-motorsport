# Car dynamics

The chassis has four independent contact patches, ordered front left, front right, rear left, rear right. Its planar velocities and yaw run at the shared 120 Hz physics rate with two internal substeps. The player, AI, qualifying and medal driver use the same solver. Brake bias is the actual requested hydraulic split, including on cars using the legacy setup levels; ABS can reduce individual brake forces after that split.

Each patch has its own normal load, surface grip, temperature multiplier, slip angle, longitudinal slip response, force and work. Damped suspension transfer moves load forward under braking, rearward under acceleration and outward in corners. Axle loads always add to gravity plus aerodynamic load, and roll stiffness distributes lateral transfer between the axles. Load sensitivity means doubling a tyre's load gives less than twice its grip. Front wing balance moves aerodynamic load between axles. There is no extra force for the player or AI.

Lateral force builds over a short relaxation distance. Excess engine or brake demand progressively develops slip and reduces grip along a continuous peak/breakaway curve. Combined longitudinal and lateral forces are bounded by a friction ellipse at every patch. Trail braking and throttle therefore consume cornering grip; releasing a pedal gives it back progressively. A torque-biasing differential sends a bounded share of drive to the rear tyre with more available grip. Rear-wheel engine braking allows lift-off to affect balance. Body-frame velocities rotate between substeps, then convert back to the world frame; the integrated yaw angle uses the same substeps.

Surface temperature follows each patch's work and cooling. A slower carcass layer stores heat, so a surface spike and sustained overheating recover differently. Fitting a new set resets both thermal layers and the tyre's transient deformation. Resetting the car clears suspension and contact memory. Aids limit individual patch demand: ABS preserves steering under braking; medium TC limits drive slip; full TC also reserves lateral grip and uses the existing stability aid. Raw controls have those aids disabled.

This remains a tuned game model. Longitudinal slip is a force-demand response, not a separate rotating wheel, clutch and drivetrain ODE. Vertical road following and collisions retain the existing track solver; suspension here models load transfer, not a full six-degree-of-freedom spring/unsprung-mass simulation. Tyre coefficients are not fitted to a real manufacturer's measured F1 tyre data.

## Validation

`tests/contactPhysics.test.ts` checks friction limits across combined slip, progressive breakaway/recovery, load conservation and transfer, true brake split, split-surface traction, mirror symmetry, free-coasting energy loss and tyre/reset memory. Existing tests cover deterministic frame rates, dry/wet races, every real circuit, 100/110% AI, full fields and pit lanes. `npm run bench:physics` measures physics and AI CPU cost for a 24-car field; pass another checkout directory to compare an earlier implementation on the same machine. This benchmark excludes rendering and is not an FPS prediction. Medal author version 8 regenerates targets for the revised physics.

## Model references

- [NVIDIA PhysX vehicle guide](https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/Vehicles.html): contact loads, load-sensitive tyre response and normalization of combined forces.
- [NVIDIA tire slip calculation](https://nvidia-omniverse.github.io/PhysX/physx/5.1.2/_build/physx/latest/function_group__vehicle2_1ga2407f0b9eb2ee99df3643f4ceabd53e6.html): slip-angle definitions and low-speed denominator handling.
- [MathWorks Magic Formula tire documentation](https://www.mathworks.com/help/sdl/ref/tiremagicformula.html): peak/breakaway curves and the tradeoff between compliance/inertia fidelity and real-time computation.

The implementation and coefficients here are original gameplay approximations of these principles, with no dependency on either simulation package.
