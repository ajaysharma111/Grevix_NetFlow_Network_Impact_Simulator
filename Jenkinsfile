
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

        stage('Build Docker Image') {
            steps {
                sh '''
                    docker build -t ${DOCKER_IMAGE}:${BUILD_NUMBER} .
                    docker tag ${DOCKER_IMAGE}:${BUILD_NUMBER} ${DOCKER_IMAGE}:latest
                '''
            }
        }

        stage('Push to Docker Hub') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKER_CREDENTIALS}",
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASS'
                    )
                ]) {
                    sh '''
                        echo "$DOCKER_PASS" | docker login \
                          -u "$DOCKER_USER" --password-stdin
                        docker push ${DOCKER_IMAGE}:${BUILD_NUMBER}
                        docker push ${DOCKER_IMAGE}:latest
                        docker logout
                    '''
                }
            }
        }

        stage('Deploy to Minikube') {
            steps {
                sh '''
                    kubectl apply -f k8s/deployment.yaml
                    kubectl apply -f k8s/service.yaml

                    kubectl set image deployment/netflow \
                      netflow=${DOCKER_IMAGE}:${BUILD_NUMBER}

                    kubectl rollout status deployment/netflow \
                      --timeout=180s
                '''
            }
        }

        stage('Verify Deployment') {
            steps {
                sh '''
                    kubectl get deployments
                    kubectl get pods
                    kubectl get services
                    echo "NetFlow deployment verification completed"
                '''
            }
        }
    }
}
