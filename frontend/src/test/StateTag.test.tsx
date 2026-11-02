// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StateTag } from '../ui'

describe('StateTag', () => {
  it('shows its text as written, in sentence case, instead of capitalising every word', () => {
    render(
      <>
        <StateTag status="queued">Starts in 59m</StateTag>
        <StateTag status="in-progress" />
        <StateTag status="FAILED" />
      </>,
    )
    const tag = screen.getByText('Starts in 59m')
    expect(tag).not.toHaveClass('capitalize')
    expect(tag).toHaveClass('text-state-queued-fg')
    // without children the status word itself is shown, as a sentence rather than CSS-capitalised
    expect(screen.getByText('In progress')).toHaveClass('text-state-running-fg')
    expect(screen.getByText('Failed')).toHaveClass('text-state-failed-fg')
  })
})
