FROM python:3.12-slim

ARG CODEX_VERSION=0.155.1

RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm \
    && npm install -g @openai/codex@${CODEX_VERSION} \
    && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY bridge.py ./

RUN useradd --create-home --uid 10001 codex \
    && mkdir -p /home/codex/.codex /tmp/codex \
    && chown -R codex:codex /home/codex /tmp/codex

USER codex
ENV CODEX_HOME=/home/codex/.codex
EXPOSE 8090
CMD ["uvicorn", "bridge:app", "--host", "0.0.0.0", "--port", "8090"]
