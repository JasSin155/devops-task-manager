# Architecture

The whole system runs on a single Docker host. Three independent compose
stacks share one Docker network (`devops-net`) so containers can reach each
other by name.

```mermaid
flowchart LR
  Dev[Developer] -->|git push| GH[(GitHub)]
  GH -->|webhook / poll| J[Jenkins]

  subgraph Pipeline[Jenkins Pipeline]
    direction LR
    B[Build] --> T[Test]
    T --> Q[Code Quality]
    Q --> Sec[Security]
    Sec --> D[Deploy → staging :3001]
    D --> R[Release → production :3000]
    R --> Mon[Monitoring & Alerting]
  end

  J --> Pipeline

  Q -.scan.-> SQ[(SonarQube)]
  Sec -.audit.-> NPM[npm audit]
  Sec -.scan.-> Tr[Trivy]

  D --> Stg[task-manager-staging]
  R --> Prd[task-manager-production]

  Stg -- /metrics --> Prom[(Prometheus)]
  Prd -- /metrics --> Prom
  Prom --> Graf[(Grafana)]
  Prom --> AM[(Alertmanager)]
  AM -->|webhook / email| Ops[On-call]

  Mon -.annotation.-> Graf
  Mon -.health.-> Prom
```

## Containers, by stack

| Stack | Containers | Network |
|---|---|---|
| `docker-compose.jenkins.yml` | `jenkins`, `sonarqube` | `devops-net` |
| `monitoring/docker-compose.monitoring.yml` | `prometheus`, `alertmanager`, `grafana` | `devops-net` |
| `docker-compose.staging.yml` | `task-manager-staging` | `devops-net` |
| `docker-compose.production.yml` | `task-manager-production` | `devops-net` |

## Why this layout

* **One shared network** means Jenkins can talk to SonarQube as
  `http://sonarqube:9000`, Prometheus can scrape `task-manager-production:3000`
  by name, etc — no IP hard-coding.
* **Staging and production are the same image, different env vars** — the
  core principle behind reproducible releases.
* **Monitoring is a long-running stack of its own** so dashboards survive
  across pipeline runs and can correlate releases with metrics.
