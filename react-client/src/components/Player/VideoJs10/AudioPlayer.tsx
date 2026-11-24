import { Audio, AudioPlayer, CompatAudioSkin } from '@videojs/react/audio'
import '@videojs/react/audio/compat-skin.css'
import { useEffect, useEffectEvent, useRef } from 'react'

import type { AudioMedia, PlayerInterface, VideoPlayerOption } from '../../../services/player-service'
import { playerApiUrl } from '../../../utils'

type Props = Pick<VideoPlayerOption, 'sendJsonMessage'> & {
  media: AudioMedia
  player: PlayerInterface
  downloadLabel: string
}

export default function UmsAudioPlayer({ media, player, sendJsonMessage, downloadLabel }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const { uuid, audioController } = player
  const { id, surroundMedias: { prev, next } } = media
  const resource = uuid + '/' + id
  const send = useEffectEvent((data: Record<string, string>) => sendJsonMessage({ action: 'player_status', data }, false))

  useEffect(() => {
    const element = audio.current
    if (!element) return
    let playback = element.paused ? 'PAUSED' : 'PLAYING'
    let previous = ''
    const report = (force = false) => {
      const data = {
        uuid, id, playback,
        position: (Number.isFinite(element.currentTime) ? element.currentTime : 0).toFixed(0),
        mute: element.muted ? '1' : '0',
        volume: (element.volume * 100).toFixed(0),
      }
      const snapshot = JSON.stringify(data)
      if (force || previous !== snapshot) {
        previous = snapshot
        send(data)
      }
    }
    const stop = () => {
      playback = 'STOPPED'
      report()
    }
    const update = (event: Event) => {
      switch (event.type) {
        case 'play':
        case 'playing':
          playback = 'PLAYING'
          break
        case 'pause':
          if (element.ended || playback === 'STOPPED') return
          playback = 'PAUSED'
          break
        case 'abort':
        case 'error':
        case 'ended':
          stop()
          return
      }
      report()
    }
    const controller: NonNullable<typeof audioController.current> = {
      report: () => { if (previous || element.readyState > 0) report(true) },
      command: async ({ request, arg0 }) => {
        switch (request) {
          case 'play':
            await element.play()
            break
          case 'pause':
            element.pause()
            break
          case 'stop':
            stop()
            element.pause()
            break
          case 'mute':
            element.muted = true
            break
          case 'setvolume': {
            const value = Number(arg0)
            if (arg0?.trim() && Number.isFinite(value)) element.volume = Math.max(0, Math.min(100, value)) / 100
            break
          }
        }
      },
    }
    audioController.current = controller
    const events = ['loadedmetadata', 'play', 'playing', 'pause', 'timeupdate', 'volumechange', 'seeked', 'ended', 'error', 'abort']
    events.forEach(name => element.addEventListener(name, update))
    const leave = () => {
      if (previous) stop()
    }
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      playback = element.ended ? 'STOPPED' : element.paused ? 'PAUSED' : 'PLAYING'
      report(true)
    }
    window.addEventListener('pagehide', leave)
    window.addEventListener('pageshow', restore)
    if (element.readyState > 0) report()
    return () => {
      events.forEach(name => element.removeEventListener(name, update))
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('pageshow', restore)
      audioController.current = null
      leave()
    }
  }, [uuid, id, audioController])

  return (
    <AudioPlayer>
      <img src={playerApiUrl + 'thumbnail/' + resource} alt={media.name} style={{ display: 'block', width: '100%', maxHeight: '45vh', objectFit: 'contain' }} />
      <CompatAudioSkin>
        <Audio
          ref={audio}
          preload="metadata"
          onEnded={() => { if (media.autoContinue && next) player.askPlayId(next.id) }}
        >
          <source src={playerApiUrl + 'media/' + resource} type={media.mime} />
        </Audio>
      </CompatAudioSkin>
      {prev && <button onClick={() => player.askPlayId(prev.id)}>{prev.name}</button>}
      {next && <button onClick={() => player.askPlayId(next.id)}>{next.name}</button>}
      {media.isDownload && <a href={playerApiUrl + 'download/' + resource} download>{downloadLabel}</a>}
    </AudioPlayer>
  )
}
