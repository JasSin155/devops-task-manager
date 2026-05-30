# Demo Video Script (target: 9 minutes)

The marking rubric rewards "professional and confident presentation with deep
insight and fluent narration." Read once, then practise the run-through twice
before recording. Record with OBS, Loom, or Zoom — 1080p, with mic + screen.

Before you press record:
* All three stacks running: `docker compose -f docker-compose.jenkins.yml ps`,
  `docker compose -f monitoring/docker-compose.monitoring.yml ps`, and any
  staging/prod containers from a previous run can be left up.
* Browser tabs pre-opened (use a fresh window):
  1. GitHub repo
  2. Jenkins job  (http://localhost:8080/job/task-manager-pipeline)
  3. SonarQube project
  4. Grafana dashboard (http://localhost:3001)
  5. http://localhost:3000  (production endpoint)
* A terminal with the repo as cwd.

---

## 0:00 – 0:30 — Intro (30 s)

> "Hi, I'm <name>, student ID <id>. For my SIT223 / SIT753 HD task I've built
> a full seven-stage Jenkins CI/CD pipeline for a Node.js REST API I call
> DevOps Task Manager. Over the next nine minutes I'll walk you through the
> repository, trigger a pipeline run, and show every stage — Build, Test,
> Code Quality, Security, Deploy, Release, and Monitoring — finishing on the
> live production app and a Grafana dashboard."

## 0:30 – 1:30 — Repo + setup (60 s)

Open the GitHub repo tab.

> "Here's the public GitHub repository — my marker and the Unit Chair both
> have access. The README at the bottom has the exact one-time setup: clone
> the repo, run `docker compose -f docker-compose.jenkins.yml up -d` to start
> Jenkins and SonarQube, then `docker compose -f monitoring/docker-compose.monitoring.yml up -d`
> to start Prometheus, Grafana, and Alertmanager."

Show the project layout:
> "The pipeline lives in `Jenkinsfile`. The app is in `src/`. Tests are split
> into `tests/unit/` and `tests/integration/`. The whole monitoring stack is
> declarative under `monitoring/`."

## 1:30 – 2:00 — Jenkins job setup (30 s)

Switch to the Jenkins tab → the job's config page.

> "In Jenkins I've created a Pipeline job pointed at this GitHub repo with
> `Jenkinsfile` as the script path. SonarQube credentials are stored in
> Jenkins credentials as `sonar-token`. I'll click **Build Now**."

Click Build Now.

## 2:00 – 2:30 — Make a small commit live (30 s)

While the build runs, switch to terminal:

> "While that builds, I'll show that this is really continuous integration —
> I'll change a tiny thing and push."

```bash
echo "// triggered from demo" >> src/app.js
git commit -am "demo: trigger pipeline"
git push
```

Switch back to Jenkins → Stage View.

## 2:30 – 3:30 — Build stage (60 s)

Click into the latest build → stage view → Build stage logs.

> "Stage one — Build. The Jenkinsfile builds a multi-stage Docker image and
> tags it with both the Jenkins build number and the short Git SHA — you can
> see the tag in the logs. That same image is saved as a tar.gz and archived
> as a build artefact, so we have an immutable copy per build, and the Docker
> labels embed the commit SHA for traceability."

## 3:30 – 4:30 — Test stage (60 s)

> "Stage two — Test. Unit and integration tests run in parallel inside a
> clean Node 20 container. Unit tests cover the JWT middleware and the
> metrics registry; integration tests drive the full register → login →
> create → list → update → delete → 404 lifecycle through Supertest. JUnit
> reports are published back to Jenkins — you can see the test trend on the
> job page."

Click the **Tests** tab on the build to show passing tests.

## 4:30 – 5:30 — Code Quality stage (60 s)

Switch to SonarQube tab.

> "Stage three — Code Quality. The sonar-scanner-cli runs inside Docker
> against the codebase, ingests the lcov coverage report from Jest, and
> publishes results to my self-hosted SonarQube. Crucially, the Jenkinsfile
> uses `waitForQualityGate abortPipeline: true` — so if the quality gate
> fails, the pipeline stops here. That's what turns this into a real gate
> rather than a vanity dashboard."

Show the SonarQube project page with the quality gate, coverage, code smells,
duplications.

## 5:30 – 6:30 — Security stage (60 s)

Switch to Jenkins → Security stage → logs.

> "Stage four — Security. Two scans run in parallel: `npm audit` for
> dependency CVEs, and Trivy against the just-built Docker image. The Trivy
> command targets HIGH and CRITICAL severity. Both reports are archived as
> Jenkins artefacts."

Click into the build's **Artifacts** → show `trivy-report.json` and
`npm-audit.json`.

> "On my first build, Trivy flagged <N> high-severity CVEs in the Alpine
> base — I addressed those by pinning to a newer base image. The npm audit
> findings were dev-only transitive dependencies; I documented them as
> accepted risk in the report and tuned `--audit-level=high` so they don't
> fail the build. This is the difference between a tool running and a tool
> being acted on."

## 6:30 – 7:30 — Deploy + Release stages (60 s)

Switch back to Jenkins stage view.

> "Stage five — Deploy. The pipeline brings up the staging container with
> Docker Compose on port 3001, then polls `/health` until it's responding,
> and fails the pipeline if it doesn't come up. Stage six — Release. The
> *same image* — same SHA — is promoted to production on port 3000 with a
> production JWT secret, polled the same way, and the Git commit is tagged
> `release-<n>-<sha>` for audit. Promoting the same image rather than
> rebuilding is the principle behind reproducible releases."

Open `http://localhost:3000` in browser:
> "And there's the live production app — same image, different environment."

Quick `curl` in terminal:
```bash
curl -s http://localhost:3000/ | jq
```

## 7:30 – 8:45 — Monitoring + alerting (75 s)

Switch to Grafana tab (http://localhost:3001 → Task Manager – Production
dashboard).

> "Stage seven — Monitoring and Alerting. The app exposes a `/metrics`
> endpoint via `prom-client`. Prometheus scrapes both staging and production,
> Alertmanager handles routing, and Grafana auto-loads this dashboard from
> the provisioning files in `monitoring/grafana`."

Run some traffic in terminal so the graphs move:
```bash
for i in {1..200}; do curl -s http://localhost:3000/health > /dev/null; done
```

> "You can see request rate, 5xx error rate, p95 latency, Node event-loop
> lag, all per-environment. The Jenkins monitoring stage also posts a release
> annotation to Grafana — there's the vertical line on every chart marking
> this deploy."

Open Prometheus tab → Status → Rules:

> "Alert rules live in `alert-rules.yml`: AppDown, HighErrorRate,
> HighRequestLatency, EventLoopLagHigh — all with realistic thresholds and
> `for` windows so we don't get alert fatigue. Alertmanager routes them to a
> webhook receiver — easy to swap for email or Slack."

*(Optional, if you want to nail Top HD's "incident simulation":)*
> "Let me simulate an incident — I'll kill production."

```bash
docker stop task-manager-production
```

Wait ~60 seconds → show the AppDown alert firing in Prometheus → Alerts tab
or Alertmanager UI. Then restart it:
```bash
docker start task-manager-production
```

## 8:45 – 9:00 — Outro (15 s)

> "That's all seven stages — Build, Test, Code Quality, Security, Deploy,
> Release, Monitoring — fully automated end-to-end from a Git push. Thanks
> for watching."

---

## Hard-won tips

* Don't read this script. Internalise the **flow**, then narrate.
* If anything fails on camera — say so out loud, fix it, and move on. Markers
  reward calm troubleshooting more than perfection.
* Keep mouse movements deliberate. Pauses between sections feel slow to you
  but read as confident to the viewer.
* Check **video resolution** before uploading — 1080p minimum.
