import type { AudioMedia, VideoMedia } from '../../../services/player-service'

export function isHlsVideo(media: AudioMedia | VideoMedia): boolean {
  if (media.mediaType !== 'video' || typeof media.mime !== 'string') return false
  const mime = media.mime.split(';', 1)[0].trim().toLowerCase()
  return mime === 'application/vnd.apple.mpegurl' || mime === 'application/x-mpegurl'
}

export function prefersNativeHls() {
  const video = document.createElement('video')
  return 'webkitSetPresentationMode' in video && Boolean(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegurl'))
}
