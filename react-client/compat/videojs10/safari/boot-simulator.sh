#!/usr/bin/env bash
# Print only the booted device ID on stdout so callers can reuse it.
set -euo pipefail
if [[ -z ${IOS_SIMULATOR_UDID:-} ]]; then
  IOS_SIMULATOR_UDID=$(xcrun simctl list devices available -j | node --input-type=module -e '
    import { readFileSync } from "node:fs"
    const groups = Object.entries(JSON.parse(readFileSync(0)).devices)
      .filter(([runtime]) => runtime.includes(".iOS-" + (process.env.IOS_SIMULATOR_MAJOR ? process.env.IOS_SIMULATOR_MAJOR + "-" : "")))
      .sort(([a], [b]) => b.localeCompare(a, "en", {numeric:true}))
    const iphone = groups.flatMap(([, devices]) => devices).find(d => d.isAvailable && d.name.startsWith("iPhone"))
    if (!iphone) throw Error("No available iPhone simulator runtime")
    console.log(iphone.udid)
  ')
fi
if [[ ${1:-} == --start ]]; then
  if ! xcrun simctl list devices booted | grep -F "($IOS_SIMULATOR_UDID)" > /dev/null; then
    xcrun simctl boot "$IOS_SIMULATOR_UDID" >&2
  fi
  printf '%s\n' "$IOS_SIMULATOR_UDID"
  exit 0
fi
xcrun simctl bootstatus "$IOS_SIMULATOR_UDID" -b >&2
open -a Simulator --args -CurrentDeviceUDID "$IOS_SIMULATOR_UDID"
printf '%s\n' "$IOS_SIMULATOR_UDID"
