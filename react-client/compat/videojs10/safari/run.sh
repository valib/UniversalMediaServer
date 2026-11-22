#!/usr/bin/env bash
# Run on an isolated macOS CI host with the test sample shared by UMS.
set -euo pipefail
platform=${1:?Usage: run.sh macos|ios}
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
  xcrun simctl terminate "$IOS_SIMULATOR_UDID" com.apple.mobilesafari 2>/dev/null || true
fi
/usr/bin/safaridriver -p 4444 >"$SAFARI_RESULTS/driver.log" 2>&1 &
driver=$!
node node_modules/vite/bin/vite.js --config compat/videojs10/vite.config.ts --host 127.0.0.1 --port 5287 --strictPort >"$SAFARI_RESULTS/vite.log" 2>&1 &
vite=$!
trap 'kill "$driver" "$vite" 2>/dev/null || true' EXIT
curl --fail --silent --retry-all-errors --retry 20 --retry-delay 1 --max-time 3 http://127.0.0.1:4444/status > /dev/null
curl --fail --silent --retry-all-errors --retry 20 --retry-delay 1 --max-time 3 http://127.0.0.1:5287/ > /dev/null
result=0
for mode in native mse; do
  node compat/videojs10/safari/check.mjs "$platform" "$mode" || result=1
done
exit "$result"
