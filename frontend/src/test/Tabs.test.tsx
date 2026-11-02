// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Tabs, type TabItem } from '../ui'

type Section = 'feed' | 'publish' | 'admin' | 'audit'
const TABS: TabItem<Section>[] = [
  { id: 'feed', label: 'Feed', icon: 'bell', count: 3 },
  { id: 'publish', label: 'Publish', icon: 'plus', count: 0 },
  { id: 'admin', label: 'Admin', disabled: true },
  { id: 'audit', label: 'Audit', count: 120 },
]

/** The tab row as the shell uses it: the selected tab lives in the parent. */
function Controlled({ onChange, initial = 'feed' }: { onChange?: (id: Section) => void; initial?: Section }) {
  const [value, setValue] = useState<Section>(initial)
  return (
    <Tabs<Section>
      ariaLabel="Sections"
      tabs={TABS}
      value={value}
      className="mb-5"
      onChange={(id) => {
        setValue(id)
        onChange?.(id)
      }}
    />
  )
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })

describe('Tabs', () => {
  it('is a tablist with one selected, focusable tab; counts are badges, zero is hidden, disabled tabs are inert', () => {
    render(<Controlled />)
    expect(screen.getByRole('tablist', { name: 'Sections' })).toHaveClass('mb-5')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1])
    expect(tabs.map((t) => t.getAttribute('data-tab'))).toEqual(['feed', 'publish', 'admin', 'audit'])
    expect(within(tab(/^Feed/)).getByText('3')).toBeInTheDocument()
    expect(tab(/^Publish/)).toHaveTextContent(/^Publish$/)
    expect(within(tab(/^Audit/)).getByText('99+')).toBeInTheDocument()
    expect(tab(/^Admin/)).toBeDisabled()
  })

  it('switches on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(tab(/^Audit/))
    expect(onChange).toHaveBeenCalledWith('audit')
    expect(tab(/^Audit/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/^Feed/)).toHaveAttribute('aria-selected', 'false')
    expect(tab(/^Audit/).tabIndex).toBe(0)
    expect(tab(/^Feed/).tabIndex).toBe(-1)
  })

  it('moves with the arrow keys, skipping disabled tabs and wrapping around', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.tab()
    expect(tab(/^Feed/)).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(tab(/^Publish/)).toHaveFocus()
    expect(tab(/^Publish/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}') // Admin is disabled: skipped
    expect(tab(/^Audit/)).toHaveFocus()
    await user.keyboard('{ArrowRight}') // past the end: back to the first
    expect(tab(/^Feed/)).toHaveFocus()
    await user.keyboard('{ArrowLeft}') // before the start: round to the last
    expect(tab(/^Audit/)).toHaveFocus()
    expect(onChange.mock.calls.map(([id]) => id)).toEqual(['publish', 'audit', 'feed', 'audit'])
  })

  it('leaves other keys alone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.tab()
    await user.keyboard('{ArrowDown}{Home}{End}')
    expect(onChange).not.toHaveBeenCalled()
    expect(tab(/^Feed/)).toHaveFocus()
  })

  it('does nothing on a key when every tab is disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Tabs
        ariaLabel="Nothing"
        value="a"
        onChange={onChange}
        tabs={[
          { id: 'a', label: 'A', disabled: true },
          { id: 'b', label: 'B', disabled: true },
        ]}
      />,
    )
    await user.click(screen.getByRole('tablist', { name: 'Nothing' }))
    await user.keyboard('{ArrowRight}')
    expect(onChange).not.toHaveBeenCalled()
  })
})
