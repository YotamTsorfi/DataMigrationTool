/**
 * Jenkins deployment pipeline for Carmelton Data Migration Tool
 * 
 * This pipeline handles the build, deployment, and service management
 * for both server and client components. It includes explicit PM2 service
 * restart after deployment to ensure changes take effect properly.
 */

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
                // התקנת תלויות ובניית שרת
                bat 'npm install'
                bat 'npm run build'
                // התקנת תלויות ובניית קליינט
                bat 'cd client && npm install && npm run build'
            }
        }
        stage('Copy env files') {
            steps {
                // העתקת קבצי env מהשרת ל-workspace
                bat 'copy C:\\carmelton_typescript\\.env.production dist\\.env.production'
                bat 'copy C:\\carmelton_typescript\\client\\.env.production client\\.env.production'
            }
        }
        stage('Stop Production Service') {
            steps {
                // עצירת שירות PM2 עם טיפול בשגיאות
                bat(script: 'cd C:\\production\\carmelton-data-migration && npx pm2 stop all || echo "No processes running"', returnStatus: true)
            }
        }
        stage('Verify Files') {
            steps {
                bat 'dir'
                bat 'dir dist || echo "dist directory missing"'
                bat 'dir client\\build || echo "client\\build directory missing"'
            }
        }
        stage('Deploy') {
            steps {
                // יצירת תיקיית היעד אם היא לא קיימת
                bat 'if not exist C:\\production\\carmelton-data-migration mkdir C:\\production\\carmelton-data-migration'
                bat 'if not exist C:\\production\\carmelton-data-migration\\dist mkdir C:\\production\\carmelton-data-migration\\dist'
                bat 'if not exist C:\\production\\carmelton-data-migration\\client mkdir C:\\production\\carmelton-data-migration\\client'
                bat 'if not exist C:\\production\\carmelton-data-migration\\client\\build mkdir C:\\production\\carmelton-data-migration\\client\\build'
                
                // העתקת קבצי השרת
                bat '''
                    if exist dist (
                        xcopy /Y /E /I dist C:\\production\\carmelton-data-migration\\dist
                    ) else (
                        echo "Warning: dist directory does not exist"
                        exit 1
                    )
                '''
                
                bat 'if exist package.json copy package.json C:\\production\\carmelton-data-migration\\package.json'
                bat 'if exist package-lock.json copy package-lock.json C:\\production\\carmelton-data-migration\\package-lock.json'
                bat 'if exist ecosystem.config.js copy ecosystem.config.js C:\\production\\carmelton-data-migration\\ecosystem.config.js'
                bat 'if exist C:\\carmelton_typescript\\.env.production copy C:\\carmelton_typescript\\.env.production C:\\production\\carmelton-data-migration\\.env.production'
                
                // יצירת קובץ עם רשימת קבצים להחרגה לפני העתקה
                bat 'echo favicon.ico > exclude_list.txt'
                
                // העתקת קבצי הקליינט - החרגת favicon.ico
                bat '''
                    if exist client\\build (
                        xcopy /Y /E /I client\\build C:\\production\\carmelton-data-migration\\client\\build /EXCLUDE:exclude_list.txt
                    ) else (
                        echo "Warning: client\\build directory does not exist"
                        exit 1
                    )
                '''
                
                bat 'if exist client\\package.json copy client\\package.json C:\\production\\carmelton-data-migration\\client\\package.json'
                bat 'if exist client\\package-lock.json copy client\\package-lock.json C:\\production\\carmelton-data-migration\\client\\package-lock.json'
                bat 'if exist client\\.env.production copy client\\.env.production C:\\production\\carmelton-data-migration\\client\\.env.production'
                
                // ניקוי קובץ ההחרגות
                bat 'del exclude_list.txt'
            }
        }
        stage('Install Dependencies in Production') {
            steps {
                // התקנת תלויות בסביבת הייצור
                bat '''
                    cd C:\\production\\carmelton-data-migration
                    npm install --production
                '''
            }
        }
        stage('Start Production Service') {
            steps {
                // הפעלה של השירות
                bat(script: 'cd C:\\production\\carmelton-data-migration && npx pm2 start ecosystem.config.js || echo "Failed to start services"', returnStatus: true)
            }
        }
        stage('Restart PM2 Service') {
            steps {
                // וידוא שהשירות מופעל מחדש לאחר הפריסה
                bat '''
                    cd C:\\production\\carmelton-data-migration
                    npx pm2 restart all || echo "Failed to restart services"
                '''
            }
        }
    }
    post {
        success {
            echo 'Deployment completed successfully'
            // וידוא נוסף שהשירות מופעל כראוי בסיום מוצלח
            bat '''
                cd C:\\production\\carmelton-data-migration
                npx pm2 list
            '''
        }
        failure {
            // במקרה של כישלון, ננסה להפעיל את השירות בכל זאת
            bat(script: 'cd C:\\production\\carmelton-data-migration && npx pm2 start ecosystem.config.js || echo "Failed to restart services"', returnStatus: true)
            echo 'Deployment failed, attempted to restart services'
        }
        always {
            // ניקוי קובץ ההחרגות אם עדיין קיים
            bat 'if exist exclude_list.txt del exclude_list.txt'
        }
    }
}