import os
from uuid import uuid4
from openai import OpenAI

# Inicializar cliente usando la variable de entorno de Perplexity
API_KEY = os.environ["PERPLEXITY_API_KEY"]

client = OpenAI(
    api_key=API_KEY,
    base_url="https://api.perplexity.ai",
)


def llamar_agente(prompt: str) -> str:
    """
    Llama al modelo de Perplexity (OpenAI-compatible) y devuelve solo el texto.
    """
    respuesta = client.chat.completions.create(
        model="sonar-pro",
        messages=[
            {
                "role": "system",
                "content": "Eres un agente de traducción para un hospital.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
    )
    return respuesta.choices[0].message.content.strip()


def detectar_idioma_paciente(texto_paciente: str) -> str:
    """
    Devuelve el nombre del idioma en español (ej: 'inglés', 'francés', etc.).
    """
    prompt = (
        "El siguiente texto lo ha dicho un paciente.\n"
        "Tu tarea es solo detectar en qué idioma está escrito el texto.\n"
        "Responde únicamente con el nombre del idioma en español (ejemplos: "
        "\"inglés\", \"francés\", \"árabe\", \"ruso\", \"portugués\", \"chino\").\n"
        "No añadas explicaciones.\n\n"
        f"Texto del paciente:\n{texto_paciente}\n"
    )
    idioma = llamar_agente(prompt)
    return idioma.strip()


def traducir_paciente_a_espanol(texto_paciente: str, idioma_paciente: str) -> str:
    """
    Traduce el texto del paciente al español con enfoque clínico.
    Si el texto es incoherente o ininteligible, responde solo con '(no se entiende bien)'.
    """
    prompt = (
        "Eres un traductor profesional en un hospital.\n"
        "Tomas frases habladas por un paciente y las traduces al ESPAÑOL.\n"
        "Responde SIEMPRE solo con la traducción, sin explicaciones, "
        "sin comentarios, sin notas ni advertencias.\n"
        "Si el texto está mal dicho, es incoherente o no se entiende, "
        "responde únicamente con: '(no se entiende bien)'.\n\n"
        f"Texto del paciente ({idioma_paciente}):\n{texto_paciente}\n"
    )
    traduccion = llamar_agente(prompt)
    return traduccion.strip()


def traducir_sanitario_a_paciente(texto_sanitario: str, idioma_paciente: str) -> str:
    """
    Traduce del español al idioma del paciente.
    Si el texto es incoherente o no se entiende, responde solo con algo breve en el idioma del paciente.
    """
    prompt = (
        "Eres un traductor profesional en un hospital.\n"
        "Tomas frases habladas por personal sanitario en ESPAÑOL "
        "y las traduces al idioma del PACIENTE.\n"
        "Responde SIEMPRE solo con la traducción, sin explicaciones, "
        "sin comentarios, sin notas ni advertencias.\n"
        "Si el texto es incoherente o no se entiende, responde únicamente con una frase corta "
        "en el idioma del paciente equivalente a '(no se entiende bien)'.\n\n"
        f"Idioma del paciente (en español, por ejemplo 'inglés', 'francés'): {idioma_paciente}\n\n"
        f"Texto del sanitario (en ESPAÑOL):\n{texto_sanitario}\n"
    )
    traduccion = llamar_agente(prompt)
    return traduccion.strip()


def traducir_documento_generico(
    texto_documento: str, idioma_destino: str, origen: str
) -> str:
    """
    Traduce documentos usando Perplexity. origen: 'paciente' o 'sanitario'.
    - Si origen == 'paciente': siempre traduce al ESPAÑOL.
    - Si origen == 'sanitario': traduce al idioma_destino (idioma del paciente).
    """
    if origen == "paciente":
        prompt = f"""
Eres un agente de traducción.
TU ÚNICA TAREA es traducir el texto, sin explicaciones adicionales,
sin comentarios legales, sin valoraciones, sin resúmenes y sin añadir información nueva.

Traduce el siguiente DOCUMENTO entregado por el PACIENTE al ESPAÑOL.
Devuelve únicamente la traducción, sin ningún texto extra.

DOCUMENTO DEL PACIENTE:
{texto_documento}
"""
    else:
        prompt = f"""
Eres un agente de traducción.
TU ÚNICA TAREA es traducir el texto, sin explicaciones adicionales,
sin comentarios legales, sin valoraciones, sin resúmenes y sin añadir información nueva.

El siguiente texto es un DOCUMENTO del HOSPITAL para el PACIENTE, escrito en ESPAÑOL.
Traduce TODO el contenido al idioma del paciente: {idioma_destino}.
Devuelve únicamente la traducción, sin ningún texto extra.

DOCUMENTO DEL HOSPITAL:
{texto_documento}
"""

    traduccion = llamar_agente(prompt)
    return traduccion.strip()


def iniciar_conversacion(texto_original: str) -> dict:
    """
    Orquesta: detecta idioma, traduce al español y devuelve la estructura de la conversación.
    """
    id_conversacion = str(uuid4())

    idioma_paciente = detectar_idioma_paciente(texto_original)
    texto_traducido = traducir_paciente_a_espanol(texto_original, idioma_paciente)

    return {
        "id_conversacion": id_conversacion,
        "rol": "paciente",
        "idioma_paciente": idioma_paciente,
        "texto_original": texto_original,
        "texto_traducido": texto_traducido,
    }