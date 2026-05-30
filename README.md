# DevOps Task Manager

A Node.js REST API used as the subject of a complete 7-stage Jenkins CI/CD
pipeline, built for the SIT223/SIT753 HD Task.

The pipeline:

**Build → Test → Code Quality → Security → Deploy → Release → Monitoring**

Everything runs in Docker. The only thing you need installed on the host is
Docker Desktop.

---

## What this project contains

| Layer | Tool |
|---|---|
| App | Node.js 20 + Express, JWT auth, per-user task CRUD |
| Tests | Jest unit tests + Supertest integration tests |
| Build | Multi-stage Docker (non-root, healthchecked) |
| Code quality | SonarQube Community Edition (self-hosted) |
| Security | npm audit + Trivy (parallel) |
| Deploy | Docker Compose, staging on :3002 |
| Release | Docker Compose, production on :3000, plus git tag |
| Monitoring | Prometheus + Grafana + Alertmanager, auto-provisioned dashboard |

---

## Prerequisites

* Windows 11 (this guide assumes Windows, but the commands are mostly portable)
* WSL 2 enabled
* Docker Desktop with the WSL 2 backend
* Git
* At least 12 GB of RAM allocated to WSL via `~/.wslconfig`

If you have not done the Docker side yet, the short version is:

```powershell
wsl --install
wsl --update
wsl --set-default-version 2
```

Then install Docker Desktop from <https://www.docker.com/products/docker-desktop/>.
After the install, increase WSL resources by creating `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
memory=12GB
processors=8
swap=4GB
```

Then restart WSL and Docker:

```powershell
wsl --shutdown
```

(Quit Docker Desktop from the tray, then relaunch it from the Start menu.)

Verify Docker works:

```powershell
docker run hello-world
```

---

## Setup, from zero

Run every command below in order. Total wall-clock time is around 25 minutes,
mostly waiting for image pulls on the first run.

### 1. Clone the repository

```powershell
cd $env:USERPROFILE
mkdir devops-hd
cd devops-hd
git clone https://github.com/JasSin155/devops-task-manager.git
cd devops-task-manager
```

### 2. Start Jenkins and SonarQube

```powershell
docker compose -f docker-compose.jenkins.yml up -d
```

First run takes 3-5 minutes (pulls ~1.5 GB of images).

Verify both containers are running:

```powershell
docker ps
```

Get the initial Jenkins unlock password:

```powershell
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

### 3. Configure Jenkins (one-time, through the browser)

Open <http://localhost:8080>:

1. Paste the unlock password from the previous step.
2. Choose **Install suggested plugins** and wait for it to finish (~5 minutes).
3. Create the admin user. Pick any username and password you will remember.
4. On the next screen leave the Jenkins URL as `http://localhost:8080/` and
   click Save.

Install three extra plugins. Go to **Manage Jenkins → Plugins → Available
plugins** and tick each of these (search one at a time):

* Docker Pipeline
* SonarQube Scanner
* AnsiColor

Then click **Install**, tick "Restart Jenkins when installation is complete
and no jobs are running", and wait ~30 seconds for Jenkins to come back.

### 4. Configure SonarQube (one-time, through the browser)

Open <http://localhost:9000>:

1. Log in as `admin` / `admin`.
2. It will force a password change. Pick something memorable.
3. Top-right avatar → **My Account → Security**.
4. Generate a token named `jenkins`, no expiration. **Copy the token now**,
   it is shown only once.

### 5. Tell Jenkins about the SonarQube token

In Jenkins:

1. **Manage Jenkins → Credentials → System → Global → Add Credentials**.
2. Kind: Secret text. Secret: the token from the step above.
   **ID must be exactly `sonar-token`** (lowercase, with hyphen).
3. **Manage Jenkins → System** → scroll to **SonarQube servers** →
   **Add SonarQube**:
   * Name: `SonarQube`
   * Server URL: `http://sonarqube:9000`
   * Server authentication token: pick `sonar-token` from the dropdown
4. Save.

### 6. Create the SonarQube → Jenkins webhook

Back in SonarQube:

1. **Administration → Configuration → Webhooks → Create**.
2. Name: `Jenkins`. URL: `http://jenkins:8080/sonarqube-webhook/` (include
   the trailing slash). Leave Secret blank. Save.

### 7. Install the tools Jenkins needs inside its own container

The base Jenkins image does not ship with Docker, Node, or the SonarScanner.
Install all three with these three commands:

```powershell
# Docker CLI and Compose plugin
docker exec -u root jenkins bash -c "apt-get update && apt-get install -y docker.io docker-compose-plugin"

# Node.js 20 (used directly by the Test and Security stages)
docker exec -u root jenkins bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"

# SonarScanner CLI (used by the Code Quality stage)
docker exec -u root jenkins bash -c "apt-get install -y unzip && curl -fsSL https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-6.2.1.4610-linux-x64.zip -o /tmp/sonar.zip && unzip -q /tmp/sonar.zip -d /opt && ln -sf /opt/sonar-scanner-6.2.1.4610-linux-x64/bin/sonar-scanner /usr/local/bin/sonar-scanner && sonar-scanner --version"
```

Verify all three are installed:

