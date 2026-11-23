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

The **Safari HLS compatibility** workflow runs the same UMS sample in Safari on hosted macOS and in Mobile Safari on an Xcode iPhone simulator. Each engine starts a fresh UMS server with an isolated profile. A passing native run requires a direct native HLS URL, decoded video, advancing playback, both Czech cues, subtitles off, alternate audio after a chapter seek, and fullscreen entry and exit. The candidate defaults to native HLS on browsers with Apple’s video presentation API and native HLS support. Clearing **Prefer native HLS** explicitly tests hls.js against the extensionless UMS URL. Each macOS host builds once and tests both engines in separate steps and browser sessions. Results, browser capabilities, logs and screenshots are grouped by platform and engine. On iOS, each engine opens in ordinary Mobile Safari first. The test places a temporary marker inside each control, locates it in a simulator screenshot and taps the underlying button through AXe. The check requires a trusted click, system video fullscreen with a Czech cue and a return to inline playback. The simulator captures the same paused Czech cue twice in system fullscreen, once with server defaults and once with green selected. The screenshots and pixel counts are saved with `simulator-playback.json`. A passing job requires `fullscreen.appearance.appliesSelectedColor` to be true. The same Mobile Safari session checks alternate audio, chapter seeking, subtitles Off and inline cue colors. On desktop, SafariDriver starts muted playback through the Play button after the playlist metadata loads. Physical audio output is outside the simulator check.

For a repeatable check on Linux, run the candidate in WebKit with desktop and iPhone display and touch settings. This also measures the two audio tones and the size and color of rendered inline cues. The engine check exercises hls.js on WebKit builds without native HLS. On builds advertising native HLS it requires the native path to play. Both configurations use the same live UMS service.

```sh
yarn playwright test --config compat/videojs10/playwright.config.ts --project=webkit --project=webkit-phone
```

The desktop macOS 15 checks run on Intel. Earlier ARM runs blocked inside WebKit while initializing its audio renderer and video layer. A timeout attaches a WebContent stack sample. The iPhone simulator shares the macOS 15 Intel runner. Its results are available independently of the macOS 26 desktop job. If SafariDriver omits the web page from a viewport screenshot, the test requests a screenshot of the player element. It can also locate that player on the macOS display. It compares only the subtitle area and stores the cropped frame. The Apple jobs run independently on pushes to the migration branch. Use their reports for the native Safari release decision. Safari 27.2 on macOS 26.7.2 passed both engine checks. On macOS 15.8.2 the default native engine passed. On the iPhone 17 Pro simulator with iOS 26.2, both engines rendered the requested green Czech subtitle in system fullscreen. The Linux tests provide additional regression coverage. The production client continues to use Video.js 8.

On Linux WebKit, the 8.23.7 control exposed a single “Unknown” track and hid its audio menu for this master. The baseline records this specific outcome as an expected failure. If it exposes both tracks, the test exercises the normal switch. The 10.1.0 candidate must fetch and decode the Czech tone on all three browser engines.

## Audio and video in the UMS web interface and standalone player

From `react-client`, run `yarn build:videojs10:app` to build the regular application with Video.js 10 for audio, HLS and video whose MIME type the browser can play directly. The opt-in client is written to `node_modules/.cache/ums-videojs10-audio/web/react-client`. The normal build uses Video.js 8. The comparison page and the opt-in client share the same HLS controls. Direct video uses the UMS media URL and the browser's native video element. Both audio and video report playback to UMS and accept its remote controls. The opt-in client loads Video.js 8 on demand when it needs a fallback for an unrecognized video MIME type. Browsing the library or playing supported media with Video.js 10 leaves that module unloaded.

The **Video.js 10 web player** workflow starts an isolated UMS server with two MP3s with embedded artwork, a chaptered HLS sample and a directly served MP4. It opens both ports in Chromium, Firefox and WebKit. The audio check reconnects the WebSocket while playback is paused and verifies the session switches to the next track. For each video, it checks decoded frames, chapter seeking, and pause and resume through the renderer API. The MP4 check also verifies byte-range responses and switches between a Czech WebVTT file and an English SRT file while paused on the second chapter. A separate case opens the same HLS stream with a legacy MIME alias and verifies playback and renderer controls in Video.js 8. To repeat it locally, install FFmpeg, MediaInfo and the three browsers through Playwright, build the opt-in client and run these commands from the repository root:

```sh
mvn -DskipTests compile dependency:build-classpath -Dmdep.outputFile=target/audio-classpath
bash react-client/compat/videojs10/audio/run.sh
```
