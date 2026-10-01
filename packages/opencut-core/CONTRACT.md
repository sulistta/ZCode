# OpenCut core adapter contract

This package adapts the pinned OpenCut Classic timeline calculations and owns
the pure Social Project scene evaluator. Its public APIs use milliseconds,
pixels, and rational frame rates. Preview and export call the same clip ordering,
duration, keyframe, transition-opacity, color-adjustment, transform, and volume
rules; renderers only translate those values to DOM or FFmpeg operations.
Callers own renderer-local zoom and gesture state; this package stores no
project data and performs no IO.

`getTimelineZoomMin` derives the minimum from project duration and the width of
the scrollable viewport, with optional zoom bounds for the consuming surface.
`getTimelinePaddingPx` returns visual-only trailing ruler space along the
OpenCut padding curve; it does not extend project duration. Time-to-pixel
conversion and device-grid snapping are shared by the timeline ruler, clip
edges, playhead, and snap guides.

Keyframe time is clip-local. The base value applies at clip time zero, the
base-to-first-keyframe segment is linear, and each keyframe's easing controls
the segment that begins at that keyframe. The last keyframe value is held to the
clip end. Duplicate property timestamps use the last entry in document order.
The easing curves are linear, quadratic-in, quadratic-out, and smoothstep.
Transitions multiply incoming and outgoing opacity ramps, including when they
overlap. The preview uses the browser's equivalent CSS color-filter sequence;
FFmpeg applies the matching brightness/contrast/saturation/hue matrix to the
same sampled color values.

The package intentionally excludes OpenCut's editor singleton, project
database, and WASM time types. Persisted edits must continue through the
account-scoped Social Project contract.

Timeline move snapping is a stateless one-clip adaptation of OpenCut's group
move edge snapping. It checks both clip edges against caller-provided snap
points, excludes the moving clip's points, and returns the closest anchor
inside the caller's zoom-scaled threshold. The UI supplies clip edges,
playhead, and keyframe points; the Host still validates and persists the move.
