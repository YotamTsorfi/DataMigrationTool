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
                bat 'npm install'
                bat 'npm run build'
                bat 'cd client && npm install && npm run build'
            }
        }
        stage('Build Docker Images') {
            steps {
                bat 'docker-compose build'
            }
        }
        stage('Deploy (Production)') {
            when {
                branch 'main'
            }
            steps {
                bat 'docker-compose down || exit 0'
                bat 'docker-compose up -d --force-recreate'
            }
        }
        stage('Deploy (Dev)') {
            when {
                branch 'dev'
            }
            steps {
                bat 'docker-compose down || exit 0'
                bat 'docker-compose up -d --force-recreate'
            }
        }
    }
    post {
        always {
            cleanWs()
        }
    }
}