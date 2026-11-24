#!/usr/bin/env bash
# Starts the real Java server with an isolated profile and only the regression fixture.
set -euo pipefail
cd "$(dirname "$0")/../../../.."
platform=${1:?Usage: ci-server.sh macos|ios native|mse}
mode=${2:?Choose native or mse}
profile=$(mktemp -d "${RUNNER_TEMP:?}/ums-hls.XXXXXX")
results="$PWD/react-client/test-results/safari-$platform/$mode"
mkdir -p "$results"
sh react-client/compat/videojs10/create-fixture.sh "$profile/Media"
node -e 'require("node:fs").writeFileSync(process.argv[1] + "/SHARED.conf", JSON.stringify([{type:"Folder",file:process.argv[1] + "/Media",active:true,monitored:true,metadata:false,groups:[]}]))' "$profile"
cat > "$profile/UMS.conf" <<CONFIG
hostname = 127.0.0.1
network_interface = lo0
web_player_enable = true
web_player_auth = false
authenticate_localhost_as_admin = true
web_player_port = 9002
web_gui_port = 9001
web_gui_on_start = false
run_wizard = false
single_instance = false
external_network = false
upnp_enable = false
web_path = $PWD/src/main/external-resources/web
ffmpeg_path = $(command -v ffmpeg)
ffmpeg_executable_type = custom
number_of_cpu_cores = 2
CONFIG
java -Xmx1g -Djava.awt.headless=true -Dums.profile.path="$profile/UMS.conf" \
  -Djna.library.path="$(brew --prefix libmediainfo)/lib" \
  -cp "target/classes:$(cat target/safari-classpath)" net.pms.PMS headless >"$results/server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true' EXIT
player_api=http://127.0.0.1:9002/v1/api/player
probe_uuid=
player_request() {
  curl --fail --silent --max-time 3 --header "Player: $probe_uuid" --header 'Content-Type: application/json' \
    --data "{\"uuid\":\"$probe_uuid\",\"id\":\"0\",\"lang\":\"en\"}" "$player_api/$1"
}
library_ready() {
  # During startup the web server can answer with HTML before the player API is mounted.
  if [[ -z "$probe_uuid" ]]; then
    probe_uuid=$(curl --fail --silent --max-time 3 "$player_api/" | jq -er '.uuid | strings | select(length > 0)') || return 1
  fi
  player_request browse | jq -e 'any(.folders[]?; .name == "Media")' > /dev/null
}
deadline=$((SECONDS + 180))
until library_ready 2>/dev/null; do
  if ! kill -0 "$server" 2>/dev/null || (( SECONDS >= deadline )); then
    tail -60 "$results/server.log" >&2
    exit 1
  fi
  sleep 1
done
player_request logout > /dev/null || true
bash react-client/compat/videojs10/safari/run.sh "$platform" "$mode"