```powershell
docker exec jenkins docker --version
docker exec jenkins docker compose version
docker exec jenkins node --version
docker exec jenkins sonar-scanner --version
```

> **Note:** If you ever recreate the Jenkins container (for example with
> `docker compose down`), these three installs are wiped and you will need
> to run them again. For coursework that is fine.

### 8. Start the monitoring stack

The `devops-net` network was created by the Jenkins compose file, but verify
it exists before starting monitoring:

```powershell
docker network inspect devops-net
```

If you see `[]` or an error, create it:

```powershell
docker network create devops-net
```

Then start monitoring:

```powershell
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

Verify all five services are now running:

```powershell
docker ps
```

You should see `jenkins`, `sonarqube`, `prometheus`, `grafana`, `alertmanager`.

Open each one to confirm they respond:

* Prometheus: <http://localhost:9090>
* Alertmanager: <http://localhost:9093>
* Grafana: <http://localhost:3001> (login `admin` / `admin`, then click Skip
  on the password change prompt)

### 9. Create the Jenkins pipeline job

In Jenkins:

1. Dashboard → **New Item**.
2. Item name: `task-manager-pipeline`. Type: **Pipeline**. OK.
3. Scroll down to the **Pipeline** section:
   * Definition: **Pipeline script from SCM**
   * SCM: **Git**
   * Repository URL: `https://github.com/JasSin155/devops-task-manager.git`
   * Branch specifier: `*/main`
   * Script Path: `Jenkinsfile`
4. Save.

### 10. Run the pipeline

Click **Build Now** on the job page. The first build takes about 8-12 minutes
because it has to pull the Trivy database, the SonarScanner image, and the
sibling containers used by some stages. Later runs take 2-3 minutes.

When the build finishes, you should see all 7 stages green. The live URLs are:

* Production app: <http://localhost:3000>
* Staging app: <http://localhost:3002>
* Grafana dashboard: <http://localhost:3001> → Dashboards → Task Manager
* Prometheus targets: <http://localhost:9090/targets>

---

## Using the API by hand

```powershell
# Register a user
curl -X POST http://localhost:3000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{\"username\":\"alice\",\"password\":\"StrongPass!1\"}'

# Log in and capture the token
$token = (curl -s -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{\"username\":\"alice\",\"password\":\"StrongPass!1\"}' | ConvertFrom-Json).token

# Create a task
curl -X POST http://localhost:3000/api/tasks `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{\"title\":\"Record demo\",\"description\":\"For the HD task\"}'

# List my tasks
curl http://localhost:3000/api/tasks -H "Authorization: Bearer $token"
```

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker: command not found` inside Jenkins | Step 7 was skipped or the Jenkins container was recreated. Re-run the install commands. |
| `docker compose: unknown shorthand flag: 'f'` | The Compose plugin was not installed inside the Jenkins container. Re-run the `docker-compose-plugin` install command from Step 7. |
| SonarQube quality gate hangs at "Checking quality gate" | The webhook in Step 6 is missing. Add it and retry. |
| Code Quality stage cannot find `sonar-scanner` | SonarScanner CLI was not installed in Step 7. Re-run that command. |
| `port is already allocated` on 3000, 3001, 3002, 8080, or 9000 | Another service is using the port. Stop it or change the port in the relevant compose file. |
| Trivy report missing from artefacts | Make sure you are using the final Jenkinsfile, which captures Trivy output via stdout. |
| Build, Test, etc. all skipped after Test fails | Expected. Stages gate each other. Fix the first failure. |

---

## Stopping everything

```powershell
docker compose -f monitoring/docker-compose.monitoring.yml down
docker compose -f docker-compose.production.yml down
docker compose -f docker-compose.staging.yml down
docker compose -f docker-compose.jenkins.yml down
```

Add `-v` to any of these to also delete the volumes (will wipe Jenkins
configuration, SonarQube data, and Grafana dashboards).

---

## Repository layout

```
.
├── Jenkinsfile                       (the 7-stage declarative pipeline)
├── Dockerfile                        (multi-stage Alpine, non-root, healthchecked)
├── docker-compose.jenkins.yml        (Jenkins + SonarQube stack)
├── docker-compose.staging.yml        (staging deployment on :3002)
├── docker-compose.production.yml     (production deployment on :3000)
├── sonar-project.properties          (SonarQube exclusions and coverage paths)
├── src/
│   ├── app.js                        (Express app factory)
│   ├── server.js                     (HTTP listener)
│   ├── middleware/
│   │   ├── auth.js                   (JWT sign + verify)
│   │   └── metrics.js                (Prometheus metrics middleware)
│   └── routes/
│       ├── auth.js                   (register + login)
│       └── tasks.js                  (authenticated CRUD)
├── tests/
│   ├── unit/                         (Jest unit tests)
│   └── integration/                  (Supertest integration tests)
├── monitoring/
│   ├── docker-compose.monitoring.yml (Prometheus + Grafana + Alertmanager)
│   ├── prometheus.yml                (scrape config)
│   ├── alert-rules.yml               (4 alert rules)
│   ├── alertmanager.yml              (routing + receivers)
│   └── grafana/                      (provisioned datasource + dashboard)
└── docs/
    └── ARCHITECTURE.md               (system architecture)
```
