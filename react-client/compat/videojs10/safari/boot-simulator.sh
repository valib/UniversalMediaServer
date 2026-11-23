#!/usr/bin/env bash
# Print only the booted device ID on stdout so callers can reuse it.
set -euo pipefail
IOS_SIMULATOR_UDID=$(xcrun simctl list devices available -j | node --input-type=module -e '
  import { readFileSync } from "node:fs"
  const groups = Object.entries(JSON.parse(readFileSync(0)).devices)
    .filter(([runtime]) => runtime.includes(".iOS-"))
    .sort(([a], [b]) => b.localeCompare(a, "en", {numeric:true}))
  const iphone = groups.flatMap(([, devices]) => devices).find(d => d.isAvailable && d.name.startsWith("iPhone"))
  if (!iphone) throw Error("No available iPhone simulator runtime")
  console.log(iphone.udid)
')
xcrun simctl bootstatus "$IOS_SIMULATOR_UDID" -b >&2
open -a Simulator --args -CurrentDeviceUDID "$IOS_SIMULATOR_UDID"
xcrun simctl launch "$IOS_SIMULATOR_UDID" com.apple.mobilesafari >&2
printf '%s\n' "$IOS_SIMULATOR_UDID"
