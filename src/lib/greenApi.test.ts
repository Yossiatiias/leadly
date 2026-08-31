import { describe, it, expect } from 'vitest'
import { cleanInstanceId, greenApiUrl } from './greenApi'

describe('cleanInstanceId', () => {
  it('strips the "Instance " prefix some users paste from the Green API console', () => {
    // this exact bug once broke real message sending — see project memory
    expect(cleanInstanceId('Instance 710722691468')).toBe('710722691468')
  })
  it('leaves a bare instance id untouched', () => {
    expect(cleanInstanceId('710722691468')).toBe('710722691468')
  })
  it('trims stray whitespace even with the prefix present', () => {
    expect(cleanInstanceId('  Instance 710722691468  ')).toBe('710722691468')
  })
  it('handles null/undefined safely', () => {
    expect(cleanInstanceId(null)).toBe('')
    expect(cleanInstanceId(undefined)).toBe('')
  })
})

describe('greenApiUrl', () => {
  it('builds a correct URL and cleans the instance id inline', () => {
    const url = greenApiUrl('https://7107.api.greenapi.com', 'Instance 710722691468', 'sendMessage', 'tok123')
    expect(url).toBe('https://7107.api.greenapi.com/waInstance710722691468/sendMessage/tok123')
  })
  it('strips a trailing slash from the base URL', () => {
    const url = greenApiUrl('https://7107.api.greenapi.com/', '123', 'getStateInstance', 'tok')
    expect(url).toBe('https://7107.api.greenapi.com/waInstance123/getStateInstance/tok')
  })
  it('falls back to the default cluster URL when none is given', () => {
    const url = greenApiUrl(null, '123', 'getStateInstance', 'tok')
    expect(url).toBe('https://7107.api.greenapi.com/waInstance123/getStateInstance/tok')
  })
  it('appends an optional query string', () => {
    const url = greenApiUrl('https://x.com', '123', 'lastIncomingMessages', 'tok', '?minutes=3')
    expect(url).toBe('https://x.com/waInstance123/lastIncomingMessages/tok?minutes=3')
  })
})
