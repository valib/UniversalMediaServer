import { Audio, AudioPlayer, CompatAudioSkin } from '@videojs/react/audio'
import '@videojs/react/audio/compat-skin.css'
import { lazy, useState } from 'react'

import type { AudioMedia, PlayerInterface, VideoMedia, VideoPlayerOption } from '../../../services/player-service'
import { playerApiUrl } from '../../../utils'
import { prefersNativeHls } from './hls'
import useMediaSession, { type MediaSession } from './useMediaSession'

const UmsVideoPlayer = lazy(() => import('./UmsVideoPlayer'))

type Props = Pick<VideoPlayerOption, 'sendJsonMessage'> & {
  media: AudioMedia | VideoMedia
  player: PlayerInterface
  downloadLabel: string
}

function UmsAudio({ uuid, media, session, onEnded }: { uuid: string, media: AudioMedia, session: MediaSession, onEnded: () => void }) {
  const audio = useMediaSession<HTMLAudioElement>(uuid, media.id, session)
  const resource = uuid + '/' + media.id
  return (
    <AudioPlayer>
      <img src={playerApiUrl + 'thumbnail/' + resource} alt={media.name} style={{ display: 'block', width: '100%', maxHeight: '45vh', objectFit: 'contain' }} />
      <CompatAudioSkin>
        <Audio ref={audio} preload={media.isTranscoded ? 'none' : 'metadata'} onEnded={onEnded}>
          <source src={playerApiUrl + 'media/' + resource} type={media.mime} />
        </Audio>
      </CompatAudioSkin>
    </AudioPlayer>
  )
}

export default function MediaPlayer({ media, player, sendJsonMessage, downloadLabel }: Props) {
  const [native] = useState(prefersNativeHls)
  const { uuid, mediaController } = player
  const { prev, next } = media.surroundMedias
  const session = { mediaController, sendJsonMessage }
  const onEnded = () => {
    if (media.autoContinue && next) player.askPlayId(next.id)
  }
  return (
    <>
      {media.mediaType === 'video'
        ? <UmsVideoPlayer uuid={uuid} media={media} native={native} session={session} onEnded={onEnded} />
        : <UmsAudio uuid={uuid} media={media} session={session} onEnded={onEnded} />}
      {prev && <button onClick={() => player.askPlayId(prev.id)}>{prev.name}</button>}
      {next && <button onClick={() => player.askPlayId(next.id)}>{next.name}</button>}
      {media.isDownload && <a href={playerApiUrl + 'download/' + uuid + '/' + media.id} download>{downloadLabel}</a>}
    </>
  )
}
