// src/api/backend.ts

// Forzamos directamente la URL de Render
export const BACKEND_URL = "http://localhost:8001";

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
// Helper genérico para peticiones al backend (opcional)
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

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const url = `${BASE_URL}/auth/login`;
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