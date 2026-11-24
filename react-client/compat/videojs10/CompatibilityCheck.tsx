import { useEffect, useState } from 'react'

import VideoPlayer8 from '../../src/components/Player/VideoPlayer'
import type { BaseBrowse, VideoMedia } from '../../src/services/player-service'
import { HlsPlayer } from '../../src/components/Player/VideoJs10/HlsPlayer'
import { isHlsVideo, prefersNativeHls } from '../../src/components/Player/VideoJs10/hls'

async function playerRequest<T>(route: string, uuid?: string, id?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/v1/api/player/' + route, {
    method: uuid ? 'POST' : 'GET',
    headers: uuid ? { 'Content-Type': 'application/json', 'Player': uuid } : undefined,
    body: uuid ? JSON.stringify({ uuid, id, lang: 'en' }) : undefined,
    signal,
  })
  if (!response.ok) throw new Error('UMS returned HTTP ' + response.status)
  return response.json()
}

export default function CompatibilityCheck() {
  const [folder, setFolder] = useState('0')
  const [listing, setListing] = useState<BaseBrowse>()
  const [uuid, setUuid] = useState('')
  const [id, setId] = useState('')
  const [media, setMedia] = useState<VideoMedia>()
  const [version, setVersion] = useState('10')
  const [native, setNative] = useState(prefersNativeHls)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setError('')
      setMedia(undefined)
      setListing(undefined)
      if (!uuid) {
        const session = await playerRequest<{ uuid: string }>('', undefined, undefined, controller.signal)
        if (!session.uuid) throw new Error('UMS did not supply a player session')
        setUuid(session.uuid)
      }
      else if (id) {
        const data = await playerRequest<BaseBrowse>('play', uuid, id, controller.signal)
        const selected = data.medias[0] as VideoMedia | undefined
        if (!selected || !isHlsVideo(selected)) {
          throw new Error('Choose a video served by the FFmpeg HLS engine')
        }
        setMedia(selected)
      }
      else {
        setListing(await playerRequest<BaseBrowse>('browse', uuid, folder, controller.signal))
      }
    }
    load().catch((reason: Error) => {
      if (!controller.signal.aborted) setError(reason.message)
    })
    return () => controller.abort()
  }, [folder, uuid, id])

  return (
    <>
      <h1>UMS HLS compatibility check</h1>
      <label>
        Player version
        <select value={version} onChange={event => setVersion(event.target.value)}>
          <option value="8">8.23.7</option>
          <option value="10">10.1.0</option>
        </select>
      </label>
      {version === '10' && (
        <label>
          <input type="checkbox" checked={native} onChange={event => setNative(event.target.checked)} />
          {' '}
          Prefer native HLS
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {id
        ? <button onClick={() => setId('')}>Back to folder</button>
        : listing && (
          <section aria-label="Media browser">
            {folder !== '0' && <button onClick={() => setFolder('0')}>Root folder</button>}
            {listing.folders.map(item => <button key={item.id} onClick={() => setFolder(item.id)}>{item.name}</button>)}
            {listing.medias.map(item => <button key={item.id} onClick={() => setId(item.id)}>{item.name}</button>)}
          </section>
        )}
      {media && (
        <section aria-label={media.name} key={uuid + '/' + media.id}>
          <h2>{media.name}</h2>
          {version === '8'
            ? <VideoPlayer8 uuid={uuid} media={media} askPlayId={setId} sendJsonMessage={() => {}} />
            : <HlsPlayer key={String(native)} uuid={uuid} media={media} native={native} />}
        </section>
      )}
    </>
  )
}
