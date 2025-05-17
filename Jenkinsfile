pipeline {
    agent any
    stages {
        stage('Checkout main') {
            steps {
                git branch: 'main', credentialsId: 'ssh-github-key', url: 'git@github.com:YotamTsorfi/DataMigrationTool.git'
            }
        }
        stage('Install & Build') {
            steps {
                bat 'npm install'
                bat 'npm run build'
                bat 'cd client && npm install && npm run build'
            }
        }
        stage('Copy env file') {
            steps {
                // העתק את קובץ ההגדרות production בלבד
                bat 'copy C:\\carmelton_typescript\\.env.production dist\\.env.production'
            }
        }
        stage('Deploy') {
            steps {
                bat 'xcopy /Y /E /I dist C:\\production\\carmelton-data-migration\\dist'
                bat 'copy package.json C:\\production\\carmelton-data-migration\\package.json'
                bat 'copy package-lock.json C:\\production\\carmelton-data-migration\\package-lock.json'
                bat 'copy C:\\carmelton_typescript\\.env.production C:\\production\\carmelton-data-migration\\.env.production'
                bat 'xcopy /Y /E /I client\\build C:\\production\\carmelton-data-migration\\client\\build'
                bat 'copy client\\package.json C:\\production\\carmelton-data-migration\\client\\package.json'
                bat 'copy client\\package-lock.json C:\\production\\carmelton-data-migration\\client\\package-lock.json'
                bat 'copy client\\.env.production C:\\production\\carmelton-data-migration\\client\\.env.production'
            }
        }
    }
}