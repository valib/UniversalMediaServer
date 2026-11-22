import { Container, FullscreenButton, MuteButton, PlayButton, useAudioTrackOptions, useCaptionsOptions, useQualityOptions } from '@videojs/react'
import type { HlsJsAdapter } from '@videojs/hlsjs-video'
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video'
import { VideoPlayer, usePlayer } from '@videojs/react/video'
import { useEffect, useRef, useState } from 'react'
import CueAppearance from './CueAppearance'
import NativeAudioSelect from './NativeAudioSelect'
import type { VideoMedia } from '../../src/services/player-service'

interface Props {
  uuid: string
  media: VideoMedia
  native: boolean
}

type Choice = NonNullable<ReturnType<typeof useQualityOptions>>

function TrackSelect({ choice, change }: { choice: Pick<Choice, 'label' | 'value' | 'options' | 'hidden' | 'setValue'>, change?: (id: string) => void }) {
  if (choice.hidden) return null
  return (
    <label>
      {choice.label}
      <select value={choice.value} onChange={event => (change || choice.setValue)(event.target.value)}>
        {choice.options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
    </label>
  )
}

function HlsSession({ uuid, media, native }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const adapter = useRef<HlsJsAdapter>(null)
  const [engine, setEngine] = useState('')
  const src = '/v1/api/player/media/' + uuid + '/' + media.id
  const [nativeHls] = useState(() => {
    if (!native) return false
    const element = document.createElement('video')
    return Boolean(element.canPlayType('application/vnd.apple.mpegurl') || element.canPlayType('application/x-mpegurl'))
  })
  const playlist = nativeHls ? src + '/master.m3u8' : src
  const quality = useQualityOptions({
    formatRendition: rendition => [
      rendition.width && rendition.height && Math.min(rendition.width, rendition.height) + 'p',
      rendition.bitrate && Math.round(rendition.bitrate / 1000) + ' kb/s',
      rendition.codec,
    ].filter(Boolean).join(' · ') || rendition.id,
  })
  const audio = useAudioTrackOptions()
  const captions = useCaptionsOptions()
  const tracks = usePlayer(s => s.textTrackList)
  const selectSubtitles = usePlayer(s => s.selectSubtitlesTrack)
  const activeRendition = usePlayer(s => s.activeVideoRendition)
  const position = usePlayer(s => s.currentTime)
  const duration = usePlayer(s => s.duration)
  const paused = usePlayer(s => s.paused)
  const muted = usePlayer(s => s.muted)
  const error = usePlayer(s => s.error)
  const chapters = usePlayer(s => s.chaptersCues)
  const seek = usePlayer(s => s.seek)
  const authored = media.externalSubtitles?.find(track => track.default)
  const [subtitle, setSubtitle] = useState<string | null | undefined>(authored && 'ums-sub-' + authored.id)
  useEffect(() => {
    if (subtitle === undefined) return
    const active = tracks.find(track => track.mode === 'showing' && (track.kind === 'subtitles' || track.kind === 'captions'))
    if ((active?.id ?? null) !== subtitle && (subtitle === null || tracks.some(track => track.id === subtitle))) {
      selectSubtitles(subtitle)
    }
  }, [tracks, subtitle, selectSubtitles])

  return (
    <Container className="ums-hls-skin">
      <HlsJsVideo
        ref={video}
        mediaRef={adapter}
        onLoadedMetadata={() => {
          if (adapter.current?.engine) setEngine('hls.js (MSE)')
          else if (video.current?.currentSrc === new URL(playlist, document.baseURI).href) setEngine('Browser HLS')
        }}
        source={{ src: playlist, type: 'application/vnd.apple.mpegurl', preferPlayback: nativeHls ? 'native' : 'mse' }}
        playsInline
        poster={'/v1/api/player/thumbnail/' + uuid + '/' + media.id}
      >
        {media.externalSubtitles?.map(track => (
          <track key={track.id} id={'ums-sub-' + track.id} src={src + '/subtitles/' + track.id + '.vtt'} kind="subtitles" label={track.label} srcLang={track.language} default={track.default} />
        ))}
        {media.isVideoWithChapters && <track kind="chapters" src={src + '/chapters.vtt'} default />}
      </HlsJsVideo>
      <div className="ums-hls-controls">
        <PlayButton>{paused ? 'Play' : 'Pause'}</PlayButton>
        <MuteButton>{muted ? 'Unmute' : 'Mute'}</MuteButton>
        {Number.isFinite(duration) && duration > 0 && (
          <label>
            Position (s)
            <input type="range" min={0} max={duration} step={0.1} value={position} onChange={event => seek(Number(event.target.value))} />
          </label>
        )}
        <FullscreenButton>Fullscreen</FullscreenButton>
        {media.subtitleStyle && <CueAppearance defaults={media.subtitleStyle} video={video} />}
        {quality && <TrackSelect choice={quality} />}
        {audio && <TrackSelect choice={audio} />}
        {engine === 'Browser HLS' && (!audio || audio.hidden) && <NativeAudioSelect video={video} />}
        {captions && (
          <TrackSelect
            choice={captions}
            change={(value) => {
              captions.setValue(value)
              setSubtitle(tracks.some(track => track.id === value) ? value : null)
            }}
          />
        )}
        {chapters.length > 0 && (
          <label>
            Chapter
            <select value="" onChange={event => seek(Number(event.target.value))}>
              <option value="" disabled>Select a chapter</option>
              {chapters.map(cue => <option key={cue.startTime} value={cue.startTime}>{cue.text}</option>)}
            </select>
          </label>
        )}
        {engine && <output aria-label="Playback engine">{engine}</output>}
        {activeRendition && (
          <output aria-label="Playing variant">
            {activeRendition.height}
            p ·
            {' '}
            {Math.round((activeRendition.bitrate || 0) / 1000)}
            {' '}
            kb/s
          </output>
        )}
      </div>
      {error && <p role="alert">{error.message}</p>}
    </Container>
  )
}

export function HlsPlayer(props: Props) {
  return <VideoPlayer><HlsSession {...props} /></VideoPlayer>
}
