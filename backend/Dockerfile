# GPlanSiS|DOCS — API e worker (mesma imagem, comandos diferentes)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# Tesseract (por+eng+osd), dependências do OCRmyPDF (ghostscript, qpdf, unpaper, pngquant) e OpenCV headless
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-por tesseract-ocr-eng tesseract-ocr-osd \
      ghostscript qpdf unpaper pngquant poppler-utils libglib2.0-0 fonts-dejavu-core curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements/ requirements/
# extras: ocr sempre; paddle / embeddings / llm por build-arg (paddle deixa a imagem bem maior)
ARG EXTRAS="ocr llm"
RUN pip install --upgrade pip && pip install -r requirements/base.txt \
    && for e in $(echo "$EXTRAS" | tr ',' ' '); do pip install -r "requirements/$e.txt"; done
COPY . .
RUN useradd -r -u 10001 edms && mkdir -p /data/blobs && chown -R edms /app /data
USER edms

EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=5s --retries=5 CMD curl -fs http://localhost:8000/api/health || exit 1
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${API_WORKERS:-2} --proxy-headers"]
