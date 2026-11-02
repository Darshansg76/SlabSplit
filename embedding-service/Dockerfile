FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
# The local embedding model runs on CPU; avoid downloading CUDA dependencies.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
