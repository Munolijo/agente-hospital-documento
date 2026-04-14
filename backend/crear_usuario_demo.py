from sqlmodel import Session, select
from db import engine, User
from security import get_password_hash  # ajusta el import si tu archivo se llama distinto

def crear_usuario_demo():
    username = "demo_web_1"
    password_plano = "ClaveWeb123"
    hospital_id = "HOSP_1"
    role = "sanitario"

    hashed = get_password_hash(password_plano)

    with Session(engine) as session:
        # ¿ya existe?
        existing = session.exec(select(User).where(User.username == username)).first()
        if existing:
            print("Usuario demo ya existe:", existing.username)
            return

        user = User(
            username=username,
            hospital_id=hospital_id,
            role=role,
            activo=True,
            hashed_password=hashed,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        print("Usuario demo creado con id:", user.id)

if __name__ == "__main__":
    crear_usuario_demo()

    