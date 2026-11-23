import { useEffect, useState, type RefObject } from 'react'

// Safari exposes alternate HLS audio through HTMLMediaElement.audioTracks.
interface NativeTrack {
  label: string
  language: string
  enabled: boolean
}
type TrackList = EventTarget & ArrayLike<NativeTrack>

export default function NativeAudioSelect({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const [options, setOptions] = useState<NativeTrack[]>([])
  useEffect(() => {
    const tracks = (video.current as (HTMLVideoElement & { audioTracks?: TrackList }) | null)?.audioTracks
    if (!tracks) return
    const refresh = () => setOptions(Array.from(tracks))
    refresh()
    const events = ['addtrack', 'removetrack', 'change']
    events.forEach(event => tracks.addEventListener(event, refresh))
    return () => events.forEach(event => tracks.removeEventListener(event, refresh))
  }, [video])
  if (options.length < 2) return null
  return (
    <label>
      Audio
      <select
        value={options.findIndex(track => track.enabled)}
        onChange={(event) => {
          const chosen = options[event.target.selectedIndex]
          options.forEach((track) => {
            track.enabled = track === chosen
          })
        }}
      >
        {options.map((track, index) => (
          <option key={index} value={index}>{track.label || track.language || `Track ${index + 1}`}</option>
        ))}
      </select>
    </label>
  )
}
