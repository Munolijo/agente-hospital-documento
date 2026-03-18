import { useState, useRef } from "react";
import {
  iniciarConversacionPaciente,
  turnoPaciente,
  turnoSanitario,
  finalizarConversacion as finalizarConversacionApi,
  resolverMedicamento,
} from "../api/backend";

export default function ChatPage() {
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState("");
  const [idConversacion, setIdConversacion] = useState(null);
  const [rolActual, setRolActual] = useState("paciente"); // 'paciente' | 'sanitario'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Documentos
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // 🎤 Voz a texto
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // 🔊 Texto a voz
  const sintetizadorDisponible =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const getSpeechRecognition = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return null;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "es-ES"; // interfaz en castellano
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false; // una frase por pulsación
    return recognition;
  };

  const mapearLangVoz = (codigo) => {
    if (!codigo) return "es-ES";
    const base = codigo.toLowerCase();
    if (base.startsWith("es")) return "es-ES";
    if (base.startsWith("en")) return "en-GB";
    if (base.startsWith("fr")) return "fr-FR";
    if (base.startsWith("it")) return "it-IT";
    if (base.startsWith("pt")) return "pt-PT";
    if (base.startsWith("de")) return "de-DE";
    return "es-ES";
  };

  const hablarTexto = (texto, lang = "es-ES") => {
    if (!sintetizadorDisponible) {
      setError("Este navegador no soporta síntesis de voz.");
      return;
    }
    if (!texto || !texto.trim()) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(texto);

    // Intentamos elegir una voz que coincida con el lang
    const voces = window.speechSynthesis.getVoices();
    const vozSeleccionada =
      voces.find((v) => v.lang === lang) ||
      voces.find((v) => v.lang.startsWith(lang.split("-")[0])) ||
      null;

    if (vozSeleccionada) {
      utterance.voice = vozSeleccionada;
    } else {
      console.warn("No se ha encontrado voz específica para", lang);
    }

    utterance.lang = lang;
    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.speak(utterance);
  };

  async function enviarTextoAlBackend(textoAEnviar) {
    if (!textoAEnviar.trim()) return;

    setLoading(true);
    setError("");
    setInfo("");

    try {
      let data;

      if (rolActual === "paciente") {
        if (!idConversacion) {
          // inicia conversación
          data = await iniciarConversacionPaciente(textoAEnviar);
        } else {
          data = await turnoPaciente(idConversacion, textoAEnviar);
        }
      } else {
        if (!idConversacion) {
          setError(
            "Para que el sanitario hable primero debe haber una conversación iniciada por el paciente."
          );
          setLoading(false);
          return;
        }
        data = await turnoSanitario(idConversacion, textoAEnviar);
      }

      if (!idConversacion && data.id_conversacion) {
        setIdConversacion(data.id_conversacion);
      }

      const textoTraducidoFinal =
        data.texto_traducido ?? "(sin texto_traducido)";

      const idiomaPaciente = data.idioma_paciente;

      setMensajes((prev) => [
        ...prev,
        {
          rol: rolActual,
          texto_original: textoAEnviar,
          texto_traducido: textoTraducidoFinal,
          idioma_paciente: idiomaPaciente,
        },
      ]);

      if (sintetizadorDisponible && textoTraducidoFinal.trim()) {
        const langVoz =
          rolActual === "paciente"
            ? "es-ES"
            : mapearLangVoz(idiomaPaciente);
        hablarTexto(textoTraducidoFinal, langVoz);
      }
    } catch (err) {
      console.error(err);
      setError(
        err.message || "Error de conexión con el backend al enviar mensaje"
      );
    } finally {
      setLoading(false);
    }
  }

  async function enviarMensaje(e) {
    e.preventDefault();
    await enviarTextoAlBackend(texto);
    setTexto("");
  }

  async function finalizarConversacion() {
    setError("");
    setInfo("");

    if (!idConversacion) {
      setError("No hay conversación activa que cerrar.");
      return;
    }

    try {
      await finalizarConversacionApi(idConversacion);

      setIdConversacion(null);
      setMensajes([]);
      setRolActual("paciente");
      setInfo("Conversación cerrada correctamente.");
    } catch (err) {
      console.error(err);
      setError(
        err.message ||
          "Error de conexión con el backend al cerrar la conversación."
      );
    }
  }

  const handleAttachClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleCameraClick = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    }
  };

  const procesarArchivoDocumento = async (file) => {
    if (!file) return;

    setError("");
    setInfo("");
    setIsUploading(true);

    try {
      // Como el endpoint de documentos espera FormData,
      // aquí seguimos usando fetch directo con el token del servicio.
      const token = localStorage.getItem("token");
      if (!token) {
        setError("No hay token. Vuelve a iniciar sesión.");
        setIsUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append("archivo", file);

      const res = await fetch(
        "http://localhost:8000/api/documentos/traducir",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }
      );

      if (!res.ok) {
        setError(
          `Error al traducir el documento (código ${res.status})`
        );
        setIsUploading(false);
        return;
      }

      const data = await res.json();
      const translatedText =
        data.texto_traducido ||
        "(sin texto_traducido en la respuesta)";
      const idiomaPaciente = data.idioma_paciente;

      setMensajes((prev) => [
        ...prev,
        {
          rol: "sistema",
          texto_original: `Documento "${file.name}"`,
          texto_traducido: translatedText,
          idioma_paciente: idiomaPaciente,
        },
      ]);

      if (sintetizadorDisponible && translatedText.trim()) {
        const langVoz = mapearLangVoz(idiomaPaciente);
        hablarTexto(translatedText, langVoz);
      }

      setInfo("Documento traducido correctamente.");
    } catch (err) {
      console.error(err);
      setError(
        "Error de conexión con el backend al traducir el documento."
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    await procesarArchivoDocumento(file);
    if (event.target) event.target.value = "";
  };

  const handleCameraChange = async (event) => {
    const file = event.target.files?.[0];
    await procesarArchivoDocumento(file);
    if (event.target) event.target.value = "";
  };

  const startListening = () => {
    setError("");
    setInfo("");

    const recognition = getSpeechRecognition();
    if (!recognition) {
      setError("Este navegador no soporta reconocimiento de voz.");
      return;
    }

    // Si ya había uno en curso, lo paramos y limpiamos handlers
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (e) {
        console.warn("Error al detener reconocimiento anterior", e);
      }
    }

    recognitionRef.current = recognition;
    setIsListening(true);

    let textoReconocido = "";

recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  console.log("Reconocido:", transcript);   // ← añade esta línea
  textoReconocido = transcript;
};

    recognition.onerror = (event) => {
      console.error("Speech recognition error", event);
      setError("Ha ocurrido un error con el micrófono.");
      setIsListening(false);
    };

    recognition.onend = async () => {
      setIsListening(false);
      if (textoReconocido.trim()) {
        await enviarTextoAlBackend(textoReconocido);
      }
    };

    recognition.start();
  };

  const stopListening = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      } catch (e) {
        console.warn("Error al detener reconocimiento", e);
      }
    }
    setIsListening(false);
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <h3>Traducción paciente ↔ sanitario</h3>

      <div
        style={{
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div>
          <label style={{ marginRight: 8 }}>Quién habla ahora:</label>
          <select
            value={rolActual}
            onChange={(e) => setRolActual(e.target.value)}
            disabled={loading}
          >
            <option value="paciente">Paciente</option>
            <option value="sanitario">Sanitario</option>
          </select>
        </div>

        {idConversacion && (
          <>
            <span style={{ fontSize: 12, color: "#666" }}>
              Conversación: {idConversacion}
            </span>
            <button
              type="button"
              onClick={finalizarConversacion}
              disabled={loading}
            >
              Finalizar conversación
            </button>
          </>
        )}
      </div>

      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: 4,
          padding: 8,
          height: 300,
          overflowY: "auto",
          marginBottom: 12,
        }}
      >
        {mensajes.length === 0 && (
          <p style={{ color: "#666" }}>
            Escribe el primer mensaje del paciente para iniciar la
            conversación.
          </p>
        )}
        {mensajes.map((m, index) => (
          <div key={index} style={{ marginBottom: 12 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <strong>
                {m.rol === "paciente"
                  ? "Paciente"
                  : m.rol === "sanitario"
                  ? "Sanitario"
                  : "Sistema"}
                :
              </strong>{" "}
              <span>{m.texto_original}</span>
            </div>
            <div style={{ marginLeft: 16, color: "#555" }}>
              <strong>Traducción:</strong> {m.texto_traducido}
            </div>
          </div>
        ))}
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {info && <p style={{ color: "green" }}>{info}</p>}

      {/* inputs ocultos */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
        style={{ display: "none" }}
      />
      {/* Solo cámara (móvil) */}
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleCameraChange}
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
      />

      <form onSubmit={enviarMensaje}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          style={{ width: "100%", marginBottom: 8 }}
          placeholder={
            rolActual === "paciente"
              ? "Escribe aquí el texto del paciente…"
              : "Escribe aquí el texto del sanitario en ESPAÑOL…"
          }
        />

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={loading || isUploading}
            title="Adjuntar documento para traducir"
          >
            📎 Adjuntar archivo
          </button>

          <button
            type="button"
            onClick={handleCameraClick}
            disabled={loading || isUploading}
            title="Hacer foto de documento"
          >
            📷 Foto documento
          </button>

          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={loading}
            title={isListening ? "Detener micrófono" : "Hablar por micrófono"}
          >
            {isListening ? "🛑 Detener" : "🎤 Hablar"}
          </button>

          <button type="submit" disabled={loading}>
            {loading
              ? "Enviando..."
              : idConversacion
              ? "Enviar siguiente turno"
              : "Iniciar conversación (paciente)"}
          </button>

          {isUploading && (
            <span style={{ fontSize: 12, color: "#555" }}>
              Traduciendo documento…
            </span>
          )}
        </div>
      </form>
    </div>
  );
}