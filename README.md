# Splatitude

A local music playground for your Gaussian splats. Pick a real place, connect what’s playing, and turn the room into an instrument.

Splatitude builds on [Gausseous](https://github.com/quixbrics/gausseous), with a performance interface and a local completed-scan library. Your scans and audio stay on your computer.

## Run locally

Requires **Node.js 22+** and a WebGL-capable browser. Use **Chrome or Edge on Windows** for whole-system audio capture.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:8770**. On Windows, double-click **Start-Splatitude.bat**. It installs missing dependencies on the first launch, starts the server in the background, and opens Chrome or Edge. First-time installation requires internet; normal use has no CDN dependencies.

## Your splat library

The server finds completed SHARE exports under:

```text
~/Documents/SHARE/share-pointclouds-studio/
  Project_*/<capture>/3DGS/ply/*_epoch_30.ply
```

Only final epoch-30 Gaussian PLYs with a complete payload appear. Earlier epochs and ordinary point clouds are excluded. Click **Refresh** after another reconstruction finishes. The server reads the original exports directly, without copying them.

You can also open a `.ply`, `.splat`, `.spz`, `.sog`, or `.ksplat` file, or place finished assets in the ignored `library/` folder. To reference files elsewhere without copying them, create `.local/library.json`:

```json
{
  "shareRoot": "D:/SHARE/projects",
  "aliases": { "2026-10-10_07-58-16_3DGS": "My studio" },
  "assets": [
    { "name": "Another space", "path": "D:/splats/room.ply", "shareCoordinates": true }
  ]
}
```

`shareCoordinates` rotates a SHARE Z-up export into the viewer’s Y-up space. Rename a library card to give it a friendly name. **Save view** remembers a camera separately for each scan; **Home view** restores it. Names, views, previews, the last selected scan, and performance settings are saved in this browser’s local storage.

## Bring the music

Click **Use system audio**. In the browser picker select **Entire screen**, enable **Share system audio**, and click **Share**. Music keeps playing through its original output. The app analyses the stream without replaying it through the speakers; it disables the video track and does not record or upload the screen. The browser requires a fresh selection each session.

Five sound-reactive looks—**Pulse, Liquid, Prism, Drift, Echo**—plus **Original** are ready to use. Switch looks with **1–6**, adjust **Intensity** and **Sensitivity**, and choose **Tight**, **Balanced**, or **Float** for the response. **A/B original** lets you compare with the untouched scan. Live motion and audio response work with the timeline paused, including while you switch scans.

**Perform** or **H** hides the controls; **Escape** brings them back. Fullscreen is available in the footer. Keep the browser tab visible for smooth rendering.

You can also open an audio track. File playback starts once analysis finishes. **Advanced editor** exposes Gausseous’s parameter routing, envelopes, masks, camera keyframes, transformations, and video output. File-driven sessions can export MP4; live input must be disconnected for offline export. Use a screen recorder to capture a live performance.

**Save preset** writes the visual settings and routing as JSON. Reopen the splat and audio source before loading the preset. Presets reference media; they do not embed it. Existing Gausseous presets remain supported.

## Development and checks

```sh
npm run dev          # restart the local server on source changes
npm test             # completed-export filtering and byte-range tests
npm run test:browser # local integration test with two real completed scans
```

The browser test uses installed Chrome and generated audio MediaStreams. It checks real scan rendering, switching during live audio, frequency response, looks, original comparison, camera persistence, mobile layout, preset round trips, and a short 720p MP4 export while blocking external HTTP requests. Native desktop-audio selection remains a manual permission step. Evidence goes to ignored `verification/`.

The server binds only to `127.0.0.1`. `PORT` changes the port; `SPLATITUDE_SHARE_ROOT` overrides the SHARE scan location. The repository excludes scans, recordings, dependencies, and machine-specific settings. See [THIRD_PARTY.md](THIRD_PARTY.md) for engine provenance and licenses.
