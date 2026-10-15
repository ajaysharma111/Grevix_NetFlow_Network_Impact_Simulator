```groovy
pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'ajaysharma111/netflow'
        DOCKER_CREDENTIALS = 'dockerhub-creds'
    }

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
                    test -f Dockerfile
                    test -f k8s/deployment.yaml
                    test -f k8s/service.yaml
                    echo "NetFlow project files verified"
                '''
            }
        }

        stage('Build Multi-Platform Docker Image') {
            steps {
                sh '''
                    docker buildx build \
                      --platform linux/amd64,linux/arm64 \
                      -t ${DOCKER_IMAGE}:${BUILD_NUMBER} \
                      -t ${DOCKER_IMAGE}:latest \
                      --push .
                '''
            }
        }

        stage('Verify Docker Hub Image') {
            steps {
                sh '''
                    docker buildx imagetools inspect ${DOCKER_IMAGE}:latest
                    echo "Multi-platform image verification completed"
                '''
            }
        }
    }

    post {
        success {
            echo 'NetFlow multi-platform image built and pushed successfully!'
        }
        failure {
            echo 'NetFlow pipeline failed. Check the build console output.'
        }
    }
}
```
