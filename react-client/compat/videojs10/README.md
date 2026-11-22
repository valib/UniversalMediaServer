# Check UMS HLS playback with Video.js 8 and 10

This page plays the same UMS library item through the existing web player component (8.23.7) or the React HLS adapter (10.1.0). It reads the real player, browse, play, media, subtitle and chapter endpoints. Run it against a test instance of the standalone UMS web player with FFmpeg HLS enabled. The production web client still uses Video.js 8.

## Run the comparison

From `react-client`, generate the sample and add the resulting **Media** directory to the UMS shared folders. It contains a black 30-second video, an English 440 Hz tone, a Czech 880 Hz tone, two Czech subtitle files with different text and two chapters. The generator uses FFmpeg with libx264 and AAC support.

```sh
sh compat/videojs10/create-fixture.sh ../Media
yarn install --immutable
yarn build:videojs10
yarn dev:videojs10
```

Open the address printed by Vite. Select **Media**, then **UMS HLS sample**. Switch between the player versions using **Player version**. The selected file is fetched with the same UMS renderer session. The standalone server defaults to `http://127.0.0.1:9002`. To use another test server, set `UMS_PLAYER_ORIGIN` when starting Vite. The probe expects a standalone player session with browse and playback access.

To run the browser checks, keep UMS running and let Playwright start its own Vite instance. For a different share name, set `UMS_FIXTURE_FOLDER`. Use the default white subtitle color for the rendered-frame reset check.

```sh
yarn playwright install chromium firefox webkit
yarn playwright test --config compat/videojs10/playwright.config.ts
```

The candidate lists the individual renditions the engine exposes. The menu includes bitrate and codec to distinguish renditions at the same resolution. Automatic selection is available again after a manual choice. The audio test decodes the actual MPEG-TS responses with FFmpeg and measures their tones. The appearance test counts colored glyph pixels in screenshots of the paused black video.

## Safari and iOS

The **Safari HLS compatibility** workflow runs the same UMS sample in Safari on hosted macOS and in Mobile Safari on an Xcode iPhone simulator. Each job boots its own UMS server. A passing run requires a direct native HLS URL, decoded video, advancing playback, both Czech cues, subtitles off, alternate audio after a chapter seek, and fullscreen entry and exit. Each job uploads its own result, capabilities, logs and screenshots. The simulator can exercise system video fullscreen. The screenshots document what the automation surface can capture. Physical audio output and the appearance of OS-owned overlays require separate evidence.

For a repeatable check on Linux, run the candidate in WebKit with desktop and iPhone display and touch settings. This also measures the two audio tones and the size and color of rendered inline cues. The engine check exercises hls.js on WebKit builds without native HLS. On builds advertising native HLS it requires the native path to play. Both configurations use the same live UMS service.

```sh
yarn playwright test --config compat/videojs10/playwright.config.ts --project=webkit --project=webkit-phone
```

The Apple jobs run independently on pushes to the migration branch. Use their reports for the native Safari release decision. The Linux checks provide regression coverage while Apple results are pending. The production client continues to use Video.js 8.

On Linux WebKit, the 8.23.7 control exposed a single “Unknown” track and hid its audio menu for this master. The baseline records this specific outcome as an expected failure. If it exposes both tracks, the test exercises the normal switch. The 10.1.0 candidate must fetch and decode the Czech tone on all three browser engines.
