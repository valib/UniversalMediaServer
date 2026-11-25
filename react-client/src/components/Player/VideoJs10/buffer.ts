import { bufferFeature } from '@videojs/react'

const bufferAfterMetadata: typeof bufferFeature = {
  ...bufferFeature,
  attach(context) {
    const media = context.target.media
    const attachBuffer = () => bufferFeature.attach?.(context)
    // Reading seekable before metadata can make WebKit cache a near-zero duration.
    if (media instanceof HTMLMediaElement && media.readyState === HTMLMediaElement.HAVE_NOTHING) {
      media.addEventListener('loadedmetadata', attachBuffer, { once: true, signal: context.signal })
      return
    }
    attachBuffer()
  },
}

export function deferBufferUntilMetadata<T>(feature: T) {
  return feature === bufferFeature ? bufferAfterMetadata : feature
}
