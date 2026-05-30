# DevOps Task Manager — Jenkins CI/CD Pipeline (SIT223/SIT753 HD Task)

A small REST API (Node.js + Express, JWT auth, task CRUD) used as the subject
of a full 7-stage Jenkins pipeline:

**Build → Test → Code Quality → Security → Deploy → Release → Monitoring**

Everything is containerised. You only need Docker installed on your machine.

---

## What you get

| Layer | Tool | What it does |
|---|---|---|
| App | Node.js 20, Express | REST API with `/api/auth/{register,login}` and `/api/tasks` CRUD |
| Tests | Jest + Supertest | Unit + integration, JUnit reports |
| Build | Docker | Tagged with `BUILD#-gitsha`, image archived per build |
| Code quality | SonarQube (self-hosted) | Quality gate gates the pipeline |
| Security | npm audit + Trivy | Dependency + container scans in parallel |
| Deploy | Docker Compose | Staging on :3001, smoke-tested |
| Release | Docker Compose + Git tag | Production on :3000, git tag per release |
| Monitor | Prometheus + Grafana + Alertmanager | Live dashboards, alert rules, deploy annotations |

---

## One-time setup (≈ 15 minutes)

### 0. Prerequisites
* Docker Desktop (or Docker Engine) running
* Git
* A free GitHub repository to push this code to

### 1. Push the code to GitHub

```bash
cd devops-task-manager
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:<your-username>/devops-task-manager.git
git push -u origin main
```

### 2. Start Jenkins + SonarQube

```bash
docker compose -f docker-compose.jenkins.yml up -d
```

* Jenkins UI:   http://localhost:8080
* SonarQube UI: http://localhost:9000  (default login: `admin` / `admin`)

Unlock Jenkins:
```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Install the suggested plugins, then add these extras under **Manage Jenkins → Plugins → Available**:
* **Docker Pipeline**
* **SonarQube Scanner**
* **JUnit**
* **Pipeline Utility Steps**
* **AnsiColor**
* **Timestamper**

### 3. Configure SonarQube

1. Go to http://localhost:9000 and log in (`admin` / `admin`, set a new password).
2. **My Account → Security → Generate Token** — copy the token.
3. In Jenkins: **Manage Jenkins → Credentials → System → Global → Add Credentials**
   * Kind: *Secret text*, ID: `sonar-token`, Secret: *(paste the token)*
4. In Jenkins: **Manage Jenkins → System → SonarQube servers**
   * Name: `SonarQube`
   * Server URL: `http://sonarqube:9000`
   * Server authentication token: *select the `sonar-token` credential*

### 4. Start the monitoring stack

```bash
docker network inspect devops-net >/dev/null 2>&1 || docker network create devops-net
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

* Prometheus:    http://localhost:9090
* Alertmanager:  http://localhost:9093
* Grafana:       http://localhost:3001  (login `admin` / `admin`, the dashboard auto-loads)

*(Optional)* For real alert delivery, replace the webhook URL in
`monitoring/alertmanager.yml` with one from https://webhook.site or your own
endpoint, then `docker compose -f monitoring/docker-compose.monitoring.yml restart alertmanager`.

### 5. Create the Jenkins pipeline job

1. Jenkins UI → **New Item** → name `task-manager-pipeline` → *Pipeline* → OK.
2. Under **Pipeline**:
   * Definition: *Pipeline script from SCM*
   * SCM: Git
   * Repository URL: your GitHub URL
   * Script Path: `Jenkinsfile`
3. **Save** → **Build Now**.

### 6. Watch the pipeline run

Open the build → **Console Output** to follow each stage. Or use the
**Stage View** for the visual pipeline.

When it finishes, the app is live:
* Staging:    http://localhost:3001
* Production: http://localhost:3000
* Metrics:    http://localhost:3000/metrics
* Grafana dashboard: http://localhost:3001 → *Task Manager — Production*

---

## Trying the API by hand

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"StrongPass!1"}'

# Login - grab the token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"StrongPass!1"}' | jq -r .token)

# Create a task
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Finish HD task","description":"Record the demo video"}'

# List tasks
curl http://localhost:3000/api/tasks -H "Authorization: Bearer $TOKEN"
```

---

## Project layout

```
.
├── Jenkinsfile                       # The 7-stage pipeline
├── Dockerfile                        # Multi-stage, non-root, healthchecked
├── docker-compose.jenkins.yml        # Runs Jenkins + SonarQube
├── docker-compose.staging.yml        # Staging deployment (port 3001)
├── docker-compose.production.yml     # Production deployment (port 3000)
├── sonar-project.properties          # SonarQube config (exclusions, coverage paths)
├── src/                              # Express application
│   ├── app.js
│   ├── server.js
│   ├── middleware/{auth.js,metrics.js}
│   └── routes/{auth.js,tasks.js}
├── tests/
│   ├── unit/                         # Jest unit tests
│   └── integration/                  # Supertest integration tests
├── monitoring/
│   ├── docker-compose.monitoring.yml
│   ├── prometheus.yml
│   ├── alert-rules.yml
│   ├── alertmanager.yml
│   └── grafana/...                   # Provisioned datasource + dashboard
└── docs/
    ├── REPORT_CONTENT.md             # Copy-paste content for your PDF report
    ├── DEMO_SCRIPT.md                # Word-for-word video script
    └── ARCHITECTURE.md               # Pipeline diagram (Mermaid)
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: command not found` inside Jenkins | The compose file mounts the host socket. Make sure the `jenkins` container is up and that the `user: root` line in `docker-compose.jenkins.yml` is present. |
| `network devops-net not found` | Run `docker network create devops-net` before starting any stack. |
| SonarQube quality gate keeps failing | The default quality gate is strict on coverage. Lower it in SonarQube → Quality Gates, or wait for coverage to improve. |
| Trivy reports HIGH/CRITICAL vulns | They're documented in your report (see `docs/REPORT_CONTENT.md` for the wording). The pipeline does **not** fail on them by default — change `--exit-code 0` to `--exit-code 1` in `Jenkinsfile` if you want to gate. |
| `waitForQualityGate` hangs forever | The SonarQube webhook isn't reaching Jenkins. In SonarQube: **Administration → Configuration → Webhooks → Create**, URL `http://jenkins:8080/sonarqube-webhook/`. |
