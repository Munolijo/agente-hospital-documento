// src/api/backend.ts

// "LOCAL"  -> backend en tu máquina
// "RENDER" -> backend en Render (no lo usaremos de momento)
const ENTORNO_BACKEND: "LOCAL" | "RENDER" = "LOCAL";

const BACKEND_URL_LOCAL = "http://127.0.0.1:8000";  // o 8000, según uses en backend
const BACKEND_URL_RENDER = "https://agente-hospital-documento.onrender.com";

const BACKEND_URL_MAP: Record<string, string> = {
  LOCAL: BACKEND_URL_LOCAL,
  RENDER: BACKEND_URL_RENDER,
};

export const BACKEND_URL = BACKEND_URL_MAP[ENTORNO_BACKEND] || BACKEND_URL_RENDER;

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

type SimpleHeaders = Record<string, string>;

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  requireAuth: boolean = true
): Promise<T> {
  const token = getToken();

  const headers: SimpleHeaders = {
    ...(options.headers as SimpleHeaders | undefined),
  };

  // Solo ponemos Content-Type JSON si no es FormData
  if (!(options.body instanceof FormData)) {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  if (requireAuth) {
    if (!token) {
      throw new Error("No hay token, el usuario no está autenticado");
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${BACKEND_URL}${path}`;
  console.log("apiRequest URL:", url);

  const res = await fetch(url, {
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

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const url = `${BACKEND_URL}/auth/login`;
  console.log("Login URL:", url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Usuario o contraseña incorrectos.");
  }

  const data: LoginResponse = await res.json();
  return data;
}