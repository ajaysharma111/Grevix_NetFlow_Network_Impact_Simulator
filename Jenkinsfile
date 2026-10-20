

pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'ajaysharma111/netflow'
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
                    test -f benchmark.html
                    test -f benchmark.js
                    test -f Dockerfile
                    test -f k8s/deployment.yaml
                    test -f k8s/service.yaml
                    echo "All project files verified"
                '''
            }
        }

        stage('Docker Build and Push') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub-creds',
                        usernameVariable: 'DOCKERHUB_USER',
                        passwordVariable: 'DOCKERHUB_TOKEN'
                    )
                ]) {
                    sh '''
                        set -eu
                        set +x

                        echo "$DOCKERHUB_TOKEN" | docker login \
                            --username "$DOCKERHUB_USER" \
                            --password-stdin

                        docker buildx build \
                            --builder netflow-jenkins \
                            --platform linux/amd64,linux/arm64 \
                            -t ${DOCKER_IMAGE}:${BUILD_NUMBER} \
                            -t ${DOCKER_IMAGE}:latest \
                            --push .

                        docker logout || true
                    '''
                }
            }
        }

        stage('Verify Docker Image') {
            steps {
                sh '''
                    docker buildx imagetools inspect ${DOCKER_IMAGE}:latest
                '''
            }
        }
    }

    post {
        success {
            echo 'NetFlow CI/CD pipeline completed successfully!'
        }
        failure {
            echo 'Pipeline failed. Check Console Output.'
        }
    }
}
