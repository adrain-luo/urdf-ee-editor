# Current Status

## Project Direction

This repository is now the working base for a Web URDF End-Effector Editor, built on top of `fan-ziqi/robot_viewer`. The immediate baseline is stable robot description import and viewing. End-effector editing features are planned but intentionally not implemented in this round.

## Verified Baseline

- Dragging a complete `g1_d_description` folder into the page loads `g1_d.urdf` and sibling `meshes/`.
- The G1-D model displays in the main Three.js viewport.
- URDF / ROS coordinate semantics are the product baseline: `+Z` up, `+X` forward, `+Y` left.
- Drag rotation, zoom, pan, and view switching remain expected viewer interactions.
- Visual geometry is rendered by default.
- Collision geometry is parsed and can be toggled, but is hidden by default.
- Missing mesh files should be reported without intentionally stopping the whole import path.
- `fixed`, `revolute`, `continuous`, and `prismatic` joints are accepted by the unified model path.
- 3D viewport link selection is synchronized with the structure graph.
- The End-Effector panel shows selected link, parent joint, joint type, and descendant subtree summary.
- Descendant subtree preview, hide, delete, `tcp_link` insertion, and URDF export are implemented as first-pass editor actions.

## URDF + Mesh Import Flow

1. `FileHandler` accepts drag-and-drop files or directories and builds a path-keyed `fileMap`.
2. `FileHandler.findAllLoadableFiles` identifies URDF/Xacro/MJCF/USD model files and supported mesh files.
3. `ModelLoaderFactory.loadModel` routes URDF files to `loadURDF`.
4. `loadURDF` uses `urdf-loader`, enables collision parsing, and installs URL/path hooks backed by `fileMap`.
5. Meshes are loaded through Three.js loaders such as `STLLoader`, `OBJLoader`, `ColladaLoader`, and `GLTFLoader`.
6. `URDFAdapter` converts the loaded robot into `UnifiedRobotModel` links and joints.
7. `SceneManager.addModel` adds the robot to the scene, extracts visual/collision meshes, builds link and joint axes helpers, initializes joint drag controls, and fits the camera.
8. `ModelGraphView` builds the left structure graph from `rootLink`, `links`, and `joints`.

## Mesh Path Resolution Rules

Path lookup is centralized in `resolveFileFromMap` and related `ModelLoaderFactory` hooks. Current matching order is:

- Direct key match from the drag-and-drop `fileMap`.
- Normalized slash form.
- Cleaned `.` / `..` path form.
- `package://name/path` mapped to both `name/path` and `path`.
- Relative lookup from the URDF file directory.
- Case-insensitive exact normalized match.
- Unique suffix match.
- Unique basename fallback.

The basename fallback is only used when exactly one file matches, which avoids silently choosing the wrong mesh when duplicate filenames exist.

## Z-Up / ROS Coordinates

- The viewer now uses native Z-up scene semantics for the default `+Z` mode.
- `camera.up` is `(0, 0, 1)`.
- The ground plane and reference grid live in the XY plane.
- Ground placement and ground-height measurement use Z as the vertical axis.
- The default `+Z` up-axis mode keeps the model world transform at identity, avoiding a temporary Three.js Y-up rotation patch for URDF display.

## Current Export / Serializer State

`XMLUpdater` currently supports targeted XML updates for URDF joint limits. `URDFEditUtils` now handles first-pass structural edits for descendant subtree deletion and fixed `tcp_link` insertion, then routes the modified XML through the existing reload pipeline. It is still intentionally narrow and is not a full semantic URDF serializer.

## Known Warnings / Limitations

- The codebase still includes upstream support for Xacro, MJCF, USD, MuJoCo simulation, and standalone meshes. The current product baseline is URDF + meshes.
- MJCF-specific coordinate conversion code has not been redesigned in this round.
- The i18n file contains upstream Chinese/English UI strings; product-facing help/drop text has been lightly updated.
- URDF tags beyond the loaded viewer path, such as transmissions, gazebo extensions, plugins, sensors, and full material/texture export semantics, are preserved when possible but are not yet treated as editor-owned structured data.

## Next Stage Plan

1. Add explicit confirmation UI for destructive subtree deletion.
2. Add editable TCP origin fields (`xyz`, `rpy`) instead of the current zero-origin default.
3. Add better subtree preview controls, including restore after hide.
4. Add stronger XML formatting preservation for exported URDF.
5. Add suction and gripper templates.
6. Add TCP / tool-axis visual helpers.
