pipeline {
    agent any

    stages {
        stage('Source Code') {
            steps {
                checkout scm
                echo 'NetFlow source code checked out successfully'
            }
        }

        stage('Build and Test') {
            steps {
                sh '''
                    test -f index.html
                    test -f app.js
                    test -f style.css
                    echo "NetFlow project files verified"
                '''
            }
        }
    }
}
