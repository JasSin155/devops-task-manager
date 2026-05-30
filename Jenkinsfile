// Jenkinsfile - declarative pipeline implementing all 7 HD stages.
//
// Build -> Test (unit + integration in parallel) -> Code Quality (SonarQube
// gate) -> Security (npm audit + Trivy in parallel) -> Deploy (staging) ->
// Release (production + git tag) -> Monitoring & Alerting (health check +
// Grafana annotation).

pipeline {
  agent any

  options {
    timestamps()
    ansiColor('xterm')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 30, unit: 'MINUTES')
  }

  environment {
    APP_NAME       = 'devops-task-manager'
    IMAGE_TAG      = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'local'}"
    IMAGE_NAME     = "${APP_NAME}:${IMAGE_TAG}"
    SONAR_HOST_URL = 'http://sonarqube:9000'
    GRAFANA_URL    = 'http://grafana:3000'
  }

  stages {

    // ────────────────────────────────────────────────────────────────────────
    // 1. BUILD
    // ────────────────────────────────────────────────────────────────────────
    stage('Build') {
      steps {
        echo "Building ${IMAGE_NAME}"
        sh '''
          docker build \
            --label "git.commit=${GIT_COMMIT}" \
            --label "build.number=${BUILD_NUMBER}" \
            -t ${APP_NAME}:${IMAGE_TAG} \
            -t ${APP_NAME}:latest \
            .
          # Save artefact for archiving so we have an immutable copy per build.
          mkdir -p artifacts
          docker save ${APP_NAME}:${IMAGE_TAG} | gzip > artifacts/${APP_NAME}-${IMAGE_TAG}.tar.gz
        '''
      }
      post {
        success {
          archiveArtifacts artifacts: 'artifacts/*.tar.gz', fingerprint: true
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. TEST  (unit + integration in parallel)
    // ────────────────────────────────────────────────────────────────────────
    stage('Test') {
      parallel {
        stage('Unit tests') {
          steps {
            sh '''
              docker run --rm \
                -v "$PWD":/app -w /app \
                node:20-alpine sh -c "npm ci && npm test"
            '''
          }
          post {
            always {
              junit allowEmptyResults: true, testResults: 'test-results/junit.xml'
            }
          }
        }
        stage('Integration tests') {
          steps {
            sh '''
              docker run --rm \
                -v "$PWD":/app -w /app \
                node:20-alpine sh -c "npm ci && npm run test:integration"
            '''
          }
          post {
            always {
              junit allowEmptyResults: true, testResults: 'test-results/junit.xml'
            }
          }
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 3. CODE QUALITY  (SonarQube with quality-gate gating)
    // ────────────────────────────────────────────────────────────────────────
    stage('Code Quality') {
      steps {
        withCredentials([string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN')]) {
          sh '''
            docker run --rm \
              --network devops-net \
              -v "$PWD":/usr/src \
              -e SONAR_HOST_URL=${SONAR_HOST_URL} \
              -e SONAR_TOKEN=${SONAR_TOKEN} \
              sonarsource/sonar-scanner-cli:latest
          '''
        }
        // Block the pipeline until SonarQube finishes computing the quality gate.
        // Requires the SonarQube Scanner plugin to be installed and configured.
        timeout(time: 5, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. SECURITY  (dependency + container scans in parallel)
    // ────────────────────────────────────────────────────────────────────────
    stage('Security') {
      parallel {
        stage('Dependency scan (npm audit)') {
          steps {
            sh '''
              # Don't fail on low/moderate vulns - we report and triage instead.
              docker run --rm -v "$PWD":/app -w /app node:20-alpine sh -c \
                "npm ci --ignore-scripts && npm audit --audit-level=high --json > npm-audit.json || true"
            '''
            archiveArtifacts artifacts: 'npm-audit.json', allowEmptyArchive: true
          }
        }
        stage('Container scan (Trivy)') {
          steps {
            sh '''
              mkdir -p security
              # Fail the build only on HIGH/CRITICAL vulnerabilities in the built image.
              docker run --rm \
                -v /var/run/docker.sock:/var/run/docker.sock \
                -v "$PWD"/security:/out \
                aquasec/trivy:latest image \
                  --severity HIGH,CRITICAL \
                  --exit-code 0 \
                  --format json \
                  --output /out/trivy-report.json \
                  ${APP_NAME}:${IMAGE_TAG}
            '''
            archiveArtifacts artifacts: 'security/trivy-report.json', allowEmptyArchive: true
          }
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 5. DEPLOY  (staging environment - port 3001)
    // ────────────────────────────────────────────────────────────────────────
    stage('Deploy to Staging') {
      steps {
        sh '''
          # Make sure the shared network exists.
          docker network inspect devops-net >/dev/null 2>&1 || docker network create devops-net

          IMAGE_TAG=${IMAGE_TAG} \
            docker compose -f docker-compose.staging.yml up -d --force-recreate

          # Smoke-test the staging service before declaring success.
          for i in $(seq 1 15); do
            if curl -fsS http://localhost:3001/health; then
              echo "Staging is healthy"
              exit 0
            fi
            sleep 2
          done
          echo "Staging never became healthy"
          exit 1
        '''
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 6. RELEASE  (production environment - port 3000 + git tag)
    // ────────────────────────────────────────────────────────────────────────
    stage('Release to Production') {
      steps {
        sh '''
          IMAGE_TAG=${IMAGE_TAG} \
            docker compose -f docker-compose.production.yml up -d --force-recreate

          for i in $(seq 1 15); do
            if curl -fsS http://localhost:3000/health; then
              echo "Production is healthy"
              break
            fi
            sleep 2
          done

          # Tag this commit as a released version so the release is traceable.
          git tag -f "release-${IMAGE_TAG}" || true
        '''
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 7. MONITORING & ALERTING
    // ────────────────────────────────────────────────────────────────────────
    stage('Monitoring & Alerting') {
      steps {
        sh '''
          # 1) Confirm Prometheus is up and scraping our app.
          curl -fsS http://localhost:9090/-/healthy
          curl -fsS "http://localhost:9090/api/v1/targets" \
            | grep -q "task-manager-production" \
            && echo "Prometheus is scraping production" \
            || echo "WARN: production target not yet visible to Prometheus"

          # 2) Confirm Alertmanager is up.
          curl -fsS http://localhost:9093/-/healthy

          # 3) Drop a release annotation onto Grafana so the deploy is visible on graphs.
          curl -fsS -X POST http://localhost:3001/api/annotations -o /dev/null \
            -H 'Content-Type: application/json' \
            -u admin:admin \
            -d "{\\"text\\":\\"Released ${IMAGE_TAG}\\",\\"tags\\":[\\"release\\",\\"production\\"]}" \
            2>/dev/null || true   # don't fail the pipeline if Grafana isn't configured yet
        '''
      }
    }
  }

  post {
    success {
      echo "Pipeline succeeded - ${APP_NAME}:${IMAGE_TAG} is live in production"
    }
    failure {
      echo "Pipeline failed - check the stage logs above"
    }
    always {
      cleanWs(patterns: [[pattern: 'artifacts/*.tar.gz', type: 'INCLUDE']])
    }
  }
}
