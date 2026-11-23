import { useEffect, useEffectEvent, useRef } from 'react'
import type { PlayerInterface, VideoPlayerOption } from '../../../services/player-service'

export type MediaSession = Pick<VideoPlayerOption, 'sendJsonMessage'> & Pick<PlayerInterface, 'mediaController'>

export default function useMediaSession<T extends HTMLMediaElement>(uuid: string, id: string, session?: MediaSession) {
  const ref = useRef<T>(null)
  const mediaController = session?.mediaController
  const send = useEffectEvent((data: Record<string, string>) => session?.sendJsonMessage({ action: 'player_status', data }, false))

  useEffect(() => {
    const element = ref.current
    if (!element || !mediaController) return
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
    const controller: NonNullable<typeof mediaController.current> = {
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
    mediaController.current = controller
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
      mediaController.current = null
      leave()
    }
  }, [uuid, id, mediaController])

  return ref
}
