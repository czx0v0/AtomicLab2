# Stage 1: Build Lumina-UI assets
FROM node:20-alpine AS lumina_builder

WORKDIR /build/Lumina-UI
COPY Lumina-UI/package.json ./
RUN npm install --no-audit --no-fund
COPY Lumina-UI/ ./
RUN npm run build

# Stage 2: Runtime image with FastAPI + Nginx + Supervisor
FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

COPY Aether-Engine/ /app/Aether-Engine/
RUN pip install --no-cache-dir -r /app/Aether-Engine/requirements.txt

COPY --from=lumina_builder /build/Lumina-UI/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
