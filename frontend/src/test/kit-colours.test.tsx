// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button, Field, Input, StateTag, Tag } from '../ui'

/** The kit puts text in the AA *-fg hue, never in the fill hue (which is for dots, rails and fills). */
describe('kit colour recipes', () => {
  it('tinted capsules use the readable text hue', () => {
    render(
      <>
        <Tag tone="critical">Critical</Tag>
        <Tag tone="warning">Major</Tag>
        <Tag tone="healthy">Resolved</Tag>
        <Tag tone="accent">Minor</Tag>
        <StateTag status="failing">Active</StateTag>
        <StateTag status="queued">Starts soon</StateTag>
      </>,
    )
    expect(screen.getByText('Critical').parentElement).toHaveClass('bg-critical-tint', 'text-critical-fg')
    expect(screen.getByText('Major').parentElement).toHaveClass('text-warning-fg')
    expect(screen.getByText('Resolved').parentElement).toHaveClass('text-healthy-fg')
    expect(screen.getByText('Minor').parentElement).toHaveClass('text-accent-fg')
    expect(screen.getByText('Active')).toHaveClass('bg-state-failed-tint', 'text-state-failed-fg')
    expect(screen.getByText('Starts soon')).toHaveClass('text-state-queued-fg')
  })

  it('field errors are 12 px in the readable critical hue', () => {
    render(
      <Field label="Title" htmlFor="t" error="Title is required" hint="never shown">
        <Input id="t" invalid />
      </Field>,
    )
    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Title is required')
    expect(error).toHaveClass('text-caption', 'text-critical-fg')
    expect(error).not.toHaveClass('text-caption2')
  })

  it('the warning outline button keeps its text readable', () => {
    render(<Button variant="warning-outline">Pause</Button>)
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('text-warning-fg', 'border-warning')
  })
})
