# Report Content (paste into the Deakin PDF template)

> Replace `<…>` placeholders with your details before exporting to PDF.

---

## Submission details

| Item | Value |
|---|---|
| Name | `<Your full name>` |
| Student ID | `<Your student ID>` |
| Unit | SIT223 / SIT753 — Professional Practice in IT |
| Task | High Distinction Task — DevOps Pipeline with Jenkins |
| Demo video | `<paste your YouTube / OneDrive / Deakin Cloud Deakin link>` |
| GitHub repository | `<paste your GitHub URL>` |
| Number of pipeline stages implemented | **7 / 7** (Build, Test, Code Quality, Security, Deploy, Release, Monitoring) |

> Both my marker and the Unit Chair have been granted access to the GitHub
> repository (it is public / I have shared it with their Deakin GitHub
> accounts).

---

## 1. Project description

The project is **DevOps Task Manager**, a RESTful task-management API designed
specifically to exercise every stage of a modern CI/CD pipeline. It supports:

* **User authentication** — register / login with bcrypt-hashed passwords and
  short-lived JWTs.
* **Task CRUD** — create, list, read, update, delete, with per-user
  authorisation.
* **Operational endpoints** — `/health` for liveness probes and `/metrics`
  exposing Prometheus metrics (request counts, latency histograms, Node.js
  runtime telemetry).
* **Production-grade middleware** — `helmet` for HTTP security headers,
  `express-rate-limit` to blunt brute-force attempts on `/login`, structured
  JSON error handling.

### Technologies used

| Layer | Tool |
|---|---|
| Language / framework | Node.js 20, Express 4 |
| Authentication | jsonwebtoken, bcryptjs |
| Testing | Jest, Supertest, jest-junit |
| Containerisation | Docker (multi-stage build, non-root user, healthcheck) |
| Orchestration | Docker Compose |
| CI / CD | Jenkins (declarative pipeline) |
| Code quality | SonarQube (self-hosted, community edition) |
| Security | npm audit (dependencies), Trivy (container image) |
| Monitoring | Prometheus, Grafana, Alertmanager |
| Source control | Git + GitHub |

---

## 2. Pipeline screenshot

> Paste a screenshot of the Jenkins **Stage View** showing all seven stages
> green. Take it from your job page at `http://localhost:8080/job/task-manager-pipeline/`.

*Also recommended: a second screenshot of the Grafana dashboard with live
traffic visible, and one of the SonarQube project page showing the quality
gate.*

---

## 3. Pipeline architecture

```
GitHub push
   │
   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Jenkins Declarative Pipeline                   │
├──────────┬──────────┬──────────────┬───────────┬─────────┬──────────────┤
│  Build   │  Test    │ Code Quality │ Security  │ Deploy  │ Release      │
│ (Docker) │ (Jest +  │  (SonarQube  │ (npm      │ (Compose│ (Compose +   │
│          │ Supertest│  quality     │ audit +   │  →      │  git tag →   │
│          │  parallel)│  gate)       │ Trivy     │  :3001) │  :3000)      │
│          │          │              │ parallel) │         │              │
└──────────┴──────────┴──────────────┴───────────┴─────────┴──────────────┘
                                                                  │
                                                                  ▼
                                                ┌─────────────────────────────┐
                                                │       Monitoring & Alerts    │
                                                │ Prometheus scrape →          │
                                                │ Grafana dashboards →         │
                                                │ Alertmanager alert rules     │
                                                └─────────────────────────────┘
```

---

## 4. Stage-by-stage description

### Stage 1 — Build

* **Tool:** Docker (multi-stage Alpine build).
* **What it does:** Builds an image tagged `devops-task-manager:<BUILD_NUMBER>-<git-sha>` plus a `:latest` tag. The image runs as a non-root user, includes an HTTP `HEALTHCHECK`, and contains only the production dependencies (`npm ci --omit=dev`).
* **Top-HD touches:** Build artefacts are versioned with both the Jenkins build number **and** the Git commit SHA, the image is saved as a `.tar.gz` and archived in Jenkins (immutable per-build artefact storage), and Docker labels embed the commit and build number for traceability.

### Stage 2 — Test

* **Tools:** Jest (unit tests), Supertest (integration tests), `jest-junit` (machine-readable reports).
* **What it does:** Runs in two parallel branches — unit tests on the auth and metrics middleware, and integration tests that drive the real Express app through the full register → login → CRUD → 404 lifecycle. JUnit XML reports are published back to Jenkins so failures appear in the build trend.
* **Top-HD touches:** Parallel execution shortens feedback time; tests run inside a clean `node:20-alpine` container to match production; results are gated — any failing test stops the pipeline before Code Quality runs; coverage is collected for SonarQube.

### Stage 3 — Code Quality

