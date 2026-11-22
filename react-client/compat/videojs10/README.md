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

Use the same sample on a Mac and an iOS device. To reach Vite from the device, start it on the test machine's LAN address, for example `yarn dev:videojs10 --host 192.168.1.10` with your own address. Select **10.1.0** and **Prefer native HLS**, start playback and record the **Playback engine** output. A result showing **hls.js (MSE)** exercises the MSE path.

1. Listen to the two audio tracks before and after seeking. Check which quality choices the browser exposes.
2. Select each Czech track in turn and inspect the actual words on screen. Turn subtitles off, then on again. Jump to the second chapter at 12 seconds.
3. In **Subtitle appearance**, change one property at a time, including text opacity and a font family containing spaces. Resize the player or rotate the device and compare the cue size. Restore the server defaults.
4. Enter fullscreen, check the active cue and audio, and exit. Record whether the device used system video fullscreen, whether the platform overrode the appearance and where keyboard focus returned.

Record the OS, browser version, playback engine and results for inline and fullscreen playback separately. Native Safari validation is required before the remaining player integration and the production dependency change.

On Linux WebKit, the 8.23.7 control exposed a single “Unknown” track and hid its audio menu for this master. The baseline records this specific outcome as an expected failure. If it exposes both tracks, the test exercises the normal switch. The 10.1.0 candidate must fetch and decode the Czech tone on all three browser engines.
