#!/bin/bash
# Build the PPDS worker Docker image
#
# Usage: ./build.sh [--no-cache]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="ppds-worker"
IMAGE_TAG="latest"

echo "Building ${IMAGE_NAME}:${IMAGE_TAG}..."

# Build arguments
BUILD_ARGS=""
if [[ "$1" == "--no-cache" ]]; then
    BUILD_ARGS="--no-cache"
    echo "Building without cache..."
fi

# Build the image
docker build $BUILD_ARGS \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    -f "${SCRIPT_DIR}/Dockerfile.worker" \
    "${SCRIPT_DIR}"

echo ""
echo "Build complete!"
echo ""
echo "To test the image:"
echo "  docker run --rm -it ${IMAGE_NAME}:${IMAGE_TAG} claude --version"
echo "  docker run --rm -it ${IMAGE_NAME}:${IMAGE_TAG} dotnet --version"
echo "  docker run --rm -it ${IMAGE_NAME}:${IMAGE_TAG} node --version"
echo "  docker run --rm -it ${IMAGE_NAME}:${IMAGE_TAG} gh --version"
