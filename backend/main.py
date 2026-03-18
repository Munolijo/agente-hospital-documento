from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Optional
import uuid
from pypdf import PdfReader
from docx import Document
from io import BytesIO
import os
from openai import OpenAI
from datetime import datetime, timedelta, timezone
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext

from PIL import Image
import pytesseract

from sqlmodel import Session, select
import httpx  # <- NUEVO

# IMPORTS LOCALES como módulo
from db import User as UserDB, create_db_and_tables, get_session

from agente import (
    detectar_idioma_paciente,
    traducir_paciente_a_espanol,
    iniciar_conversacion,  # si no lo usas, puedes quitarlo
    traducir_sanitario_a_paciente,
)

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# ----------------------------------------------------------------------
# CONFIGURACIÓN AUTH / JWT
# ----------------------------------------------------------------------

SECRET_KEY = "CAMBIA_ESTA_CLAVE_POR_UNA_LARGA_Y_SECRETA"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")

# ----------------------------------------------------------------------
# CONFIGURACIÓN FASTAPI
# ----------------------------------------------------------------------

app = FastAPI(
    title="Agente de Traducción Hospitalaria",
    description="API para traducción paciente↔sanitario usando Perplexity",
    version="0.1.0",
)

# Orígenes permitidos (añade aquí también tu frontend en Render si lo tienes)
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    # Crear tablas si no existen (incluye User)
    create_db_and_tables()

# ----------------------------------------------------------------------
# MEMORIA DE CONVERSACIONES
# ----------------------------------------------------------------------

conversaciones: Dict[str, str] = {}  # id_conversacion -> idioma_paciente

# ----------------------------------------------------------------------
# MODELOS Pydantic (esquemas de API)
# ----------------------------------------------------------------------

class MensajeTexto(BaseModel):
    texto_original: str


class RespuestaMensaje(BaseModel):
    id_conversacion: str
    rol: str
    idioma_paciente: str
    texto_original: str
    texto_traducido: str


class FinalizarRespuesta(BaseModel):
    id_conversacion: str
    estado: str


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: str | None = None
    hospital_id: str | None = None
    role: str | None = None


class User(BaseModel):
    id: int
    username: str
    hospital_id: str
    role: str
    activo: bool


class UserCreate(BaseModel):
    username: str
    password: str
    hospital_id: str
    role: str


class UserRead(BaseModel):
    id: int
    username: str
    hospital_id: str
    role: str
    activo: bool

# ----------------------------------------------------------------------
# UTILIDADES AUTH / USERS (BD)
# ----------------------------------------------------------------------

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def get_user_by_username(session: Session, username: str) -> Optional[UserDB]:
    statement = select(UserDB).where(UserDB.username == username)
    return session.exec(statement).first()


