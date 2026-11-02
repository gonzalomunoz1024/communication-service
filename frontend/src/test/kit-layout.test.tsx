// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Badge, Card, CardRow, Checkbox, PageHeader, Select, StatusDot } from '../ui'

describe('PageHeader', () => {
  it('renders the eyebrow, the h1, the subtitle, the actions, the back link and the children', async () => {
    const back = vi.fn()
    render(
      <PageHeader eyebrow="Jobs" title="Deploy" subtitle="Nightly" actions={<button type="button">Run</button>} back={{ href: '#/jobs', label: 'Jobs', onClick: back }} className="extra">
        <p>filters</p>
      </PageHeader>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Deploy' })).toBeInTheDocument()
    expect(screen.getByText('Nightly')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    expect(screen.getByText('filters')).toBeInTheDocument()
    expect(screen.getAllByText('Jobs')).toHaveLength(2) // the eyebrow and the back link
    const link = screen.getByRole('link', { name: 'Jobs' })
    expect(link).toHaveAttribute('href', '#/jobs')
    await userEvent.setup().click(link)
    expect(back).toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 }).closest('.extra')).not.toBeNull()
  })

  it('is just the title when nothing else is given', () => {
    render(<PageHeader title="Feed" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Feed' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('Card', () => {
  it('titles itself at the heading level the page asks for, with subtitle and actions', () => {
    render(
      <Card title="Timing" titleAs="h2" subtitle="Local time" actions={<button type="button">Schedule</button>}>
        body
      </Card>,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Timing' })).toBeInTheDocument()
    expect(screen.getByText('Local time')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('has no header without a title, and takes the interactive and flush variants', () => {
    render(
      <Card interactive flush className="extra" data-testid="card">
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </Card>,
    )
    const card = screen.getByTestId('card')
    expect(screen.queryByRole('heading')).toBeNull()
    expect(card).toHaveClass('cursor-pointer', 'extra')
    expect(screen.getByText('cell').closest('div')).not.toHaveClass('p-5')
  })

  it('lays out rows with a label, a description and a value, plain or stacked', () => {
    render(
      <Card>
        <CardRow label="Owner" description="the team on call">
          payments-oncall
        </CardRow>
        <CardRow label="Path" stacked description="full width">
          /very/long/path
        </CardRow>
        <CardRow label="Empty" />
      </Card>,
    )
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('the team on call')).toBeInTheDocument()
    expect(screen.getByText('payments-oncall')).toBeInTheDocument()
    expect(screen.getByText('full width')).toBeInTheDocument()
    expect(screen.getByText('/very/long/path')).toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })
})

describe('Checkbox', () => {
  it('is a labelled native checkbox that reports its new state', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Notify" description="Email on every change" id="notify" />)
    const box = screen.getByRole('checkbox', { name: /Notify/ })
    expect(box).toHaveAttribute('id', 'notify')
    expect(box).not.toBeChecked()
    expect(screen.getByText('Email on every change')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByText('Notify'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('cannot be toggled while disabled', async () => {
    const onChange = vi.fn()
    render(<Checkbox checked onChange={onChange} label="Locked" disabled />)
    const box = screen.getByRole('checkbox', { name: /Locked/ })
    expect(box).toBeChecked()
    expect(box).toBeDisabled()
    await userEvent.setup().click(screen.getByText('Locked'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Select', () => {
  it('is a labelled native select with a placeholder, hints after the labels and disabled options', async () => {
    const onChange = vi.fn()
    render(
      <Select
        ariaLabel="Audience"
        value=""
        placeholder="Pick one"
        onChange={onChange}
        options={[
          { value: 'customers', label: 'Customers', hint: 'the default' },
          { value: 'internal', label: 'Internal', disabled: true },
        ]}
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Audience' })
    expect(select).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Pick one' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Customers — the default' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Internal' })).toBeDisabled()
    await userEvent.setup().selectOptions(select, 'customers')
    expect(onChange).toHaveBeenCalledWith('customers')
  })

  it('can be disabled as a whole and drawn small and monospaced', () => {
    render(<Select ariaLabel="Tenant" value="acme" onChange={() => {}} options={[{ value: 'acme', label: 'acme' }]} disabled size="sm" mono />)
    const select = screen.getByRole('combobox', { name: 'Tenant' })
    expect(select).toBeDisabled()
    expect(select).toHaveClass('font-mono', 'text-caption')
  })
})

describe('StatusDot', () => {
  it('is an image named by its kind when it stands alone', () => {
    render(<StatusDot kind="critical" />)
    const dot = screen.getByRole('img', { name: 'critical' })
    expect(dot.style.background).toBe('var(--color-critical)')
  })

  it('is decoration next to its label, and can take any colour variable', () => {
    render(<StatusDot kind="healthy" label="Live" pulse size="sm" varName="--color-state-running" className="extra" />)
    const text = screen.getByText('Live')
    expect(text).toHaveClass('extra')
    const dot = text.querySelector('span[aria-hidden="true"]')!
    expect(dot).toHaveClass('animate-pulse-subtle', 'h-1.5')
    expect((dot as HTMLElement).style.background).toBe('var(--color-state-running)')
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('Badge', () => {
  it('shows the count, caps it at the maximum and hides zero unless asked', () => {
    const { rerender } = render(<Badge count={7} tone="critical" />)
    expect(screen.getByText('7')).toHaveClass('bg-critical')
    rerender(<Badge count={250} max={99} />)
    expect(screen.getByText('99+')).toBeInTheDocument()
    rerender(<Badge count={0} />)
    expect(screen.queryByText('0')).toBeNull()
    rerender(<Badge count={0} showZero />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(within(screen.getByText('0')).queryByRole('img')).toBeNull()
  })
})
