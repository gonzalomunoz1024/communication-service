// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Segmented, type SegmentedOption } from '../ui'

type Env = 'dev' | 'stage' | 'prod' | 'dr'
const OPTIONS: SegmentedOption<Env>[] = [
  { value: 'dev', label: 'Dev' },
  { value: 'stage', label: 'Stage' },
  { value: 'prod', label: 'Prod', disabled: true },
  { value: 'dr', icon: 'refresh', title: 'Disaster recovery' },
]

/** The control as a form uses it: the selection lives in the parent. */
function Controlled({ onChange, initial = 'dev', invalid, describedBy }: { onChange?: (v: Env) => void; initial?: Env; invalid?: boolean; describedBy?: string }) {
  const [value, setValue] = useState<Env>(initial)
  return (
    <Segmented<Env>
      id="env"
      ariaLabel="Environment"
      value={value}
      invalid={invalid}
      describedBy={describedBy}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
      options={OPTIONS}
    />
  )
}

const radio = (name: string) => screen.getByRole('radio', { name })

describe('Segmented', () => {
  it('is a radiogroup with one checked, focusable segment and the rest out of the tab order', () => {
    render(<Controlled initial="stage" invalid describedBy="env-note" />)
    const group = screen.getByRole('radiogroup', { name: 'Environment' })
    expect(group).toHaveAttribute('id', 'env')
    expect(group).toHaveAttribute('aria-invalid', 'true')
    expect(group).toHaveAttribute('aria-describedby', 'env-note')
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false'])
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1])
    expect(radios.map((r) => r.getAttribute('data-value'))).toEqual(['dev', 'stage', 'prod', 'dr'])
    expect(radio('Prod')).toBeDisabled()
    // an icon-only segment is named by its title, which is also its tooltip
    expect(radio('Disaster recovery')).toHaveAttribute('title', 'Disaster recovery')
  })

  it('can be named by a visible label instead', () => {
    render(
      <>
        <span id="env-label">Environment</span>
        <Segmented<Env> ariaLabelledBy="env-label" value="dev" onChange={() => {}} options={OPTIONS} />
      </>,
    )
    expect(screen.getByRole('radiogroup', { name: 'Environment' })).not.toHaveAttribute('aria-invalid')
  })

  it('selects on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(radio('Stage'))
    expect(onChange).toHaveBeenCalledWith('stage')
    expect(radio('Stage')).toHaveAttribute('aria-checked', 'true')
    expect(radio('Dev')).toHaveAttribute('aria-checked', 'false')
    expect(radio('Stage').tabIndex).toBe(0)
    expect(radio('Dev').tabIndex).toBe(-1)
  })

  it('moves the selection and focus with the arrow keys, skipping disabled segments and wrapping around', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.tab()
    expect(radio('Dev')).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(radio('Stage')).toHaveFocus()
    expect(radio('Stage')).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}') // Prod is disabled: skipped
    expect(radio('Disaster recovery')).toHaveFocus()
    await user.keyboard('{ArrowRight}') // past the end: back to the first
    expect(radio('Dev')).toHaveFocus()
    await user.keyboard('{ArrowLeft}') // before the start: round to the last
    expect(radio('Disaster recovery')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(radio('Dev')).toHaveFocus()
    await user.keyboard('{End}')
    expect(radio('Disaster recovery')).toHaveFocus()
    expect(radio('Disaster recovery')).toHaveAttribute('aria-checked', 'true')
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(['stage', 'dr', 'dev', 'dr', 'dev', 'dr'])
  })

  it('leaves other keys alone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.tab()
    await user.keyboard('{ArrowDown}')
    expect(onChange).not.toHaveBeenCalled()
    expect(radio('Dev')).toHaveFocus()
    expect(radio('Dev')).toHaveAttribute('aria-checked', 'true')
  })

  it('does nothing on a key when every segment is disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Segmented
        ariaLabel="Nothing"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A', disabled: true },
          { value: 'b', label: 'B', disabled: true },
        ]}
      />,
    )
    await user.click(screen.getByRole('radiogroup', { name: 'Nothing' }))
    await user.keyboard('{ArrowRight}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stretches to the container and shrinks its text when asked', () => {
    render(
      <Segmented
        ariaLabel="Size"
        value="a"
        onChange={() => {}}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        full
        size="sm"
        className="extra"
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Size' })).toHaveClass('w-full', 'extra')
    expect(radio('A')).toHaveClass('flex-1', 'text-caption')
  })
})
