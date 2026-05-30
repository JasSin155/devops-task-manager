# Architecture

This document describes how the DevOps Task Manager pipeline and runtime
environment are laid out. Everything runs on a single Docker host (Docker
Desktop on Windows 11 with the WSL 2 backend) across three independent Docker
Compose stacks that share one user-defined bridge network called `devops-net`.

## High-level view

```
                              Developer push (git)
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │       GitHub repo      │
                          └────────────────────────┘
                                       │
                                       ▼
                          ┌────────────────────────┐
                          │   Jenkins (port 8080)  │   ── pulls SCM ──┐
                          │  declarative pipeline  │                  │
                          └─────────┬──────────────┘                  │
                                    │                                 │
   ┌────────────────────────────────┼─────────────────────────────────┘
   │                                │
   ▼                                ▼
┌────────────┐               ┌────────────────┐
│ SonarQube  │ ◄─ scan ─     │ Application    │ ─ build/push ► local Docker
│ (port 9000)│               │   stages       │
└────────────┘               │ Build/Test/    │
                             │ Security/      │
                             │ Deploy/Release │
                             └──────┬─────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                ▼                   ▼                   ▼
        ┌──────────────┐  ┌────────────────────┐  ┌──────────────────┐
        │ Staging      │  │ Production         │  │ Monitoring stack │
        │ :3002        │  │ :3000              │  │ Prometheus :9090 │
        │ NODE_ENV=    │  │ NODE_ENV=          │  │ Grafana    :3001 │
        │  staging     │  │  production        │  │ Alertmgr   :9093 │
        └──────┬───────┘  └────────┬───────────┘  └────────┬─────────┘
               │                   │                       │
               └────── /metrics ───┴──── scrape ───────────┘
```

All seven boxes above sit on one shared Docker network, so containers reach
each other by name. Jenkins talks to SonarQube as `http://sonarqube:9000`,
Prometheus scrapes `http://task-manager-production:3000/metrics`, and so on.
No IP hard-coding anywhere.

## Three Docker Compose stacks

The system is split into three compose files that can be brought up or down
independently. This means monitoring history survives recreation of the
application containers, and CI can be torn down without affecting production.

| Stack file | Containers | Purpose |
|---|---|---|
| `docker-compose.jenkins.yml` | `jenkins`, `sonarqube` | CI (pipeline + code quality) |
| `docker-compose.staging.yml` | `task-manager-staging` | Staging environment on port 3002 |
| `docker-compose.production.yml` | `task-manager-production` | Production environment on port 3000 |
| `monitoring/docker-compose.monitoring.yml` | `prometheus`, `grafana`, `alertmanager` | Observability |

Every container in every stack joins the shared `devops-net` network. The
network is created once on the host (`docker network create devops-net`) and
referenced as `external: true` in each compose file so no compose file owns
it exclusively.

## Port allocation on the host

| Port | Service |
|---|---|
| 3000 | Production app (`task-manager-production`) |
| 3001 | Grafana |
| 3002 | Staging app (`task-manager-staging`) |
| 8080 | Jenkins UI |
| 9000 | SonarQube UI |
| 9090 | Prometheus UI |
| 9093 | Alertmanager UI |
| 50000 | Jenkins agent port |

## The Jenkins container itself

Jenkins runs in its own container but needs to do four things that are not
included in the base `jenkins/jenkins:lts-jdk17` image:

1. **Build Docker images on the host.** Handled by mounting the host's Docker
   socket at `/var/run/docker.sock` so the Jenkins container can drive the
   host's Docker daemon. This is the "Docker-out-of-Docker" pattern.
2. **Run the Docker CLI.** The base Jenkins image does not ship with `docker`.
   We install `docker.io` and the `docker-compose-plugin` directly inside the
   running container after first launch.
3. **Run Node and npm directly.** Sibling-container builds turned out to be
   fragile on Windows because of named-volume mount behaviour. We install
   Node 20 directly inside the Jenkins container so the Test and Security
   stages can call `npm` straight on the workspace.
4. **Run the SonarScanner CLI.** Installed directly into the Jenkins
   container at `/opt/sonar-scanner-*/bin/sonar-scanner`, symlinked into
   `/usr/local/bin/sonar-scanner` so the Jenkinsfile can call it as a plain
   command.

For Trivy we keep the sibling-container pattern because Trivy needs only the
Docker socket, not the workspace.

## Build artefact flow

The pipeline builds the application image exactly once per run. That same
image, tagged with `BUILD_NUMBER-gitsha`, is what flows through every later
stage.

```
Build stage
  └── docker build  →  devops-task-manager:14-1a15923   (built)
                       devops-task-manager:latest        (moving tag)
                       artifacts/devops-task-manager-14-1a15923.tar.gz
                                                         (archived in Jenkins)

Security stage
  └── Trivy reads    devops-task-manager:14-1a15923   (scans, no rebuild)

Deploy stage
  └── compose runs   devops-task-manager:14-1a15923   (port 3002, NODE_ENV=staging)

Release stage
  └── compose runs   devops-task-manager:14-1a15923   (port 3000, NODE_ENV=production)
  └── git tag        release-14-1a15923
```

Same image, four uses, zero rebuilds. The only thing that changes between
staging and production is the environment variables (NODE_ENV and JWT_SECRET).

## Monitoring data flow

```
task-manager-production  ─── /metrics ───►  Prometheus  ─── PromQL queries ───►  Grafana
                                                │
                                                └── rule evaluation ───►  Alertmanager
                                                                          (webhook → Slack/email)
```

The application exposes `/metrics` through `prom-client`, which reports:

- Default Node.js runtime metrics (CPU, heap, event-loop lag, GC stats)
- `app_http_requests_total` counter, labelled by method, route, status
- `app_http_request_duration_seconds` histogram, same labels

Prometheus scrapes both production and staging every 10 seconds. Grafana
auto-loads its datasource and dashboard from the provisioning directory at
startup, so the dashboard survives container recreation.

The pipeline's final stage posts a release annotation to Grafana through the
HTTP API. Every chart in the Task Manager dashboard then shows a vertical
line at each release time, which is what makes "did the deploy cause this?"
a one-glance answer.

## Alert rules

Four rules live in `monitoring/alert-rules.yml`:

| Alert | Condition | Severity | `for` window |
|---|---|---|---|
| AppDown | `up == 0` on a task-manager target | critical | 1 minute |
| HighErrorRate | 5xx rate > 5% | warning | 2 minutes |
| HighRequestLatency | p95 latency > 1 second | warning | 5 minutes |
| EventLoopLagHigh | Node event-loop lag > 200 ms | warning | 2 minutes |

The `for` durations are deliberate. AppDown fires fast because an outage is
the kind of thing you want to know about immediately. Latency and error
windows are longer so a single garbage-collection pause does not page anyone.

Alertmanager routes everything to a default webhook receiver. Pointing it at
a real channel (Slack, email, PagerDuty) is one configuration change in
`monitoring/alertmanager.yml`.
