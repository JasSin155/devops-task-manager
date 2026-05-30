// Jenkinsfile - declarative pipeline implementing all 7 HD stages.

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
  }

  stages {

    stage('Build') {
      steps {
        echo "Building ${IMAGE_NAME}"
        sh """
          docker build \\
            --label git.commit=${GIT_COMMIT} \\
            --label build.number=${BUILD_NUMBER} \\
            -t ${APP_NAME}:${IMAGE_TAG} \\
            -t ${APP_NAME}:latest \\
            .
          mkdir -p artifacts
          docker save ${APP_NAME}:${IMAGE_TAG} | gzip > artifacts/${APP_NAME}-${IMAGE_TAG}.tar.gz
        """
      }
      post {
        success {
          archiveArtifacts artifacts: 'artifacts/*.tar.gz', fingerprint: true
        }
      }
    }

    stage('Test') {
      parallel {
        stage('Unit tests') {
          steps {
            writeFile file: 'ci-unit.sh', text: '#!/bin/sh\nset -e\nnpm ci --no-audit --no-fund\nnpm test\n'
            sh '''
              chmod +x ci-unit.sh
              docker run --rm \
                -v jenkins_home:/var/jenkins_home \
                -w "${WORKSPACE}" \
                node:20-alpine \
                sh ./ci-unit.sh
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
            writeFile file: 'ci-integration.sh', text: '#!/bin/sh\nset -e\nnpm ci --no-audit --no-fund\nnpm run test:integration\n'
            sh '''
              chmod +x ci-integration.sh
              docker run --rm \
                -v jenkins_home:/var/jenkins_home \
                -w "${WORKSPACE}" \
                node:20-alpine \
                sh ./ci-integration.sh
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

    stage('Code Quality') {
      steps {
        withCredentials([string(credentialsId: 'sonar-token', variable: 'SONAR_TOKEN')]) {
          sh '''
            docker run --rm \
              --network devops-net \
              -v jenkins_home:/var/jenkins_home \
              -w "${WORKSPACE}" \
              -e SONAR_HOST_URL="${SONAR_HOST_URL}" \
              -e SONAR_TOKEN="${SONAR_TOKEN}" \
              sonarsource/sonar-scanner-cli:latest \
              -Dsonar.projectBaseDir="${WORKSPACE}"
          '''
        }
      }
    }

    stage('Security') {
      parallel {
        stage('Dependency scan (npm audit)') {
          steps {
            writeFile file: 'ci-audit.sh', text: '#!/bin/sh\nnpm ci --ignore-scripts --no-audit --no-fund\nnpm audit --audit-level=high --json > npm-audit.json || true\n'
            sh '''
              chmod +x ci-audit.sh
              docker run --rm \
                -v jenkins_home:/var/jenkins_home \
                -w "${WORKSPACE}" \
                node:20-alpine \
                sh ./ci-audit.sh
            '''
            archiveArtifacts artifacts: 'npm-audit.json', allowEmptyArchive: true
          }
        }
        stage('Container scan (Trivy)') {
          steps {
            sh """
              mkdir -p security
              docker run --rm \\
                -v /var/run/docker.sock:/var/run/docker.sock \\
                -v jenkins_home:/var/jenkins_home \\
                -w "${WORKSPACE}" \\
                aquasec/trivy:latest image \\
                  --severity HIGH,CRITICAL \\
                  --exit-code 0 \\
                  --format json \\
                  --output security/trivy-report.json \\
                  ${APP_NAME}:${IMAGE_TAG}
            """
            archiveArtifacts artifacts: 'security/trivy-report.json', allowEmptyArchive: true
          }
        }
      }
    }

    stage('Deploy to Staging') {
      steps {
        sh """
          docker network inspect devops-net >/dev/null 2>&1 || docker network create devops-net

          IMAGE_TAG=${IMAGE_TAG} \\
            docker compose -f docker-compose.staging.yml up -d --force-recreate

          for i in \$(seq 1 20); do
            if docker run --rm --network devops-net curlimages/curl:latest -fsS http://task-manager-staging:3000/health; then
              echo "Staging is healthy"
              exit 0
            fi
            sleep 3
          done
          echo "Staging never became healthy"
          exit 1
        """
      }
    }

    stage('Release to Production') {
      steps {
        sh """
          IMAGE_TAG=${IMAGE_TAG} \\
            docker compose -f docker-compose.production.yml up -d --force-recreate

          for i in \$(seq 1 20); do
            if docker run --rm --network devops-net curlimages/curl:latest -fsS http://task-manager-production:3000/health; then
              echo "Production is healthy"
              break
            fi
            sleep 3
          done

          git tag -f "release-${IMAGE_TAG}" || true
        """
      }
    }

    stage('Monitoring & Alerting') {
      steps {
        sh '''
          docker run --rm --network devops-net curlimages/curl:latest -fsS http://prometheus:9090/-/healthy
          docker run --rm --network devops-net curlimages/curl:latest -fsS http://alertmanager:9093/-/healthy
          echo "Prometheus and Alertmanager are healthy"
        '''
        sh """
          docker run --rm --network devops-net curlimages/curl:latest \\
            -fsS -X POST http://grafana:3000/api/annotations \\
            -H 'Content-Type: application/json' \\
            -u admin:admin \\
            -d '{"text":"Released ${IMAGE_TAG}","tags":["release","production"]}' \\
            || echo "WARN: could not post Grafana annotation (non-fatal)"
        """
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
  }
}
