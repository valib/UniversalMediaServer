import { useEffect, useRef, useState, type RefObject } from 'react'
import type { SubtitleStyle } from '../../../services/player-service'

interface Appearance {
  color: string
  opacity: number
  font: string
  height: number
}

export default function CueAppearance({ video, defaults }: { video: RefObject<HTMLVideoElement | null>, defaults: SubtitleStyle }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [overrides, setOverrides] = useState<Partial<Appearance>>({})
  const color = overrides.color ?? defaults.color.slice(0, 7)
  const opacity = overrides.opacity ?? (defaults.color.length === 9 ? parseInt(defaults.color.slice(7), 16) : 255)
  const font = overrides.font ?? defaults.fontFamily ?? ''
  const height = overrides.height ?? defaults.fontHeightPercent

  useEffect(() => {
    const element = video.current
    if (!element) return
    element.style.setProperty('--ums-cue-color', color + opacity.toString(16).padStart(2, '0'))
    element.style.setProperty('--ums-cue-font', font ? JSON.stringify(font) : 'sans-serif')
    const resize = () => element.style.setProperty('--ums-cue-size', element.clientHeight * height / 100 + 'px')
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    return () => observer.disconnect()
  }, [video, color, opacity, font, height])

  return (
    <>
      <button onClick={() => dialog.current?.showModal()}>Subtitle appearance</button>
      <dialog ref={dialog} aria-label="Subtitle appearance">
        <form method="dialog">
          <label>
            Text color
            <input type="color" value={color} onChange={e => setOverrides({ ...overrides, color: e.target.value })} />
          </label>
          <label>
            Text opacity
            <input type="range" min="0" max="255" value={opacity} onChange={e => setOverrides({ ...overrides, opacity: Number(e.target.value) })} />
          </label>
          <label>
            Font family
            <input value={font} onChange={e => setOverrides({ ...overrides, font: e.target.value })} />
          </label>
          <label>
            Font height (%)
            <input
              type="number"
              min="1"
              max="100"
              step="any"
              value={height}
              onChange={(e) => {
                const input = e.currentTarget
                if (input.value && input.validity.valid) setOverrides({ ...overrides, height: input.valueAsNumber })
              }}
            />
          </label>
          <button type="button" onClick={() => setOverrides({})}>Use server defaults</button>
          <button>Close</button>
        </form>
      </dialog>
    </>
  )
}
