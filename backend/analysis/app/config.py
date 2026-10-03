from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "postgresql://switch:switch_dev_password@localhost:5433/switch_dev"
    OPENROUTER_API_KEY: Optional[str] = None
    PORT: int = 8000
    HOST: str = "0.0.0.0"

settings = Settings()
