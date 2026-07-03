#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage:
  IMAGE_NAME=littlesheepuwu/new-api ./scripts/docker-build-push.sh [tag]
  ./scripts/docker-build-push.sh littlesheepuwu/new-api [tag]

Environment:
  IMAGE_NAME     Docker image name to push, for example littlesheepuwu/new-api
  DOCKER_TAG     Image tag to publish, defaults to latest
  PLATFORMS      Buildx platforms, defaults to linux/amd64,linux/arm64
  BUILDER        Buildx builder name, defaults to new-api-builder
  NO_LATEST      Set to 1 to skip adding a latest tag when publishing a version tag
EOF
}

IMAGE_NAME="${1:-${IMAGE_NAME:-}}"
DOCKER_TAG="${2:-${DOCKER_TAG:-latest}}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-new-api-builder}"

if [[ -z "${IMAGE_NAME}" ]]; then
	usage
	exit 1
fi

if [[ ! -f VERSION ]]; then
	echo "VERSION file not found in repository root"
	exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
	echo "docker buildx is required"
	exit 1
fi

if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
	docker buildx create --driver docker-container --name "${BUILDER}" --use >/dev/null
else
	docker buildx use "${BUILDER}" >/dev/null
fi

tags=(-t "${IMAGE_NAME}:${DOCKER_TAG}")
if [[ "${NO_LATEST:-0}" != "1" && "${DOCKER_TAG}" != "latest" ]]; then
	tags+=(-t "${IMAGE_NAME}:latest")
fi

echo "Building ${IMAGE_NAME}:${DOCKER_TAG} for ${PLATFORMS}"
if [[ "${#tags[@]}" -gt 2 ]]; then
	echo "Also tagging ${IMAGE_NAME}:latest"
fi

docker buildx build \
	--platform "${PLATFORMS}" \
	"${tags[@]}" \
	--push \
	.
