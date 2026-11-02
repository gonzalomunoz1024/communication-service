import { expect, test } from '@playwright/test'
import { monitorOf, podOf, stack } from './helpers'

const SERVICE = 'fakeapp'
const POD = 'fakeapp-0'

test('F-76 F-48 F-91 SIGTERM to the sidecar → a leaving report and exit 0 → the pod is marked left and no notice opens → started again, the pod reports again', async ({ request }) => {
  const monitor = await monitorOf(request, SERVICE)
  expect(await podOf(request, monitor.id, POD)).toMatchObject({ status: 'UP', left: false })

  try {
    // docker compose stop sends SIGTERM, as the kubelet does when the pod is deleted
    const sent = Date.now()
    const stopped = await stack('stop-sidecar')
    console.log(`F-76: the sidecar had stopped ${((Date.now() - sent) / 1000).toFixed(1)} s after SIGTERM`)
    expect(stopped, 'what stack.sh stop-sidecar printed').toContain('exited with code 0')
    expect(stopped, 'what the sidecar logged while stopping').toContain('leaving report sent')

    // the backend keeps the pod, marked left, with the sidecar's last words, and counts it out at once
    await expect.poll(() => podOf(request, monitor.id, POD)).toMatchObject({ left: true, message: 'instance shutting down' })
    // every pod of the service left cleanly: scaled to zero on purpose, which is not an outage
    const after = await monitorOf(request, SERVICE)
    expect(after.state.openCommunicationId, 'notice opened for a clean shutdown').toBeUndefined()
  } finally {
    await stack('start-sidecar')
  }
  // a new sidecar process: the pod is live again
  await expect.poll(() => podOf(request, monitor.id, POD)).toMatchObject({ status: 'UP', left: false })
})
