/**
 * Jenkins deployment pipeline for Carmelton Data Migration Tool
 * 
 * This pipeline handles the build, deployment, and service management
 * for both server and client components. It includes explicit PM2 service
 * restart after deployment to ensure changes take effect properly.
 * The deployment process ensures clean installation by removing old files
 * before copying new ones, maintaining directory structure integrity.
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
                
                // Create empty directory FIRST before using it
                bat '''
                    if exist empty_dir rd /s /q empty_dir
                    mkdir empty_dir
                    echo Created empty directory for cleaning operations
                '''
                
                // ניקוי תיקיות היעד לפני העתקה, תוך שמירה על תיקיות הורים
                // Handling robocopy exit codes (0-7 are success states)
                bat '''
                    echo Cleaning target directories before deployment...
                    
                    if exist C:\\production\\carmelton-data-migration\\dist (
                        echo Cleaning dist directory...
                        robocopy /MIR /NP /NFL /NDL /NJH /NJS empty_dir C:\\production\\carmelton-data-migration\\dist
                        if %ERRORLEVEL% GEQ 8 (
                            echo "Robocopy failed with error code %ERRORLEVEL%"
                            exit /b 1
                        ) else (
                            echo "Robocopy completed successfully with code %ERRORLEVEL%"
                        )
                    ) else (
                        mkdir C:\\production\\carmelton-data-migration\\dist
                    )
                    
                    if exist C:\\production\\carmelton-data-migration\\client\\build (
                        echo Cleaning client build directory...
                        robocopy /MIR /NP /NFL /NDL /NJH /NJS empty_dir C:\\production\\carmelton-data-migration\\client\\build
                        if %ERRORLEVEL% GEQ 8 (
                            echo "Robocopy failed with error code %ERRORLEVEL%"
                            exit /b 1
                        ) else (
                            echo "Robocopy completed successfully with code %ERRORLEVEL%"
                        )
                    ) else (
                        if not exist C:\\production\\carmelton-data-migration\\client mkdir C:\\production\\carmelton-data-migration\\client
                        mkdir C:\\production\\carmelton-data-migration\\client\\build
                    )
                '''
                
                // העתקת קבצי השרת עם robocopy לשמירה על תיקיות זהות
                bat '''
                    if exist dist (
                        echo Deploying server files...
                        robocopy dist C:\\production\\carmelton-data-migration\\dist /MIR /NP /NFL /NDL /NJH /NJS
                        if %ERRORLEVEL% GEQ 8 (
                            echo "Robocopy failed with error code %ERRORLEVEL%"
                            exit /b 1
                        ) else (
                            echo "Robocopy completed successfully with code %ERRORLEVEL%"
                        )
                    ) else (
                        echo "Warning: dist directory does not exist"
                        exit /b 1
                    )
                '''
                
                bat 'if exist package.json copy package.json C:\\production\\carmelton-data-migration\\package.json'
                bat 'if exist package-lock.json copy package-lock.json C:\\production\\carmelton-data-migration\\package-lock.json'
                bat 'if exist ecosystem.config.js copy ecosystem.config.js C:\\production\\carmelton-data-migration\\ecosystem.config.js'
                bat 'if exist C:\\carmelton_typescript\\.env.production copy C:\\carmelton_typescript\\.env.production C:\\production\\carmelton-data-migration\\.env.production'
                
                // יצירת קובץ עם רשימת קבצים להחרגה לפני העתקה
                bat 'echo favicon.ico > exclude_list.txt'
                
                // העתקת קבצי הקליינט עם robocopy לשמירה על תיקיות זהות והחרגת favicon.ico
                bat '''
                    if exist client\\build (
                        echo Deploying client files...
                        robocopy client\\build C:\\production\\carmelton-data-migration\\client\\build /MIR /XF favicon.ico /NP /NFL /NDL /NJH /NJS
                        if %ERRORLEVEL% GEQ 8 (
                            echo "Robocopy failed with error code %ERRORLEVEL%"
                            exit /b 1
                        ) else (
                            echo "Robocopy completed successfully with code %ERRORLEVEL%"
                        )
                    ) else (
                        echo "Warning: client\\build directory does not exist"
                        exit /b 1
                    )
                '''
                
                bat 'if exist client\\package.json copy client\\package.json C:\\production\\carmelton-data-migration\\client\\package.json'
                bat 'if exist client\\package-lock.json copy client\\package-lock.json C:\\production\\carmelton-data-migration\\client\\package-lock.json'
                bat 'if exist client\\.env.production copy client\\.env.production C:\\production\\carmelton-data-migration\\client\\.env.production'
                
                // ניקוי קובץ ההחרגות ותיקיית העזר
                bat '''
                    if exist exclude_list.txt del exclude_list.txt
                    if exist empty_dir rd /s /q empty_dir
                '''
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
            // ניקוי נוסף במקרה שהתהליך נכשל בשלב כלשהו
            bat '''
                if exist exclude_list.txt del exclude_list.txt
                if exist empty_dir rd /s /q empty_dir
            '''
        }
    }
}