* **Tool:** SonarQube Community Edition (self-hosted on `:9000`) + `sonar-scanner-cli`.
* **What it does:** Scans the codebase for code smells, complexity, duplication, and maintainability issues. Coverage is ingested from Jest's `lcov.info`. The pipeline waits on the SonarQube **quality gate** and aborts on failure via `waitForQualityGate abortPipeline: true`.
* **Top-HD touches:** Custom exclusions (`node_modules`, `coverage`, build artefacts), coverage paths wired in, dedicated tests directory declared, and the quality gate is **enforced** rather than informational — making the pipeline truly gated by code health.

### Stage 4 — Security

* **Tools:** `npm audit` (dependency vulnerabilities) and **Trivy** (container image vulnerabilities), running in parallel.
* **What it does:** `npm audit` scans direct and transitive dependencies for known CVEs and exports a JSON report. Trivy scans the just-built Docker image, focusing on `HIGH` and `CRITICAL` severities, and exports its own JSON report. Both reports are archived as Jenkins build artefacts.
* **Findings & how I handled them:**
  * `<Replace with actual findings from your first build. Example: "Trivy reported 2 HIGH CVEs in the base image's openssl package. Severity: HIGH. Resolution: pinned to node:20.18-alpine which ships a patched openssl; re-ran the pipeline and the findings disappeared.">`
  * `<Example 2: "npm audit reported one MODERATE vulnerability in a transitive dependency of jest. Severity: moderate (dev-only, not shipped). Decision: documented as accepted risk because it is dev-only and not in the production image. The audit threshold is set to --audit-level=high so this does not fail the build.">`
* **Top-HD touches:** Scans run in parallel; severity-based gating (high+critical only); findings are interpreted, categorised, and either fixed or documented with mitigation rather than ignored.

### Stage 5 — Deploy (Staging)

* **Tool:** Docker Compose (`docker-compose.staging.yml`).
* **What it does:** Pushes the freshly-built image to a staging container on port `3001` with `NODE_ENV=staging` and a staging-specific JWT secret. The stage then polls `/health` for up to 30 seconds and **fails the pipeline** if the service never becomes healthy — preventing broken builds from progressing.
* **Top-HD touches:** Environment-specific config (env vars), automated smoke test gating the next stage, container restart policy set to `unless-stopped`, and `--force-recreate` ensures the new image is actually picked up.

### Stage 6 — Release (Production)

* **Tool:** Docker Compose (`docker-compose.production.yml`) + `git tag`.
* **What it does:** Promotes the same image (immutable across environments — the cornerstone of trustworthy releases) to a production container on port `3000` with `NODE_ENV=production`, runs the same health smoke test, then tags the Git commit `release-<BUILD_NUMBER>-<git-sha>` so the release is permanently traceable.
* **Top-HD touches:** Same image promoted across environments (no rebuild between staging and prod — the foundation of reproducible releases), environment-specific configs and secrets via env vars, Git tag for audit trail, restart-policy and healthcheck for self-healing.

### Stage 7 — Monitoring & Alerting

* **Tools:** Prometheus (scrape + alert rules), Grafana (dashboards), Alertmanager (routing + delivery), `prom-client` (in-app metrics).
* **What it does:**
  1. Verifies Prometheus is healthy and that the production target is being scraped.
  2. Verifies Alertmanager is healthy.
  3. Sends a release annotation to Grafana so the deploy line is visible on all charts.
* **Alert rules configured** (see `monitoring/alert-rules.yml`):
  * **AppDown** — `up == 0` for 1m (critical)
  * **HighErrorRate** — 5xx rate > 5% for 2m (warning)
  * **HighRequestLatency** — p95 > 1s for 5m (warning)
  * **EventLoopLagHigh** — Node event-loop lag > 200ms for 2m (warning)
* **Dashboard** — Grafana auto-loads a "Task Manager — Production" dashboard with uptime stat panels, request rate, error rate, p95 latency and event-loop lag, all per-environment.
* **Top-HD touches:** End-to-end live metrics path (app → Prometheus → Grafana), meaningful alert rules with proper "for" windows to reduce noise, Alertmanager routing for delivery, and **deployment annotations** so the team can correlate releases with metric changes.

---

## 5. Reflection / lessons learned (optional but Top HD-eligible)

* **Smooth transitions came from explicit gating.** Each stage either succeeds and unblocks the next or fails and stops the pipeline — there are no "informational" checks. This turned the pipeline from a set of independent tasks into a real quality system.
* **Same image across environments was the single biggest reliability win.** Building once and promoting the same artefact through staging and production eliminates an entire class of "works in staging, broken in prod" incidents.
* **Monitoring is only useful if it's actionable.** The alert rules deliberately use realistic thresholds and "for" durations to avoid alert fatigue. The Grafana deployment annotation is a small touch that pays off the first time a release degrades a metric.
* **If I extended this further** I would add: SBOM generation (e.g. Syft) for supply-chain attestation, signed images (cosign), blue/green deployment with traffic shifting, and a separate Sonar quality profile tuned to the project.
