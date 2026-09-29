# Forma — Image Editor

A lightweight, private photo editor with a responsive sage-and-cream workspace. Built with vanilla HTML, CSS, JavaScript, and the Canvas API; no framework, build step, account, or backend is required.

## Run locally

With Python 3 installed:

```sh
python3 -m http.server 3000 --bind 0.0.0.0
```

Or use `npm start` (runs the same command). Open **http://localhost:3000**.

The root `index.html` is the main entry point. The original `/html/index.html` URL redirects to it. You can deploy the repository to any static host, including a subdirectory.

## Features

- A bundled sample image so you can try the editor immediately.
- Upload or drag and drop JPG, PNG, and WebP images.
- Brightness, contrast, saturation, warmth, grayscale, and inversion adjustments.
- Six looks with previews generated from your own photo.
- 90-degree rotation and horizontal/vertical flipping.
- Undo/redo (up to 80 states), individual adjustment resets, and reset all.
- Zoom, fit-to-canvas, and original-image comparison.
- Full-resolution PNG, JPG, and WebP export, custom filenames, and lossy quality controls.
- Transparency preserved for PNG/WebP; JPG transparency is flattened onto white.
- Keyboard controls, labeled inputs, tab navigation, focus states, and mobile layouts.

### Keyboard shortcuts

| Action                | Shortcut                                               |
| --------------------- | ------------------------------------------------------ |
| Undo                  | Ctrl / ⌘ Z                                             |
| Redo                  | Ctrl / ⌘ Shift Z, or Ctrl / ⌘ Y                        |
| Compare with original | Hold Space while not focused on an interactive control |
| Close a dialog        | Escape                                                 |

## Privacy and implementation

All image processing happens on the device. Images are **never uploaded**, persisted, or sent to a third party. Fonts and the sample image are bundled locally; the app makes no external requests. Reloading clears the editing session, so export before leaving.

The preview is capped at 1,600 pixels on its longest edge for responsiveness. Export uses the original resolution, swapping width and height on quarter-turn rotations to avoid clipping. Preview and export use the same pixel-adjustment pipeline rather than relying on browser-specific `CanvasRenderingContext2D.filter` support.

Files are limited to 25 MB, 32 megapixels, and 16,000 pixels per side to bound browser memory usage. Animated WebP is treated as a still image; animation and original metadata are not preserved. Modern browsers with Canvas, `Image.decode`, `ResizeObserver`, and native dialog support are required. On low-memory devices, very large exports may require a smaller source image.

## Tests

Node.js 18+ and Python 3 are required for the test runner:

```sh
npm ci
npx playwright install --with-deps chromium
npm test
```

The Playwright suite covers image loading, upload errors, drag-and-drop, adjustment pixels, rotation/flipping, history, comparison, zoom, export format/alpha/full-resolution behavior, dialogs, the legacy URL, and responsive layouts. The test server starts automatically (or reuses an existing server on port 3000).

To use an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Project structure

```text
index.html             Main editor interface and dialogs
css/style.css          Responsive styles and locally hosted fonts
app/app.js             Image processing, state/history, and UI behavior
assets/                Sample image, favicon, fonts, and font licenses
html/index.html        Legacy entry point
tests/editor.spec.js   Browser regression tests
```

## Assets

- `assets/alpine-escape.jpg` is an AI-generated alpine landscape used as the editable sample.
- DM Sans and Manrope are bundled from Fontsource under their SIL Open Font Licenses; see `assets/fonts/`.
- Icons are inline SVGs; the original bundled Font Awesome directory is no longer needed by the interface but is retained for repository compatibility.
