#!/usr/bin/env bash
# Run the production application on both UMS ports with a private profile.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
profile=$(mktemp -d "${TMPDIR:-/tmp}/ums-audio.XXXXXX")
results="$PWD/react-client/test-results/videojs10-audio-server"
# Headless WebKit uses this directory for GStreamer's disk-backed media buffer.
export WPE_SHELL_MEDIA_DISK_CACHE_PATH="$profile/webkit-media"
mkdir -p "$profile/Media" "$WPE_SHELL_MEDIA_DISK_CACHE_PATH" "$results"
trap 'if [[ -n ${server:-} ]]; then kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; fi; rm -rf "$profile"' EXIT
ffmpeg -nostdin -v error -f lavfi -i color=c=navy:s=128x128 -frames:v 1 -threads 1 "$profile/cover.jpg"
for track in 01 02; do
  ffmpeg -nostdin -v error -f lavfi -i 'sine=frequency=440:duration=30' -i "$profile/cover.jpg" \
    -map 0:a -map 1:v -c:a libmp3lame -c:v copy -disposition:v attached_pic -id3v2_version 3 \
    "$profile/Media/UMS audio $track.mp3"
done
sh react-client/compat/videojs10/create-fixture.sh "$profile/Media"
ffmpeg -nostdin -v error -i "$profile/Media/UMS HLS sample.mkv" \
  -map 0:v:0 -map 0:a:0 -map_chapters 0 -c copy -movflags +faststart "$profile/Media/UMS direct sample.mp4"
cp "$profile/Media/UMS HLS sample.cs.vtt" "$profile/Media/UMS direct sample.cs.vtt"
cat > "$profile/Media/UMS direct sample.en.srt" <<'SRT'
1
00:00:00,000 --> 00:00:29,900
English MP4 subtitle
SRT
node -e 'require("node:fs").writeFileSync(process.argv[1] + "/SHARED.conf", JSON.stringify([{type:"Folder",file:process.argv[1] + "/Media",active:true,monitored:true,metadata:false,groups:[]}]))' "$profile"
cat > "$profile/UMS.conf" <<CONFIG
hostname = 127.0.0.1
web_player_enable = true
web_player_auth = false
authenticate_localhost_as_admin = true
web_player_download = true
web_player_port = 9002
web_gui_port = 9001
web_gui_on_start = false
run_wizard = false
single_instance = false
external_network = false
upnp_enable = false
number_of_cpu_cores = 2
disable_transcode_for_extensions = mp4
web_path = ${UMS_TEST_WEB_PATH:-$PWD/src/main/external-resources/web}
ffmpeg_path = $(command -v ffmpeg)
ffmpeg_executable_type = custom
CONFIG
java -Xmx1g -Djava.awt.headless=true -Dums.profile.path="$profile/UMS.conf" \
  -cp "target/classes:$(cat target/audio-classpath)" net.pms.PMS headless > "$results/server.log" 2>&1 &
server=$!
for port in 9001 9002; do
  curl -fsS --retry-all-errors --retry 50 --retry-delay 1 --max-time 3 "http://127.0.0.1:$port/v1/api/player/" -o /dev/null
done
cd react-client
node node_modules/@playwright/test/cli.js test --config compat/videojs10/audio/playwright.config.ts "$@"
