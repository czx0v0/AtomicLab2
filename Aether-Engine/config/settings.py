import os
from dotenv import load_dotenv

# Try loading from standard paths
load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))

class Settings:
    APP_NAME: str = "Aether Engine"
    APP_VERSION: str = "0.1.0"
    APP_ENV: str = os.getenv("APP_ENV", "production")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")
    UVICORN_HOST: str = os.getenv("UVICORN_HOST", "0.0.0.0")
    UVICORN_PORT: int = int(os.getenv("UVICORN_PORT", "8000"))


settings = Settings()
