#!/usr/bin/env bash
# Run on an isolated macOS CI host with the test sample shared by UMS.
set -euo pipefail
platform=${1:?Usage: run.sh macos|ios}
mode=${2:?Usage: run.sh PLATFORM native|mse}
case "$platform" in macos|ios) ;; *) exit 2 ;; esac
cd "$(dirname "$0")/../../.."
export SAFARI_RESULTS="$PWD/test-results/safari-$platform"
mkdir -p "$SAFARI_RESULTS"
sudo /usr/bin/safaridriver --enable
if [[ "$platform" == ios ]]; then
  IOS_SIMULATOR_UDID=$(xcrun simctl list devices available -j | node --input-type=module -e '
    import { readFileSync } from "node:fs"
    const groups = Object.entries(JSON.parse(readFileSync(0)).devices)
      .filter(([runtime]) => runtime.includes(".iOS-"))
      .sort(([a], [b]) => b.localeCompare(a, "en", {numeric:true}))
    const iphone = groups.flatMap(([, devices]) => devices).find(d => d.isAvailable && d.name.startsWith("iPhone"))
    if (!iphone) throw Error("No available iPhone simulator runtime")
    console.log(iphone.udid)
  ')
  export IOS_SIMULATOR_UDID
  xcrun simctl bootstatus "$IOS_SIMULATOR_UDID" -b
  xcrun simctl spawn "$IOS_SIMULATOR_UDID" defaults write com.apple.mobilesafari AllowRemoteAutomation -bool YES
  xcrun simctl spawn "$IOS_SIMULATOR_UDID" defaults write com.apple.webinspectord RemoteInspectorEnabled -bool YES
  open -a Simulator --args -CurrentDeviceUDID "$IOS_SIMULATOR_UDID"
  xcrun simctl launch "$IOS_SIMULATOR_UDID" com.apple.mobilesafari
fi
start_driver() {
  /usr/bin/safaridriver -p 4444 >>"$SAFARI_RESULTS/driver.log" 2>&1 &
  driver=$!
  for ((i=0; i<120; i++)); do
    if curl --fail --silent --max-time 2 http://127.0.0.1:4444/status > /dev/null; then return 0; fi
    if ! kill -0 "$driver" 2>/dev/null; then cat "$SAFARI_RESULTS/driver.log"; return 1; fi
    sleep 1
  done
  echo 'SafariDriver did not become ready' >&2
  return 1
}
export UMS_SIMULATOR_REPORT=1
node node_modules/vite/bin/vite.js preview --config compat/videojs10/vite.config.ts --host 127.0.0.1 --port 5287 --strictPort >"$SAFARI_RESULTS/vite.log" 2>&1 &
vite=$!
trap 'kill "$vite" 2>/dev/null || true; if [[ -n ${driver:-} ]]; then kill "$driver" 2>/dev/null || true; fi' EXIT
curl --fail --silent --retry-all-errors --retry 20 --retry-delay 1 --max-time 3 http://127.0.0.1:5287/ > /dev/null
smoke=0
if [[ "$platform" == ios && "$mode" == native ]]; then
  node compat/videojs10/safari/simulator.mjs || smoke=$?
fi
start_driver
if node compat/videojs10/safari/check.mjs "$platform" "$mode"; then exit "$smoke"; else status=$?; fi
if [[ "$platform" != ios || "$status" != 75 ]]; then exit "$status"; fi
# Retry only a failed simulator session handshake, before any playback check ran.
mv "$SAFARI_RESULTS/$mode/result.json" "$SAFARI_RESULTS/$mode/first-session.json"
kill "$driver" 2>/dev/null || true
wait "$driver" 2>/dev/null || true
xcrun simctl terminate "$IOS_SIMULATOR_UDID" com.apple.mobilesafari 2>/dev/null || true
xcrun simctl launch "$IOS_SIMULATOR_UDID" com.apple.mobilesafari
start_driver
node compat/videojs10/safari/check.mjs "$platform" "$mode"
exit "$smoke"
