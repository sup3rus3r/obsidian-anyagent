FROM python:3.12-slim

WORKDIR /app

# Install uv for fast dependency management
RUN pip install uv

COPY pyproject.toml .
RUN uv pip install --system --no-cache -r pyproject.toml 2>/dev/null || \
    uv pip install --system --no-cache \
    "fastapi[standard]>=0.128.0" \
    "motor>=3.7.1" \
    "bcrypt>=4.0.0" \
    "pydantic>=2.0.0" \
    "pycryptodome>=3.20.0" \
    "python-dotenv>=1.0.0" \
    "python-jose[cryptography]>=3.3.0" \
    "slowapi>=0.1.9" \
    "pymongo>=4.9.0"

COPY . .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
