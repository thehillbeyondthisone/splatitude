# Credits and provenance

Splatitude’s renderer and advanced editor are adapted from **[Gausseous](https://github.com/quixbrics/gausseous)** by **quixbrics**, MIT licensed, source commit `7909f2c08bd966efa4ee6271599dfc493aace0f6`. The upstream copyright and MIT license are preserved in [LICENSE](LICENSE).

`src/engine.mjs` and the original editor markup/styles in `index.html` derive from that version. Splatitude adds the completed-scan catalog, performance shell, looks, live system-audio analysis, independent live animation time, saved camera views, browser preferences, local server, and launchers. `tools/import-gausseous.mjs` documents the one-time extraction and integration from the reviewed local source; it is not run by installation or startup.

Runtime packages are pinned in `package-lock.json`. Their own licenses remain in the installed packages:

| Package | Version | Purpose |
|---|---|---|
| Three.js | 0.180.0 | Scene and WebGL rendering |
| Spark | 2.1.0 | Gaussian splat decoding, sorting, and rendering |
| mp4-muxer | 5.2.2 | Offline MP4 output |
| Playwright | 1.55.1 | Development-only browser verification |

No scan assets or music are distributed with the repository. A user supplies their own local media.
