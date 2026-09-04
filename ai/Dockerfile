# syntax=docker/dockerfile:1

# The scoring service. Python 3.9 is what the project was developed against,
# and the pinned scikit-learn and pandas versions require nothing newer.
FROM python:3.9-slim AS base
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

FROM base AS deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS runtime
COPY --from=deps /usr/local/lib/python3.9/site-packages /usr/local/lib/python3.9/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

COPY features.py train.py ./
COPY app ./app

# The trained model is copied in rather than trained here. Training needs the
# labelled dataset, which needs a populated database — a build step has no
# business reaching for one. Ship a model that was trained and *evaluated*
# deliberately, with metrics you can quote, instead of whatever a build server
# happened to produce.
#
# If model.joblib is absent the service still starts: /health reports
# "degraded" and /score returns 503, which the API already treats as "no risk
# score available" rather than an error.
COPY model.joblib* ./

RUN useradd --create-home --shell /usr/sbin/nologin scorer && chown -R scorer /app
USER scorer

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
