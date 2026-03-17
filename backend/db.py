# db.py
import os
from typing import Optional, Generator

from sqlmodel import SQLModel, Field, create_engine, Session

# En local, si no hay DATABASE_URL, usamos SQLite.
sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

DATABASE_URL = os.getenv("DATABASE_URL", sqlite_url)

# Para SQLite necesitamos connect_args; para Postgres no.
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    connect_args = {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    hospital_id: str = Field(index=True)
    role: str
    activo: bool = Field(default=True)
    hashed_password: str


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session