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

# Create non-root user
RUN useradd -m -u 1000 netmon && chown -R netmon:netmon /app
USER netmon

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
