import { useState } from "react";
import { login } from "./api/backend";

export function LoginPage(props: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await login(username, password);
      props.onLogin(data.access_token);
    } catch (err: any) {
      setError(err.message ?? "Error inesperado al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          padding: 24,
          border: "1px solid #ddd",
          borderRadius: 8,
          width: 320,
        }}
      >
        <h2>Acceso personal sanitario</h2>
        <div style={{ marginTop: 16 }}>
          <label>Usuario</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <label>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        {error && (
          <div style={{ marginTop: 16, color: "red" }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          style={{ marginTop: 16, width: "100%" }}
        >
          {loading ? "Accediendo..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}