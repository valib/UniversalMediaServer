#!/usr/bin/env sh
set -eu
# Pass a new or empty destination, then add it to the UMS shared folders.
folder=${1:?Usage: create-fixture.sh DIRECTORY}
mkdir -p "$folder"
name="$folder/UMS HLS sample"
for output in "$name.mkv" "$name.cs.vtt" "$name.cs.srt"; do
  if test -e "$output"; then echo "File already exists: $output" >&2; exit 1; fi
done
meta=$(mktemp "${TMPDIR:-/tmp}/ums-chapters.XXXXXX")
trap 'rm -f "$meta"' EXIT
cat > "$meta" <<'METADATA'
;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=12000
title=First chapter
[CHAPTER]
TIMEBASE=1/1000
START=12000
END=30000
title=Second chapter
METADATA
ffmpeg -hide_banner -loglevel error -n \
  -f lavfi -i 'color=c=black:s=1280x720:r=24' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -f lavfi -i 'sine=frequency=880:sample_rate=48000' \
  -f ffmetadata -i "$meta" -map 0:v -map 1:a -map 2:a -map_chapters 3 \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=ces \
  -t 30 -c:v libx264 -threads 2 -g 48 -preset ultrafast -c:a aac "$name.mkv"
cat > "$name.cs.vtt" <<'VTT'
WEBVTT

00:00:00.000 --> 00:00:29.900
První česká stopa
VTT
cat > "$name.cs.srt" <<'SRT'
1
00:00:00,000 --> 00:00:29,900
Druhá česká stopa
SRT
