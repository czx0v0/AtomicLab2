import os


class Settings:
    APP_NAME: str = "Aether Engine"
    APP_VERSION: str = "0.1.0"
    APP_ENV: str = os.getenv("APP_ENV", "production")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")
    UVICORN_HOST: str = os.getenv("UVICORN_HOST", "0.0.0.0")
    UVICORN_PORT: int = int(os.getenv("UVICORN_PORT", "8000"))


settings = Settings()
