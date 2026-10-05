# OpenCut Classic source provenance

- Upstream: <https://github.com/OpenCut-app/opencut-classic>
- Pinned revision: `cf5e79e919144200294fb9fed22a222592a0aeea`
- License: MIT; see `LICENSE` and `../../THIRD-PARTY-NOTICES.md`.
- The exact revision and local-to-upstream path mapping are also recorded in
  `third-party/copied-components.json` and the generated inventory.

The upstream source files used by these adapters are retained byte-for-byte
under `upstream/opencut-classic/`, with `.upstream` appended to each original
path. Their upstream paths, SHA-256 values, and pinned GitHub URLs are listed
in `third-party/copied-components.json`; `node scripts/licenses.mjs notices`
checks those bytes before regenerating the inventory. The Social Harness
runtime adapters stay under `src/` and are the only executable core: they
convert the pinned calculations to millisecond times and rational frame rates.
The account timeline also renders the adapted `TimelineTick` component through
`packages/ui/src/social-accounts/OpenCutClassicTimelineTick.tsx`. No OpenCut
application state, persistence, WASM runtime, or rendering singleton is used.

| Social Harness file                                        | OpenCut Classic files                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/timelineCoordinates.ts`                               | `apps/web/src/timeline/scale.ts`, `pixel-utils.ts`, `zoom-utils.ts`                                 |
| `src/timelineSnapping.ts`                                  | `apps/web/src/timeline/snapping/threshold.ts`, `snapping/resolve.ts`, `timeline/group-move/snap.ts` |
| `src/timelineRuler.ts`                                     | `apps/web/src/timeline/ruler-utils.ts`                                                              |
| `src/socialProjectTrim.ts`                                 | `apps/web/src/timeline/group-resize/compute-resize.ts`                                              |
| `../ui/src/social-accounts/socialProjectTimelineDrag.ts`   | `apps/web/src/timeline/group-move/snap.ts`, `timeline/animation-snap-points.ts`                     |
| `../ui/src/social-accounts/SocialProjectTimeline.tsx`      | `apps/web/src/timeline/components/timeline-ruler.tsx`, `timeline/hooks/use-scroll-position.ts`      |
| `../ui/src/social-accounts/SocialProjectRulerMarks.tsx`    | `apps/web/src/timeline/components/timeline-ruler.tsx`, `timeline/components/timeline-tick.tsx`      |
| `../ui/src/social-accounts/OpenCutClassicTimelineTick.tsx` | `apps/web/src/timeline/components/timeline-tick.tsx`                                                |

The extracted functions are stateless and use milliseconds plus rational frame
rates at this boundary. The resize adapter maps OpenCut's single-delta,
frame-clamped group-resize algorithm to one Social Project clip with constant
playback rate; project tracks allow overlap, so OpenCut's neighbor-collision
model is not imported. The adapted ruler components receive scroll viewport
measurements and render only buffered visible ticks; they do not import
OpenCut's WASM time representation, editor store, database, project persistence,
or rendering singleton. The Social Harness project service remains the sole
project state owner. The scene evaluator and Social Project contract remain
Social Harness implementations because they define the service-owned data model.
The move adapter preserves OpenCut's nearest-edge snap selection for one clip;
Social Harness supplies millisecond snap points for clip edges, playhead, and
clip-local keyframes, while track compatibility and persistence remain owned by
the existing UI adapter and Host project service.
