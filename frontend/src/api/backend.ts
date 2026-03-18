// src/api/backend.ts

// Forzamos directamente la URL de Render
const BASE_URL = "https://agente-hospital.onrender.com";

// --------- Auth ----------

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