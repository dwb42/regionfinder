/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MunicipalityListControls } from './MunicipalityListControls'

let root: Root | null = null
let container: HTMLDivElement | null = null

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('MunicipalityListControls', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('creates a freely named list with the selected color', async () => {
    const onCreate = vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Favoriten',
      color: '#DC2626',
      municipalityCount: 0,
      createdAt: '2026-08-26T10:00:00.000Z',
      updatedAt: '2026-08-26T10:00:00.000Z',
    })

    await act(async () => {
      root?.render(
        <MunicipalityListControls
          lists={[]}
          activeListIds={[]}
          suggestedColor="#2563EB"
          isLoading={false}
          error={null}
          onToggleActive={vi.fn()}
          onCreate={onCreate}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
    })

    const nameInput = container?.querySelector<HTMLInputElement>('[aria-label="Name der neuen Gemeindeliste"]')
    const colorInput = container?.querySelector<HTMLInputElement>('[aria-label="Farbe der neuen Gemeindeliste"]')

    await act(async () => {
      if (!nameInput || !colorInput) {
        throw new Error('Missing municipality list form inputs')
      }
      setInputValue(nameInput, ' Favoriten ')
      setInputValue(colorInput, '#dc2626')
    })

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
    })

    expect(onCreate).toHaveBeenCalledWith({ name: 'Favoriten', color: '#DC2626' })
  })
})
