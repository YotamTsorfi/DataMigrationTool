pipeline {
    agent any

    environment {
        DOCKER_BUILDKIT = 1
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Build & Test') {
            steps {
                sh 'npm install'
                sh 'npm run build'
                sh 'cd client && npm install && npm run build'
            }
        }
        stage('Build Docker Images') {
            steps {
                sh 'docker-compose build'
            }
        }
        stage('Deploy (Production)') {
            when {
                branch 'main'
            }
            steps {
                sh 'docker-compose down || true'
                sh 'docker-compose up -d --force-recreate'
            }
        }
        stage('Deploy (Dev)') {
            when {
                branch 'dev'
            }
            steps {
                sh 'docker-compose down || true'
                sh 'docker-compose up -d --force-recreate'
            }
        }
    }
    post {
        always {
            cleanWs()
        }
    }
}