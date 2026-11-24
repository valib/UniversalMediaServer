/*
 * This file is part of Universal Media Server, based on PS3 Media Server.
 *
 * This program is a free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; version 2 of the License only.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program; if not, write to the Free Software Foundation, Inc., 51
 * Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 */
import { useSessionStorage } from '@mantine/hooks'
import axios, { AxiosError, AxiosResponse } from 'axios'
import { ReactNode, useEffect, useRef, useState } from 'react'

import PlayerContext from '../contexts/player-context'
import { I18nInterface } from '../services/i18n-service'
import { SessionInterface } from '../services/session-service'
import { playerApiUrl } from '../utils'
import { showError, showWarning } from '../utils/notifications'
import { type MediaController, PlayerRemoteAction } from '../services/player-service'

const PlayerProvider = ({ children, i18n, session }: { children?: ReactNode, i18n: I18nInterface, session: SessionInterface }) => {
  const mediaController = useRef<MediaController | null>(null)
  const [reqId, setReqId] = useState('0')
  const [reqType, setReqType] = useState('browse')
  const [askingUuid, setAskingUuid] = useState<boolean>(false)
  const [uuid] = useSessionStorage<string>({
    key: 'player',
    defaultValue: '',
  })

  const askReqId = (id: string, type: string) => {
    setReqType('')
    setReqId(id)
    setReqType(type)
  }

  const askPlayId = (id: string) => {
    askReqId(id, 'play')
  }

  const askBrowseId = (id: string) => {
    askReqId(id, 'browse')
  }

  const askShowId = (id: string) => {
    askReqId(id, 'show')
  }

  const onRemoteAction = (data: PlayerRemoteAction) => {
    if (data.request === 'setPlayId') {
      if (data.arg0) askPlayId(data.arg0)
      return
    }
    mediaController.current?.command(data).catch((error) => {
      if (data.request === 'play') {
        showWarning({ title: i18n.get('RemoteControl'), message: i18n.get('RemotePlayOnlyAllowed') })
      }
      else {
        console.log(data.request, error)
      }
    })
  }

  useEffect(() => {
    if (uuid || askingUuid || !session.initialized || !session.usePlayerSse) return
    setAskingUuid(true)
    if (session.uuid) {
      setAskingUuid(false)
    }
    else {
      axios.get(playerApiUrl)
        .then(function (response: AxiosResponse) {
          if (response.data.uuid) {
            session.setUuid(response.data.uuid)
          }
        })
        .catch(function (error: AxiosError) {
          if (!error.response && error.request) {
            i18n.showServerUnreachable()
          }
          else {
            showError({
              id: 'session-lost',
              title: i18n.get('Error'),
              message: i18n.get('YourPlayerSessionNotReceived'),
            })
          }
        })
        .then(function () {
          setAskingUuid(false)
        })
    }
  }, [session, session.usePlayerSse])

  return (
    <PlayerContext.Provider value={{
      mediaController,
      uuid: uuid,
      reqId: reqId,
      reqType: reqType,
      askReqId: askReqId,
      askBrowseId: askBrowseId,
      askPlayId: askPlayId,
      askShowId: askShowId,
      onRemoteAction: onRemoteAction,
    }}
    >
      {children}
    </PlayerContext.Provider>
  )
}

export default PlayerProvider
