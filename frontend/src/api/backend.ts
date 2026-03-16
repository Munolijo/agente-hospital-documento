// src/api/backend.ts

// Usamos variable de entorno en producción y localhost en desarrollo
const BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

// ---------------------------------------------------------
// Gestión de token (simple con localStorage)
// ---------------------------------------------------------

export function setToken(token: string) {
  localStorage.setItem("token", token);
}

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function clearToken() {
  localStorage.removeItem("token");
}

// ---------------------------------------------------------
// Helper genérico para peticiones al backend
// ---------------------------------------------------------

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  requireAuth: boolean = true
): Promise<T> {
  const token = getToken();

  const headers: HeadersInit = {
    ...(options.headers || {}),
  };

  // Solo ponemos Content-Type JSON si no es FormData
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  if (requireAuth) {
    if (!token) {
      throw new Error("No hay token, el usuario no está autenticado");
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------
// Auth
// ---------------------------------------------------------

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export async function login(username: string, password: string): Promise<void> {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login incorrecto: ${text}`);
  }

  const data: LoginResponse = await res.json();
  setToken(data.access_token);
}

export interface UserMe {
  id: number;
  username: string;
  hospital_id: string;
  role: string;
  activo: boolean;
}

export async function getCurrentUser(): Promise<UserMe> {
  return apiFetch<UserMe>("/auth/me", { method: "GET" }, true);
}

// ---------------------------------------------------------
// Medicamentos
// ---------------------------------------------------------

export interface MedicamentoEntrada {
  nombre_comercial: string;
}

export interface MedicamentoSalida {
  nombre_comercial: string;
  principio_activo: string;
}

/**
 * Resuelve el principio activo de un medicamento.
 * Requiere que el usuario esté logado (usa Authorization: Bearer token).
 */
export async function resolverMedicamento(
  nombreComercial: string
): Promise<MedicamentoSalida> {
  return apiFetch<MedicamentoSalida>(
    "/api/medicamentos/resolver",
    {
      method: "POST",
      body: JSON.stringify({ nombre_comercial: nombreComercial }),
    },
    true
  );
}

// ---------------------------------------------------------
// Conversaciones agente
// ---------------------------------------------------------

export interface RespuestaMensaje {
  id_conversacion: string;
  rol: string;
  idioma_paciente: string;
  texto_original: string;
  texto_traducido: string;
}

export async function iniciarConversacionPaciente(
  textoOriginal: string
): Promise<RespuestaMensaje> {
  return apiFetch<RespuestaMensaje>(
    "/api/conversaciones/paciente/texto",
    {
      method: "POST",
      body: JSON.stringify({ texto_original: textoOriginal }),
    },
    true
  );
}

export async function turnoPaciente(
  idConversacion: string,
  textoOriginal: string
): Promise<RespuestaMensaje> {
  return apiFetch<RespuestaMensaje>(
    `/api/conversaciones/${encodeURIComponent(
      idConversacion
    )}/paciente/texto`,
    {
      method: "POST",
      body: JSON.stringify({ texto_original: textoOriginal }),
    },
    true
  );
}

export async function turnoSanitario(
  idConversacion: string,
  textoOriginal: string
): Promise<RespuestaMensaje> {
  return apiFetch<RespuestaMensaje>(
    `/api/conversaciones/${encodeURIComponent(
      idConversacion
    )}/sanitario/texto`,
    {
      method: "POST",
      body: JSON.stringify({ texto_original: textoOriginal }),
    },
    true
  );
}

export interface FinalizarRespuesta {
  id_conversacion: string;
  estado: string;
}

export async function finalizarConversacion(
  idConversacion: string
): Promise<FinalizarRespuesta> {
  return apiFetch<FinalizarRespuesta>(
    `/api/conversaciones/${encodeURIComponent(idConversacion)}/finalizar`,
    {
      method: "POST",
    },
    true
  );
}