def authenticate_user(
    session: Session, username: str, password: str
) -> Optional[UserDB]:
    user = get_user_by_username(session, username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    if not user.activo:
        return None
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> UserDB:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se han podido validar las credenciales.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        hospital_id: str | None = payload.get("hospital_id")
        role: str | None = payload.get("role")
        if username is None or hospital_id is None:
            raise credentials_exception
        token_data = TokenData(
            username=username,
            hospital_id=hospital_id,
            role=role,
        )
    except JWTError:
        raise credentials_exception

    user = get_user_by_username(session, username=token_data.username)  # type: ignore[arg-type]
    if user is None:
        raise credentials_exception
    if not user.activo:
        raise HTTPException(status_code=400, detail="Usuario inactivo.")
    return user

# ----------------------------------------------------------------------
# ENDPOINTS AUTH
# ----------------------------------------------------------------------

@app.post("/auth/login", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    # LOG PARA DEPURAR LO QUE LLEGA DEL FRONT
    print("LOGIN DEBUG -> username recibido:", repr(form_data.username))
    print("LOGIN DEBUG -> password recibido:", repr(form_data.password))

    user = authenticate_user(session, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.username,
            "hospital_id": user.hospital_id,
            "role": user.role,
        },
        expires_delta=access_token_expires,
    )
    return Token(access_token=access_token, token_type="bearer")


@app.get("/auth/me", response_model=UserRead)
async def read_users_me(current_user: UserDB = Depends(get_current_user)):
    return UserRead(
        id=current_user.id,
        username=current_user.username,
        hospital_id=current_user.hospital_id,
        role=current_user.role,
        activo=current_user.activo,
    )

# ----------------------------------------------------------------------
# ENDPOINTS GESTIÓN DE USUARIOS (altas/bajas)
# ----------------------------------------------------------------------

@app.post("/users", response_model=UserRead)
def create_user(
    user_in: UserCreate,
    session: Session = Depends(get_session),
    current_user: UserDB = Depends(get_current_user),
):
    existing = get_user_by_username(session, user_in.username)
    if existing:
        raise HTTPException(
            status_code=400, detail="Ya existe un usuario con ese username."
        )

    hashed = get_password_hash(user_in.password)
    user_db = UserDB(
        username=user_in.username,
        hospital_id=user_in.hospital_id,
        role=user_in.role,
        activo=True,
        hashed_password=hashed,
    )
    session.add(user_db)
    session.commit()
    session.refresh(user_db)

    return UserRead(
        id=user_db.id,
        username=user_db.username,
        hospital_id=user_db.hospital_id,
        role=user_db.role,
        activo=user_db.activo,
    )


@app.get("/users", response_model=list[UserRead])
def list_users(
    session: Session = Depends(get_session),
    current_user: UserDB = Depends(get_current_user),
):
    users = session.exec(select(UserDB)).all()
    return [
        UserRead(
            id=u.id,
            username=u.username,
            hospital_id=u.hospital_id,
            role=u.role,
            activo=u.activo,
        )
        for u in users
    ]


@app.patch("/users/{user_id}/activo", response_model=UserRead)
def set_user_active(
    user_id: int,
    activo: bool,
    session: Session = Depends(get_session),
    current_user: UserDB = Depends(get_current_user),
):
    user_db = session.get(UserDB, user_id)
    if not user_db:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user_db.activo = activo
    session.add(user_db)
    session.commit()
    session.refresh(user_db)
    return UserRead(
        id=user_db.id,
        username=user_db.username,
        hospital_id=user_db.hospital_id,
        role=user_db.role,
        activo=user_db.activo,
    )

# ----------------------------------------------------------------------
# RESOLVER PRINCIPIO ACTIVO DESDE NOMBRE COMERCIAL (CIMA AEMPS)
# ----------------------------------------------------------------------

CIMA_BASE_URL = "https://cima.aemps.es/cima/rest/medicamentos"


def resolver_principio_activo_desde_cima(nombre_comercial: str) -> Optional[str]:
    params = {"nombre": nombre_comercial}
    try:
        response = httpx.get(CIMA_BASE_URL, params=params, timeout=5.0)
    except httpx.RequestError:
        return None

    if response.status_code != 200:
        return None

    try:
        data = response.json()
    except ValueError:
        return None

    if not isinstance(data, list) or not data:
        return None

    med = data[0]
    pactivos = med.get("pactivos") or med.get("principiosActivos")
    if not pactivos:
        return None

    if isinstance(pactivos, list):
        nombres: list[str] = []
        for pa in pactivos:
            nombre_pa = (
                pa.get("nombre")
                or pa.get("nombrePA")
                or pa.get("principioActivo")
            )
            if nombre_pa:
                nombres.append(str(nombre_pa).strip())
        if not nombres:
            return None
        return ", ".join(sorted(set(nombres)))

    if isinstance(pactivos, str):
        return pactivos.strip() or None

    return None


def resolver_principio_activo(nombre_comercial: str) -> str:
    nombre_comercial = nombre_comercial.strip()
    if not nombre_comercial:
        return ""
    principio = resolver_principio_activo_desde_cima(nombre_comercial)
    if principio:
        return principio
    return nombre_comercial


class MedicamentoEntrada(BaseModel):
    nombre_comercial: str


class MedicamentoSalida(BaseModel):
    nombre_comercial: str
    principio_activo: str


@app.post("/api/medicamentos/resolver", response_model=MedicamentoSalida)
def resolver_medicamento(
    med: MedicamentoEntrada,
    current_user: UserDB = Depends(get_current_user),
):
    principio = resolver_principio_activo(med.nombre_comercial)
    return MedicamentoSalida(
        nombre_comercial=med.nombre_comercial.strip(),
        principio_activo=principio,
    )

# ----------------------------------------------------------------------
# ENDPOINTS DE CONVERSACIÓN TEXTO (protegidos con auth)
# ----------------------------------------------------------------------

@app.post("/api/conversaciones/paciente/texto", response_model=RespuestaMensaje)
def iniciar_conversacion_paciente_texto(
    msg: MensajeTexto,
    current_user: UserDB = Depends(get_current_user),
):
    texto = msg.texto_original.strip()
    if not texto:
        raise HTTPException(
            status_code=400, detail="El texto_original no puede estar vacío."
        )

    idioma_paciente = detectar_idioma_paciente(texto)
    traduccion_es = traducir_paciente_a_espanol(texto, idioma_paciente)

    id_conversacion = str(uuid.uuid4())
    conversaciones[id_conversacion] = idioma_paciente

    return RespuestaMensaje(
        id_conversacion=id_conversacion,
        rol="paciente",
        idioma_paciente=idioma_paciente,
        texto_original=texto,
        texto_traducido=traduccion_es,
    )


@app.post(
    "/api/conversaciones/{id_conversacion}/paciente/texto",
    response_model=RespuestaMensaje,
)
def turno_paciente_texto(
    id_conversacion: str,
    msg: MensajeTexto,
    current_user: UserDB = Depends(get_current_user),
):
    if id_conversacion not in conversaciones:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")

    texto = msg.texto_original.strip()
    if not texto:
        raise HTTPException(
            status_code=400, detail="El texto_original no puede estar vacío."
        )

    idioma_paciente = conversaciones[id_conversacion]
    traduccion_es = traducir_paciente_a_espanol(texto, idioma_paciente)

    return RespuestaMensaje(
        id_conversacion=id_conversacion,
        rol="paciente",
        idioma_paciente=idioma_paciente,
        texto_original=texto,
        texto_traducido=traduccion_es,
    )


@app.post(
    "/api/conversaciones/{id_conversacion}/sanitario/texto",
    response_model=RespuestaMensaje,
)
def turno_sanitario_texto(
    id_conversacion: str,
    msg: MensajeTexto,
    current_user: UserDB = Depends(get_current_user),
):
    if id_conversacion not in conversaciones:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")

    texto = msg.texto_original.strip()
    if not texto:
        raise HTTPException(
            status_code=400, detail="El texto_original no puede estar vacío."
        )

    idioma_paciente = conversaciones[id_conversacion]
    traduccion_paciente = traducir_sanitario_a_paciente(texto, idioma_paciente)

    return RespuestaMensaje(
        id_conversacion=id_conversacion,
        rol="sanitario",
        idioma_paciente=idioma_paciente,
        texto_original=texto,
        texto_traducido=traduccion_paciente,
    )


@app.post(
    "/api/conversaciones/{id_conversacion}/finalizar",
    response_model=FinalizarRespuesta,
)
def finalizar_conversacion(
    id_conversacion: str,
    current_user: UserDB = Depends(get_current_user),
):
    if id_conversacion in conversaciones:
        del conversaciones[id_conversacion]
        return FinalizarRespuesta(id_conversacion=id_conversacion, estado="cerrada")
    else:
        raise HTTPException(status_code=404, detail="Conversación no encontrada.")

# ----------------------------------------------------------------------
# CLIENTE PERPLEXITY (OpenAI-compatible) PARA DOCUMENTOS
# ----------------------------------------------------------------------

perplexity_client = OpenAI(
    api_key=os.environ["PERPLEXITY_API_KEY"],
    base_url="https://api.perplexity.ai",
)


def llamar_agente_documentos(prompt: str) -> str:
    response = perplexity_client.chat.completions.create(
        model="sonar-pro",
        messages=[
            {
                "role": "system",
                "content": "Eres un agente de traducción para un hospital.",
            },
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content

# ----------------------------------------------------------------------
# FUNCIÓN DE NEGOCIO: traducir_documento
# ----------------------------------------------------------------------

def traducir_documento(
    texto_documento: str, idioma_paciente_fijo: Optional[str], origen: str
) -> str:
    if origen not in ["paciente", "sanitario"]:
        raise ValueError("El parámetro 'origen' debe ser 'paciente' o 'sanitario'.")

    if origen == "paciente":
        prompt = f"""
Eres un agente de traducción de un hospital.
TU ÚNICA TAREA es traducir el texto, sin explicaciones adicionales, sin comentarios legales, sin valoraciones, sin resúmenes y sin añadir información nueva.

Traduce el siguiente DOCUMENTO entregado por el PACIENTE al ESPAÑOL.
Devuelve únicamente la traducción, sin ningún texto extra.

DOCUMENTO DEL PACIENTE:
{texto_documento}
"""
    else:
        if not idioma_paciente_fijo:
            raise ValueError(
                "Todavía no se ha detectado el idioma del paciente. Inicia la conversación con el paciente primero."
            )
        prompt = f"""
Eres un agente de traducción de un hospital.
TU ÚNICA TAREA es traducir el texto, sin explicaciones adicionales, sin comentarios legales, sin valoraciones, sin resúmenes y sin añadir información nueva.

El siguiente texto es un DOCUMENTO del HOSPITAL para el PACIENTE, escrito en ESPAÑOL.
Traduce TODO el contenido al idioma del paciente: {idioma_paciente_fijo}.
Devuelve únicamente la traducción, sin ningún texto extra.

DOCUMENTO DEL HOSPITAL:
{texto_documento}
"""

    return llamar_agente_documentos(prompt)

# ----------------------------------------------------------------------
# FUNCIÓN: extraer_texto_desde_archivo
# ----------------------------------------------------------------------

def extraer_texto_desde_archivo(contenido_bytes: bytes, content_type: str) -> str:
    if content_type == "text/plain":
        return contenido_bytes.decode("utf-8", errors="ignore")

    if content_type == "application/pdf":
        reader = PdfReader(BytesIO(contenido_bytes))
        paginas = []
        for page in reader.pages:
            texto_pagina = page.extract_text() or ""
            paginas.append(texto_pagina)
        return "\n\n".join(paginas)

    if (
        content_type
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ):
        doc = Document(BytesIO(contenido_bytes))
        parrafos = [p.text for p in doc.paragraphs]
        return "\n".join(parrafos)

    if content_type in ["image/jpeg", "image/png"]:
        image = Image.open(BytesIO(contenido_bytes))
        texto = pytesseract.image_to_string(image)
        return texto

    raise ValueError(
        f"Tipo de archivo no soportado para extracción de texto: {content_type}"
    )

# ----------------------------------------------------------------------
# ENDPOINT: /api/documentos/traducir
# ----------------------------------------------------------------------

@app.post("/api/documentos/traducir")
async def traducir_documento_endpoint(
    archivo: UploadFile = File(...),
    origen: str = "paciente",  # o "sanitario"
    id_conversacion: Optional[str] = None,
):
    print("CONTENT_TYPE RECIBIDO:", archivo.content_type)
    print("ID_CONVERSACION RECIBIDO:", id_conversacion)

    tipos_permitidos = {
        "text/plain",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/png",
    }
    if archivo.content_type not in tipos_permitidos:
        raise HTTPException(
            status_code=415,
            detail=f"Tipo de archivo no soportado: {archivo.content_type}",
        )

    contenido_bytes = await archivo.read()

    try:
        texto_documento = extraer_texto_desde_archivo(
            contenido_bytes, archivo.content_type
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"No se ha podido extraer texto del archivo: {e}",
        )

    idioma_paciente_fijo: Optional[str] = None

    if origen == "sanitario":
        if not id_conversacion:
            raise HTTPException(
                status_code=400,
                detail="Para origen='sanitario' es obligatorio indicar id_conversacion.",
            )
        if id_conversacion not in conversaciones:
            raise HTTPException(
                status_code=404,
                detail="Conversación no encontrada para el id_conversacion proporcionado.",
            )
        idioma_paciente_fijo = conversaciones[id_conversacion]

    try:
        texto_traducido = traducir_documento(
            texto_documento, idioma_paciente_fijo, origen
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error traduciendo documento: {e}",
        )

    return {
        "nombre_original": archivo.filename,
        "content_type": archivo.content_type,
        "origen": origen,
        "id_conversacion": id_conversacion,
        "idioma_paciente": idioma_paciente_fijo,
        "texto_origen": texto_documento,
        "texto_traducido": texto_traducido,
    }

# ----------------------------------------------------------------------
# ENDPOINT AUDIO: /api/audio/transcribir (Whisper)
# ----------------------------------------------------------------------

@app.post("/api/audio/transcribir", response_model=RespuestaMensaje)
async def transcribir_audio(
    archivo_audio: UploadFile = File(...),
    rol: str = "paciente",
    id_conversacion: Optional[str] = None,
    current_user: UserDB = Depends(get_current_user),
):
    """
    Recibe audio, lo transcribe con Whisper (OpenAI) y reutiliza la lógica de conversación.
    """
    if rol not in ["paciente", "sanitario"]:
        raise HTTPException(status_code=400, detail="Rol inválido.")

    # Leemos el contenido del archivo en memoria
    audio_bytes = await archivo_audio.read()

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="El archivo de audio está vacío.")

    # Guardamos en un archivo temporal para pasarlo a la API de OpenAI
    # (la librería espera un archivo tipo file-like)
    import tempfile

    try:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        with open(tmp_path, "rb") as f:
            transcripcion = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="text",
            )

        texto_transcrito = transcripcion  # ya es un string en response_format="text"
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error transcribiendo audio: {e}",
        )
    finally:
        try:
            if "tmp_path" in locals() and os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass

    texto_transcrito = (texto_transcrito or "").strip()
    if not texto_transcrito:
        raise HTTPException(
            status_code=500,
            detail="No se ha obtenido texto de la transcripción.",
        )

    # A partir de aquí, reutilizamos la lógica de texto
    if rol == "paciente":
        if not id_conversacion:
            idioma_paciente = detectar_idioma_paciente(texto_transcrito)
            traduccion_es = traducir_paciente_a_espanol(texto_transcrito, idioma_paciente)
            id_conv = str(uuid.uuid4())
            conversaciones[id_conv] = idioma_paciente

            return RespuestaMensaje(
                id_conversacion=id_conv,
                rol="paciente",
                idioma_paciente=idioma_paciente,
                texto_original=texto_transcrito,
                texto_traducido=traduccion_es,
            )
        else:
            if id_conversacion not in conversaciones:
                raise HTTPException(status_code=404, detail="Conversación no encontrada.")
            idioma_paciente = conversaciones[id_conversacion]
            traduccion_es = traducir_paciente_a_espanol(texto_transcrito, idioma_paciente)
            return RespuestaMensaje(
                id_conversacion=id_conversacion,
                rol="paciente",
                idioma_paciente=idioma_paciente,
                texto_original=texto_transcrito,
                texto_traducido=traduccion_es,
            )

    # rol == sanitario
    if not id_conversacion or id_conversacion not in conversaciones:
        raise HTTPException(
            status_code=400,
            detail="Para rol='sanitario' es obligatorio indicar una conversación válida.",
        )
    idioma_paciente = conversaciones[id_conversacion]
    traduccion_paciente = traducir_sanitario_a_paciente(texto_transcrito, idioma_paciente)
    return RespuestaMensaje(
        id_conversacion=id_conversacion,
        rol="sanitario",
        idioma_paciente=idioma_paciente,
        texto_original=texto_transcrito,
        texto_traducido=traduccion_paciente,
    )

# ----------------------------------------------------------------------
# ENDPOINT TEMPORAL: crear primer usuario sin auth (SOLO DESARROLLO)
# ----------------------------------------------------------------------

@app.post("/dev/create-initial-user", response_model=UserRead)
def create_initial_user_dev(
    user_in: UserCreate,
    session: Session = Depends(get_session),
):
    existing = get_user_by_username(session, user_in.username)
    if existing:
        raise HTTPException(
            status_code=400, detail="Ya existe un usuario con ese username."
        )

    hashed = get_password_hash(user_in.password)
    user_db = UserDB(
        username=user_in.username,
        hospital_id=user_in.hospital_id,
        role=user_in.role,
        activo=True,
        hashed_password=hashed,
    )
    session.add(user_db)
    session.commit()
    session.refresh(user_db)

    return UserRead(
        id=user_db.id,
        username=user_db.username,
        hospital_id=user_db.hospital_id,
        role=user_db.role,
        activo=user_db.activo,
    )