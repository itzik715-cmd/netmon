FROM python:3.11-slim

WORKDIR /app

# Install system packages needed at build time.
# Note: ldap3 and pysnmp are pure-Python so libldap2-dev / libsnmp-dev are NOT needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        libpq-dev \
        curl \
        netcat-traditional \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install Python dependencies.
# --prefer-binary  → use pre-built wheels instead of compiling from source.
# --no-cache-dir   → keep image small.
COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --no-cache-dir --prefer-binary -r requirements.txt

# Copy application
COPY . .

# Create non-root user with docker socket access
# The docker group GID on the host is passed via build arg (default 988)
ARG DOCKER_GID=988
RUN groupadd -g $DOCKER_GID dockerhost || true \
 && useradd -m -u 1000 netmon \
 && usermod -aG dockerhost netmon \
 && chown -R netmon:netmon /app && chmod +x /app/entrypoint.sh
USER netmon

EXPOSE 8000

# entrypoint.sh auto-detects CPU count and starts that many uvicorn workers.
# Each worker binds the UDP flow-collector ports with SO_REUSEPORT so the
# kernel distributes NetFlow/sFlow datagrams across all workers.
# Override the worker count with WEB_CONCURRENCY env var if needed.
CMD ["/app/entrypoint.sh"]
