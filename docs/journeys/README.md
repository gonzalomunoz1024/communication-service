# Outage journeys

Two pages that show every journey through the communication service, for product and technical readers:

- [`outage-walkthroughs.html`](outage-walkthroughs.html): each journey as it happened on the running system, step by
  step: screenshots of the React screens, the API calls with their answers, and what the health sidecar and the service
  logged.
- [`outage-journeys.html`](outage-journeys.html): the same journeys as sticky swim lanes (one lane per part of the
  system, one slip per step, numbered arrows), with a *Plain words* view and a *Technical* view.

GitHub shows HTML files as source: open them from a checkout in a browser. The walkthrough's screenshots are in `img/`,
and `manifest.json` is the data the walkthrough page is rendered from.

## How they are made

Both pages are generated. Change the sources in `src/`, not the HTML.

| Page | Sources | Rebuild (from the repository root) |
|---|---|---|
| Swim lanes | `src/journeys_data.py` (the journeys, in both views), `src/gen.py` (layout and SVG), `src/ref.css`, `src/ref.js`, `src/ref-keys.html` | `python3 -I docs/journeys/src/build_lanes.py docs/journeys/outage-journeys.html - outage-walkthroughs.html` |
| Walkthrough | `src/capture.js` drives a running stack and writes `img/` and `manifest.json`; `src/render_shots.py` turns them into the page | `JR_COMMIT=<commit> python3 -I docs/journeys/src/render_shots.py` |

Both build scripts can also write the page without its document wrapper, the form a claude.ai Artifact takes
(`build_lanes.py <full.html> <artifact.html> [href]`, `render_shots.py --artifact`).

### Capturing the walkthrough again

`capture.js` changes data and stops things: it publishes and deletes notices in the tenants `journeys` and
`journeys-valve`, registers health monitors, stops and starts the backend, and stops, starts and pauses the MongoDB
container. Run it against a stack of its own, never a shared one.

It needs:

- Node with the `playwright` package and its Chromium, for example
  `npm i --prefix ~/.cache/journeys-pw playwright && ~/.cache/journeys-pw/node_modules/.bin/playwright install chromium`,
  then run it with `NODE_PATH=~/.cache/journeys-pw/node_modules node docs/journeys/src/capture.js`;
- Docker, with two local images: `docker build -t health-sidecar:ci sidecar/` and `docker build -t fakeapp:ci e2e/fakeapp`;
- MongoDB in a Docker container, the backend (`java -jar build/libs/*.jar`), and the frontend dev server pointed at it
  (`COMM_BACKEND=<backend URL> npm run dev` in `frontend/`);
- `kustomize` on the PATH (or in `JR_TOOLS`) for the onboarding transcript.

The emulated pods use host ports 18180/18181 and 18190/18191. Settings:

| Variable | What it is | Default |
|---|---|---|
| `JR_UI` | the frontend | `http://127.0.0.1:3000` |
| `JR_API` | the backend | `http://localhost:8080` |
| `JR_SIDECAR_ENDPOINT` | the backend as the sidecar containers reach it | `http://172.17.0.1:8080` |
| `JR_MONGO` | the MongoDB container's name | `mongo7` |
| `JR_BACKEND_LOG` | the backend's log file, quoted in some steps | none |
| `JR_RESTART_BACKEND` | set to anything to run the restart journey | restart skipped |
| `JR_STOP_BACKEND`, `JR_START_BACKEND` | shell commands that stop and start the backend (restart journey) | none |
| `JR_APP_IMAGE`, `JR_SIDECAR_IMAGE`, `JR_NETNS_IMAGE` | images for the emulated pods | `fakeapp:ci`, `health-sidecar:ci`, `golang:1.24` |
| `JR_TOOLS` | extra PATH entries | none |
| `JR_OUT` | where `img/` and `manifest.json` go | `docs/journeys` |
| `JR_ONLY` | run only these journeys, for example `jPublish,jAdmin` | all |

The pages in this folder were captured on 2026-11-02 from the code at `1cd3f13`: the backend jar on port 18300 with
`communication.servicenow.instance-url=https://example.service-now.com`, the frontend dev server on port 3300, and
MongoDB 7.0 in a container. The short timers in some steps (a probe every 5 s, a 75 s maintenance window) are settings
of the walkthrough; each step states the default.
