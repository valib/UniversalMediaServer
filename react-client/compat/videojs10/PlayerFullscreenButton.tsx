import { FullscreenButton } from '@videojs/react'
import { useEffect, useRef, type RefObject } from 'react'

type SystemVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

export default function PlayerFullscreenButton({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const button = useRef<HTMLButtonElement>(null)
  const documentFullscreen = document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled
  const systemOnly = !documentFullscreen && typeof (HTMLVideoElement.prototype as SystemVideo).webkitEnterFullscreen === 'function'
  useEffect(() => {
    const media = video.current
    if (!systemOnly || !media) return
    const restoreFocus = () => button.current?.focus({ preventScroll: true })
    media.addEventListener('webkitendfullscreen', restoreFocus)
    return () => media.removeEventListener('webkitendfullscreen', restoreFocus)
  }, [video, systemOnly])
  if (!systemOnly) return <FullscreenButton>Fullscreen</FullscreenButton>
  return (
    <button ref={button} type="button" aria-label="Enter fullscreen" onClick={() => (video.current as SystemVideo | null)?.webkitEnterFullscreen?.()}>
      Fullscreen
    </button>
  )
}
