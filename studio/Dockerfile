FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends zip \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 && useradd --uid 10001 --create-home estudio

WORKDIR /estudio
COPY app ./app
COPY static ./static

USER estudio
EXPOSE 8080
CMD ["python", "-m", "app.server"]
