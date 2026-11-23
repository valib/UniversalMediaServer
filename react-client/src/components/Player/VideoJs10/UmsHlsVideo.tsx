import { Hls } from '@videojs/hlsjs-video'
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video'
import type { ComponentPropsWithRef } from 'react'

type Props = Omit<ComponentPropsWithRef<typeof HlsJsVideo>, 'source' | 'src'> & {
  src: string
  native: boolean
}

// UMS starts FFmpeg on demand. A cold audio or video segment can take longer
// to produce its first byte than hls.js normally allows for a static file.
const fragmentPolicy = Hls.DefaultConfig.fragLoadPolicy
const engine = {
  hlsJs: {
    fragLoadPolicy: {
      ...fragmentPolicy,
      default: { ...fragmentPolicy.default, maxTimeToFirstByteMs: 30_000 },
    },
  },
}

export default function UmsHlsVideo({ src, native, ...props }: Props) {
  return (
    <HlsJsVideo
      {...props}
      source={{ src, type: 'application/vnd.apple.mpegurl', preferPlayback: native ? 'native' : 'mse', engine: native ? undefined : engine }}
    />
  )
}
