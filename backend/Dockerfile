# BASE_IMAGE is overridden by docker-compose.nvidia.yml for CUDA builds.
# Default is plain python:3.10-slim which works on any architecture.
ARG BASE_IMAGE=python:3.10-slim
FROM ${BASE_IMAGE}

# ARGs declared before FROM only exist for the FROM line itself.
# Re-declare here so it's available to RUN commands.
ARG REQUIREMENTS=requirements.txt

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# System dependencies
# python3-pip / python3.10 are already present in the python:3.10-slim base;
# the nvidia/cuda base needs them explicitly — so we install defensively.
RUN apt-get update && apt-get install -y \
    python3-pip \
    ffmpeg \
    git \
    wget \
    curl \
    fonts-quicksand \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer cache)
COPY requirements.txt requirements-cuda.txt ./
RUN pip install --no-cache-dir -r ${REQUIREMENTS}

# Copy application code
COPY . .

# Workspace is volume-mounted at runtime; pre-create so it exists in the image too
RUN mkdir -p /app/workspace

EXPOSE 8000

CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
