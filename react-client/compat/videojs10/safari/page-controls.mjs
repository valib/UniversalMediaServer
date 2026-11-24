/* global document, Event, innerWidth, screen */
// Use the same change event that the check page handles for both native and React selects.
export function chooseOption(kind) {
  for (const select of document.querySelectorAll('.ums-video-controls select')) {
    const options = Array.from(select.options)
    const target = options.find((option) => {
      if (kind === 'subtitle') return option.value.startsWith('ums-sub-') && !option.selected
      if (kind === 'off') return option.text === 'Off'
      if (kind === 'on') return option.value.startsWith('ums-sub-')
      if (kind === 'chapter') return option.text === 'Second chapter'
      return /^(cs|ces|cze|Czech|čeština)$/i.test(option.text) && !option.value.startsWith('ums-sub-')
    })
    if (target) {
      select.value = target.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
  }
  return false
}

export function markVideo() {
  const video = document.querySelector('video')
  const player = video.closest('.ums-video-skin')
  player.style.position = 'relative'
  const bounds = video.getBoundingClientRect()
  const parent = player.getBoundingClientRect()
  const marker = document.createElement('span')
  marker.id = 'capture-origin'
  marker.setAttribute('aria-hidden', 'true')
  marker.style.cssText = 'position:absolute;width:10px;height:10px;background:#f0f;outline:4px solid #0f0;pointer-events:none;z-index:1'
  marker.style.left = bounds.left - parent.left + 10 + 'px'
  marker.style.top = bounds.top - parent.top + 10 + 'px'
  player.append(marker)
  return { viewport: innerWidth, display: screen.width, player: Math.round(parent.width), width: Math.floor(bounds.width), height: Math.floor(bounds.height) }
}
