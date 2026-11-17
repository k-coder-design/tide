import { useState } from 'react'
import { Icon } from './Icon'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/**
 * The PIN keypad from the Lock screen mockup: dots for the digits typed, a 3×4 pad, Face ID bottom left
 * when available, delete bottom right. Calls `onComplete` once all digits are in and clears itself.
 */
export function PinPad({
  length,
  onComplete,
  onFaceId,
  disabled = false
}: {
  length: number
  onComplete: (pin: string) => void
  onFaceId?: () => void
  disabled?: boolean
}) {
  const [pin, setPin] = useState('')
  const press = (digit: string) => {
    if (disabled || pin.length >= length) return
    const next = pin + digit
    if (next.length === length) {
      setPin('')
      onComplete(next)
    } else {
      setPin(next)
    }
  }

  return (
    <div className="pinpad">
      <div className="pin-dots" role="status" aria-label={`${pin.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <div className="pin-keys">
        {KEYS.map((digit) => (
          <button key={digit} type="button" className="pin-key" disabled={disabled} onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        {onFaceId ? (
          <button type="button" className="pin-key plain" aria-label="Unlock with Face ID" disabled={disabled} onClick={onFaceId}>
            <Icon name="faceId" size={30} color="var(--teal)" />
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="pin-key" disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="pin-key plain" aria-label="Delete digit" disabled={disabled || pin === ''} onClick={() => setPin(pin.slice(0, -1))}>
          <Icon name="backspace" size={26} />
        </button>
      </div>
    </div>
  )
}
