#!/usr/bin/env bash
# Run on an isolated macOS CI host with the test sample shared by UMS.
set -euo pipefail
platform=${1:?Usage: run.sh macos|ios}
mode=${2:?Usage: run.sh PLATFORM native|mse}
case "$platform" in macos|ios) ;; *) exit 2 ;; esac
cd "$(dirname "$0")/../../.."
export SAFARI_RESULTS="$PWD/test-results/safari-$platform/$mode"
mkdir -p "$SAFARI_RESULTS"
if [[ "$platform" == ios ]]; then
  export IOS_SIMULATOR_UDID
  IOS_SIMULATOR_UDID=${IOS_SIMULATOR_UDID:-$(bash compat/videojs10/safari/boot-simulator.sh)}
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
preview_port=5287
if [[ "$platform" == ios || ${UMS_SAFARI_DESKTOP:-0} == 1 ]]; then
  export UMS_SIMULATOR_REPORT=1
  # Safari can keep fetching segments for a previous tab after a test ends.
  if [[ "$mode" == mse ]]; then
    preview_port=5288
    export UMS_SIMULATOR_REPORT_PORT=5290
  fi
  export UMS_SIMULATOR_ORIGIN="http://127.0.0.1:$preview_port"
fi
node node_modules/vite/bin/vite.js preview --config compat/videojs10/vite.config.ts --host 127.0.0.1 --port "$preview_port" --strictPort >"$SAFARI_RESULTS/vite.log" 2>&1 &
vite=$!
cleanup() {
  if [[ -n ${check_pid:-} ]]; then
    kill "$check_pid" 2>/dev/null || true
    wait "$check_pid" 2>/dev/null || true
  fi
  kill "$vite" 2>/dev/null || true
  if [[ -n ${driver:-} ]]; then
    kill "$driver" 2>/dev/null || true
    wait "$driver" 2>/dev/null || true
  fi
  wait "$vite" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
curl --fail --silent --retry-all-errors --retry 20 --retry-delay 1 --max-time 3 "http://127.0.0.1:$preview_port/" > /dev/null
if [[ ${UMS_SIMULATOR_REPORT:-0} == 1 ]]; then
  node compat/videojs10/safari/simulator.mjs "$mode" "$platform" &
else
  sudo /usr/bin/safaridriver --enable
  start_driver
  node compat/videojs10/safari/check.mjs "$platform" "$mode" &
fi
check_pid=$!
wait "$check_pid"
