// Shared vitest setup: jest-dom matchers and Testing Library cleanup between tests.
// Component tests opt into the DOM with `// @vitest-environment jsdom` at the top of the file;
// the pure-module tests keep running in node.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
