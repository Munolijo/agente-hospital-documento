import { useEffect, useState } from "react";
import { LoginPage } from "./LoginPage";
import { API_BASE_URL } from "./config";

type RolConversacion = "paciente" | "sanitario";

interface MensajeUI {
  id: string;
  rol: RolConversacion;
  textoOriginal: string;
  textoTraducido: string;
}

// --- Helper TTS externo (Azure) ---

async function reproducirTtsExterno(
  texto: string,
  idiomaPaciente: string | null,
  token: string
) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        texto,
        idioma_paciente: idiomaPaciente,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail ?? "Error en TTS externo");
    }

    const data = await res.json();
    const audioB64 = data.audio_base64 as string | undefined;
    if (!audioB64) {
      throw new Error("Respuesta TTS sin audio_base64");
    }

    const audioBytes = Uint8Array.from(atob(audioB64), (c) =>
      c.charCodeAt(0)
    );
    const blob = new Blob([audioBytes], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  } catch (e) {
    console.error("ERROR_TTS_EXTERNO ->", e);
    throw e;
  }
}

function ConversacionPage(props: { token: string; onLogout: () => void }) {
  const [rolActivo, setRolActivo] = useState<RolConversacion>("paciente");
  const [idConversacion, setIdConversacion] = useState<string | null>(null);
  const [idiomaPaciente, setIdiomaPaciente] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<MensajeUI[]>([]);
  const [textoEntrada, setTextoEntrada] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Para documentos / fotos
  const [, setArchivo] = useState<File | null>(null);
  const [subiendoDoc, setSubiendoDoc] = useState(false);

  // Estado para audio
  const [grabando, setGrabando] = useState(false);
  const [enviandoAudio, setEnviandoAudio] = useState(false);
  const [mediaRecorder, setMediaRecorder] =
    useState<MediaRecorder | null>(null);

  // Voces TTS (Web Speech)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsAviso, setTtsAviso] = useState<string | null>(null);

  // ---- Carga de voces del navegador ----

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setTtsAviso(
        "Este navegador no soporta lectura en voz (Web Speech API)."
      );
      return;
    }

    const cargarVoces = () => {
      const v = window.speechSynthesis.getVoices();
      if (v && v.length > 0) {
        setVoices(v);
      }
    };

    cargarVoces();

    window.speechSynthesis.onvoiceschanged = () => {
      cargarVoces();
    };
  }, []);

  const seleccionarVozPorIdioma = (
    langObjetivo: string
  ): SpeechSynthesisVoice | null => {
    if (!voices.length) return null;

    const lowerTarget = langObjetivo.toLowerCase();

    // 1. Coincidencia exacta de lang (ej: "ar-SA")
    let voz = voices.find((v) => v.lang.toLowerCase() === lowerTarget);
    if (voz) return voz;

    // 2. Coincidencia por prefijo (ej: "ar-" o "ar")
    const prefix = lowerTarget.split("-")[0];
    voz = voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
    if (voz) return voz;

    // 3. Sin coincidencia: devolvemos null y que el código superior decida
    return null;
  };

  // ---- Helpers de voz ----

  // Mapea el texto "inglés", "francés", etc. a códigos BCP47 sencillos
  const mapearIdiomaPacienteALang = (idioma: string | null): string => {
    if (!idioma) return "en-US";

    const i = idioma.toLowerCase();
    if (i.includes("ingl")) return "en-US";
    if (i.includes("fran")) return "fr-FR";
    if (i.includes("portu")) return "pt-PT";
    if (i.includes("alem")) return "de-DE";
    if (i.includes("árab") || i.includes("arab")) return "ar-SA";
    if (i.includes("ital")) return "it-IT";
    if (i.includes("rum") || i.includes("ruma")) return "ro-RO";
    if (i.includes("chino") || i.includes("mandarín")) return "zh-CN";
    if (i.includes("fars") || i.includes("persa")) return "fa-IR";

    // por defecto, inglés
    return "en-US";
  };

  const hablarTexto = (texto: string, lang: string) => {
    if (!("speechSynthesis" in window)) {
      return;
    }

    setTtsAviso(null);

    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = lang;

    const vozSeleccionada = seleccionarVozPorIdioma(lang);
    if (vozSeleccionada) {
      utter.voice = vozSeleccionada;
    } else {
      // No hay voz para ese idioma
      setTtsAviso(
        `No hay voz instalada para el idioma ${lang}. Se muestra el texto, pero no se puede leer en voz alta en este dispositivo.`
      );
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const hablarParaSanitario = (texto: string) => {
    // español para el sanitario (Web Speech)
    hablarTexto(texto, "es-ES");
  };

  const hablarParaPaciente = async (texto: string) => {
    const lang = mapearIdiomaPacienteALang(idiomaPaciente);

    // Primero intentamos TTS externo (Azure) si hay idioma_paciente conocido
    try {
      if (idiomaPaciente) {
        await reproducirTtsExterno(texto, idiomaPaciente, props.token);
        return;
      }
    } catch {
      // Si falla, seguimos con speechSynthesis
    }

    // Fallback al speechSynthesis del navegador
    hablarTexto(texto, lang);
  };

  // ---- Fin helpers voz ----

  const enviarTexto = async () => {
    setError(null);
    const texto = textoEntrada.trim();
    if (!texto) {
      setError("Escribe un texto antes de enviar.");
      return;
    }

    try {
      let url: string;
      let method = "POST";
      let body: any;
      let isNueva = false;

      if (rolActivo === "paciente") {
        if (!idConversacion) {
          // iniciar conversación
          url = `${API_BASE_URL}/api/conversaciones/paciente/texto`;
          body = { texto_original: texto };
          isNueva = true;
        } else {
          url = `${API_BASE_URL}/api/conversaciones/${idConversacion}/paciente/texto`;
          body = { texto_original: texto };
        }
      } else {
        // sanitario
        if (!idConversacion) {
          setError("Primero debe hablar el paciente para iniciar la conversación.");
          return;
        }
        url = `${API_BASE_URL}/api/conversaciones/${idConversacion}/sanitario/texto`;
        body = { texto_original: texto };
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${props.token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? "Error en la conversación");
      }

      const data = await res.json();

      if (isNueva) {
        setIdConversacion(data.id_conversacion);
        setIdiomaPaciente(data.idioma_paciente ?? null);
      }

      const nuevo: MensajeUI = {
        id: crypto.randomUUID(),
        rol: rolActivo,
        textoOriginal: data.texto_original,
        textoTraducido: data.texto_traducido,
      };

      setMensajes((prev) => [...prev, nuevo]);
      setTextoEntrada("");

      // REGLA DE VOZ:
      // - Paciente habla -> sanitario escucha la traducción al español
      // - Sanitario habla -> paciente escucha la traducción en su idioma
      if (data.texto_traducido) {
        if (rolActivo === "paciente") {
          hablarParaSanitario(data.texto_traducido);
        } else {
          hablarParaPaciente(data.texto_traducido);
        }
      }
    } catch (e: any) {
      setError(e.message ?? "Error inesperado");
    }
  };

  const terminarConversacion = async () => {
    if (!idConversacion) {
      // nada que terminar
      setMensajes([]);
      setTextoEntrada("");
      setIdiomaPaciente(null);
      return;
    }
    setError(null);
    try {
      await fetch(
        `${API_BASE_URL}/api/conversaciones/${idConversacion}/finalizar`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${props.token}`,
          },
        }
      );
      // aunque falle, reseteamos UI
      setIdConversacion(null);
      setMensajes([]);
      setTextoEntrada("");
      setIdiomaPaciente(null);
    } catch {
      setIdConversacion(null);
      setMensajes([]);
      setTextoEntrada("");
      setIdiomaPaciente(null);
    }
  };

  const manejarAdjuntarDocumento = () => {
    document.getElementById("input-doc")?.click();
  };

  const manejarCambioArchivo = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const f = e.target.files?.[0] ?? null;
    setArchivo(f);
    if (!f) return;

    setError(null);
    setSubiendoDoc(true);

    try {
      const formData = new FormData();
      formData.append("archivo", f);

      if (rolActivo === "paciente") {
        formData.append("origen", "paciente");
      } else {
        formData.append("origen", "sanitario");
        if (!idConversacion) {
          throw new Error(
            "Para traducir documentos del sanitario, primero debe existir una conversación."
          );
        }
        formData.append("id_conversacion", idConversacion);
      }

      const res = await fetch(`${API_BASE_URL}/api/documentos/traducir`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${props.token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? "Error traduciendo documento");
      }

      const data = await res.json();

      // Si viene idioma_paciente y aún no lo tenemos, lo fijamos
      if (!idiomaPaciente && data.idioma_paciente) {
        setIdiomaPaciente(data.idioma_paciente);
      }

      const nuevo: MensajeUI = {
        id: crypto.randomUUID(),
        rol: rolActivo,
        textoOriginal: data.texto_origen ?? "(Documento)",
        textoTraducido: data.texto_traducido ?? "",
      };
      setMensajes((prev) => [...prev, nuevo]);

      if (data.texto_traducido) {
        if (rolActivo === "paciente") {
          hablarParaSanitario(data.texto_traducido);
        } else {
          hablarParaPaciente(data.texto_traducido);
        }
      }
    } catch (err: any) {
      setError(err.message ?? "Error al traducir documento");
    } finally {
      setSubiendoDoc(false);
      e.target.value = "";
    }
  };

  const manejarFoto = () => {
    const input = document.getElementById("input-foto") as
      | HTMLInputElement
      | null;
    if (input) {
      input.click();
    }
  };

  const manejarMicrofono = async () => {
    setError(null);

    try {
      // Si ya estamos grabando, paramos y dejamos que onstop envíe el audio
      if (grabando && mediaRecorder) {
        mediaRecorder.stop();
        setGrabando(false);
        setEnviandoAudio(true);
        return;
      }

      // Empezar a grabar
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        // Parar el micro físicamente
        stream.getTracks().forEach((track) => track.stop());

        if (chunks.length === 0) {
          setEnviandoAudio(false);
          return;
        }

        const audioBlob = new Blob(chunks, { type: "audio/webm" });

        const formData = new FormData();
        formData.append("archivo_audio", audioBlob, "grabacion.webm");

        // Lógica de rol robusta:
        // - Si NO hay idConversacion => siempre paciente (primer turno)
        // - Si YA hay idConversacion y aún no hay ningún mensaje del sanitario => forzamos sanitario
        let rolAEnviar: RolConversacion = rolActivo;

        if (!idConversacion) {
          rolAEnviar = "paciente";
        } else {
          const haySanitario = mensajes.some((m) => m.rol === "sanitario");
          if (!haySanitario) {
            rolAEnviar = "sanitario";
          }
        }

        console.log(
          "DEBUG_FRONT_AUDIO -> rolActivo:",
          rolActivo,
          "rolAEnviar:",
          rolAEnviar,
          "idConversacion:",
          idConversacion
        );

        formData.append("rol", rolAEnviar);
        if (idConversacion) {
          formData.append("id_conversacion", idConversacion);
        }

        try {
          const res = await fetch(`${API_BASE_URL}/api/audio/transcribir`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${props.token}`,
            },
            body: formData,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.detail ?? "Error transcribiendo audio");
          }

          const data = await res.json();

          if (!idConversacion && data.id_conversacion) {
            setIdConversacion(data.id_conversacion);
          }
          if (!idiomaPaciente && data.idioma_paciente) {
            setIdiomaPaciente(data.idioma_paciente);
          }

          const nuevo: MensajeUI = {
            id: crypto.randomUUID(),
            rol: rolAEnviar,
            textoOriginal: data.texto_original,
            textoTraducido: data.texto_traducido,
          };
          setMensajes((prev) => [...prev, nuevo]);

          if (data.texto_traducido) {
            if (rolAEnviar === "paciente") {
              hablarParaSanitario(data.texto_traducido);
            } else {
              hablarParaPaciente(data.texto_traducido);
            }
          }
        } catch (err: any) {
          setError(err.message ?? "Error al enviar audio");
        } finally {
          setEnviandoAudio(false);
        }
      };

      recorder.start();
      setMediaRecorder(recorder);
      setGrabando(true);
    } catch (err: any) {
      setError("No se ha podido acceder al micrófono.");
      setGrabando(false);
      setEnviandoAudio(false);
    }
  };

  const puedeTerminar = idConversacion !== null;

  // altura estándar para todos los botones (arriba y abajo)
  const alturaBoton = 30;

  const etiquetaMicro =
    grabando ? "Grabando..." : enviandoAudio ? "Procesando..." : "Mic/Grab";

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        maxWidth: 480,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Línea superior */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "stretch",
          justifyContent: "space-between",
        }}
      >
        <select
          value={rolActivo}
          onChange={(e) => setRolActivo(e.target.value as RolConversacion)}
          style={{ flex: 1, height: alturaBoton }}
        >
          <option value="paciente">Paciente</option>
          <option value="sanitario">Sanitario</option>
        </select>

        {puedeTerminar && (
          <button
            onClick={terminarConversacion}
            style={{ flex: 1, height: alturaBoton }}
          >
            Terminar
          </button>
        )}

        <button
          onClick={props.onLogout}
          style={{ flex: 1, height: alturaBoton }}
        >
          Cerrar sesión
        </button>
      </div>

      {/* Indicador de idioma del paciente (solo si hay conversación) */}
      {idConversacion && idiomaPaciente && (
        <div style={{ fontSize: 13, color: "#555" }}>
          Idioma del paciente detectado: <strong>{idiomaPaciente}</strong>
        </div>
      )}

      {error && (
        <div style={{ color: "red", fontSize: 14 }}>{error}</div>
      )}

      {ttsAviso && (
        <div style={{ color: "#b36b00", fontSize: 13 }}>{ttsAviso}</div>
      )}

      {/* Cuadrado grande de conversación */}
      <div
        style={{
          flex: 1,
          border: "1px solid #ccc",
          borderRadius: 8,
          padding: 8,
          overflowY: "auto",
          maxHeight: 320,
          background: "#fafafa",
        }}
      >
        {mensajes.length === 0 && (
          <div style={{ color: "#888", fontSize: 14 }}>
            Aún no hay mensajes en esta conversación.
          </div>
        )}
        {mensajes.map((m) => (
          <div
            key={m.id}
            style={{
              marginBottom: 8,
              padding: 8,
              borderRadius: 4,
              background: m.rol === "paciente" ? "#e0f7fa" : "#e8f5e9",
              fontSize: 14,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {m.rol === "paciente" ? "Paciente" : "Sanitario"}
            </div>
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontStyle: "italic" }}>Original:</span>{" "}
              {m.textoOriginal}
            </div>
            <div>
              <span style={{ fontStyle: "italic" }}>Traducción:</span>{" "}
              {m.textoTraducido}
            </div>
          </div>
        ))}
      </div>

      {/* Rectángulo de entrada de texto */}
      <textarea
        value={textoEntrada}
        onChange={(e) => setTextoEntrada(e.target.value)}
        rows={2}
        placeholder={
          rolActivo === "paciente"
            ? "Texto del paciente (dificultad auditiva)..."
            : "Paciente debe iniciar conversación"
        }
        style={{
          width: "100%",
          borderRadius: 8,
          border: "1px solid #ccc",
          padding: 8,
          fontSize: 14,
        }}
      />

      {/* Línea de botones de acciones */}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "space-between",
          alignItems: "stretch",
        }}
      >
        {/* Adjuntar documento */}
        <div style={{ flex: 1 }}>
          <input
            id="input-doc"
            type="file"
            style={{ display: "none" }}
            onChange={manejarCambioArchivo}
          />
          <input
            id="input-foto"
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={manejarCambioArchivo}
          />
          <button
            type="button"
            onClick={manejarAdjuntarDocumento}
            disabled={subiendoDoc}
            style={{
              width: "100%",
              height: alturaBoton,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
              opacity: subiendoDoc ? 0.7 : 1,
            }}
          >
            {subiendoDoc ? "Traduciendo..." : "📎 Doc"}
          </button>
        </div>

        {/* Foto */}
        <button
          type="button"
          onClick={manejarFoto}
          style={{
            flex: 1,
            height: alturaBoton,
            whiteSpace: "nowrap",
          }}
        >
          Foto
        </button>

        {/* Enviar texto */}
        <button
          type="button"
          onClick={enviarTexto}
          style={{
            flex: 1,
            height: alturaBoton,
            whiteSpace: "nowrap",
          }}
        >
          Env. Txt.
        </button>

        {/* Micrófono */}
        <button
          type="button"
          onClick={manejarMicrofono}
          style={{
            flex: 1,
            height: alturaBoton,
            whiteSpace: "nowrap",
            backgroundColor: grabando
              ? "#ffcccc"
              : enviandoAudio
              ? "#ffe0b2"
              : undefined,
          }}
        >
          {etiquetaMicro}
        </button>
      </div>
    </div>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(null);

  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  return (
    <ConversacionPage
      token={token}
      onLogout={() => setToken(null)}
    />
  );
}

export default App;