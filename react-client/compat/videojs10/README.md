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

The **Safari HLS compatibility** workflow runs the same UMS sample in Safari on hosted macOS and in Mobile Safari on an Xcode iPhone simulator. Each job boots its own UMS server. A passing native run requires a direct native HLS URL, decoded video, advancing playback, both Czech cues, subtitles off, alternate audio after a chapter seek, and fullscreen entry and exit. The candidate defaults to native HLS on browsers with Apple’s video presentation API and native HLS support. Clearing **Prefer native HLS** explicitly tests hls.js against the extensionless UMS URL. Each engine has its own job and browser session. Each job uploads its results, browser capabilities, logs and screenshots. Both iOS jobs open the selected engine in ordinary Mobile Safari first. The test places a temporary marker inside each control, locates it in a simulator screenshot and taps the underlying button through AXe. The check requires a trusted click, system video fullscreen with a Czech cue and a return to inline playback. The simulator captures the same paused Czech cue twice in system fullscreen, once with server defaults and once with green selected. The screenshots and pixel counts are saved with `simulator-playback.json`. A passing job requires `fullscreen.appearance.appliesSelectedColor` to be true. SafariDriver then verifies the track controls and inline appearance. The playback checks permit autoplay. Physical audio output is outside the simulator check.

For a repeatable check on Linux, run the candidate in WebKit with desktop and iPhone display and touch settings. This also measures the two audio tones and the size and color of rendered inline cues. The engine check exercises hls.js on WebKit builds without native HLS. On builds advertising native HLS it requires the native path to play. Both configurations use the same live UMS service.

```sh
yarn playwright test --config compat/videojs10/playwright.config.ts --project=webkit --project=webkit-phone
```

The macOS 15 hls.js check has repeatedly blocked inside WebKit while initializing its audio renderer and video layer. A timeout attaches a WebContent stack sample. On macOS 26, separate native and hls.js jobs check playback and subtitle appearance. If SafariDriver omits the web page from a viewport screenshot, the test requests a screenshot of the player element. It can also locate that player on the macOS display. It compares only the subtitle area and stores the cropped frame. The Apple jobs run independently on pushes to the migration branch. Use their reports for the native Safari release decision. Safari 27.2 on macOS 26.7.2 passed both engine checks. On macOS 15.8.2 the default native engine passed. On the iPhone 17 Pro simulator with iOS 26.2, both engines rendered the requested green Czech subtitle in system fullscreen. The Linux tests provide additional regression coverage. The production client continues to use Video.js 8.

On Linux WebKit, the 8.23.7 control exposed a single “Unknown” track and hid its audio menu for this master. The baseline records this specific outcome as an expected failure. If it exposes both tracks, the test exercises the normal switch. The 10.1.0 candidate must fetch and decode the Czech tone on all three browser engines.
