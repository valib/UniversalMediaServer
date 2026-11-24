import { Container, Hotkey, MuteButton, PlayButton, useAudioTrackOptions, useCaptionsOptions, useQualityOptions } from '@videojs/react'
import type { HlsJsAdapter } from '@videojs/hlsjs-video'
import { Video, VideoPlayer, usePlayer } from '@videojs/react/video'
import { lazy, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import CueAppearance from './CueAppearance'
import NativeAudioSelect from './NativeAudioSelect'
import PlayerFullscreenButton from './PlayerFullscreenButton'
import type { VideoMedia } from '../../../services/player-service'
import useMediaSession, { type MediaSession } from './useMediaSession'
import { isHlsVideo } from './hls'
import './video.css'

const HlsJsVideo = lazy(() => import('@videojs/react/media/hlsjs-video').then(module => ({ default: module.HlsJsVideo })))

interface Props {
  uuid: string
  media: VideoMedia
  native: boolean
  session?: MediaSession
  onEnded?: () => void
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

function VideoSession({ uuid, media, native, session, onEnded }: Props) {
  const video = useMediaSession<HTMLVideoElement>(uuid, media.id, session)
  const adapter = useRef<HlsJsAdapter>(null)
  const pendingResume = useRef(media.resumePosition)
  const [engine, setEngine] = useState('')
  const src = '/v1/api/player/media/' + uuid + '/' + media.id
  const hls = isHlsVideo(media)
  const [nativeHls] = useState(() => {
    if (!hls || !native) return false
    const element = document.createElement('video')
    return Boolean(element.canPlayType('application/vnd.apple.mpegurl') || element.canPlayType('application/x-mpegurl'))
  })
  const playlist = nativeHls ? src + '/master.m3u8' : src
  const poster = '/v1/api/player/thumbnail/' + uuid + '/' + media.id
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
  const volume = usePlayer(s => s.volume)
  const setVolume = usePlayer(s => s.setVolume)
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

  function restorePosition(element: HTMLVideoElement) {
    const saved = pendingResume.current
    if (saved === undefined || element.readyState < HTMLMediaElement.HAVE_METADATA
      || !Number.isFinite(element.duration) || element.duration <= 0) return
    pendingResume.current = undefined
    if (saved > 0 && saved < element.duration) element.currentTime = saved
  }

  const mediaProps = {
    ref: video,
    poster,
    playsInline: true,
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (!hls) return
      restorePosition(event.currentTarget)
      if (adapter.current?.engine) setEngine('hls.js (MSE)')
      else if (event.currentTarget.currentSrc === new URL(playlist, document.baseURI).href) setEngine('Browser HLS')
    },
    onCanPlay: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (hls) restorePosition(event.currentTarget)
    },
    // Native playback can discard a seek made during metadata preload.
    onPlaying: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (!hls) restorePosition(event.currentTarget)
    },
    onSeeking: () => { pendingResume.current = undefined },
    onEnded,
  }
  const textTracks = (
    <>
      {media.externalSubtitles?.map(track => (
        <track key={track.id} id={'ums-sub-' + track.id} src={src + '/subtitles/' + track.id + '.vtt'} kind="subtitles" label={track.label} srcLang={track.language} default={track.default} />
      ))}
      {media.isVideoWithChapters && <track kind="chapters" src={src + '/chapters.vtt'} default />}
    </>
  )

  return (
    <Container className="ums-video-skin" tabIndex={0}>
      <Hotkey keys="Space" action="togglePaused" />
      <Hotkey keys="ArrowLeft" action="seekStep" value={-15} />
      <Hotkey keys="ArrowRight" action="seekStep" value={15} />
      <Hotkey keys="f" action="toggleFullscreen" />
      {hls
        ? (
            <HlsJsVideo
              {...mediaProps}
              mediaRef={adapter}
              source={{ src: playlist, type: 'application/vnd.apple.mpegurl', preferPlayback: nativeHls ? 'native' : 'mse' }}
            >
              {textTracks}
            </HlsJsVideo>
          )
        : <Video {...mediaProps} src={src} preload="metadata">{textTracks}</Video>}
      <div className="ums-video-controls">
        <PlayButton>{paused ? 'Play' : 'Pause'}</PlayButton>
        <MuteButton>{muted ? 'Unmute' : 'Mute'}</MuteButton>
        {session && (
          <label>
            Volume
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={event => setVolume(Number(event.target.value))} />
          </label>
        )}
        {Number.isFinite(duration) && duration > 0 && (
          <label>
            Position (s)
            <input type="range" min={0} max={duration} step={0.1} value={position} onChange={event => seek(Number(event.target.value))} />
          </label>
        )}
        <PlayerFullscreenButton video={video} />
        {media.subtitleStyle && <CueAppearance defaults={media.subtitleStyle} video={video} />}
        {quality && <TrackSelect choice={quality} />}
        {audio && <TrackSelect choice={audio} />}
        {(!hls || engine === 'Browser HLS') && (!audio || audio.hidden) && <NativeAudioSelect video={video} />}
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
        {!session && engine && <output aria-label="Playback engine">{engine}</output>}
        {!session && activeRendition && (
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

export default function UmsVideoPlayer(props: Props) {
  return <VideoPlayer><VideoSession {...props} /></VideoPlayer>
}
