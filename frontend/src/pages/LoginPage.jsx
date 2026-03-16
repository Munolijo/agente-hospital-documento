import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, getCurrentUser } from "../api/backend";

export default function LoginPage() {
  const [username, setUsername] = useState(""); // antes email
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      console.log("SUBMIT LOGIN", username, password);

      const result = await login(username, password);
      console.log("RESPUESTA LOGIN", result);

      const me = await getCurrentUser();
      console.log("Usuario autenticado:", me);

      navigate("/app");
    } catch (e) {
      console.error("ERROR EN LOGIN COMPLETO:", e);
      // Estos logs nos dicen exactamente qué error es
      console.error("NAME:", e && e.name);
      console.error("MESSAGE:", e && e.message);
      console.error("STACK:", e && e.stack);

      setError(
        (e && e.message) || "Error de conexión o credenciales incorrectas"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 400,
        margin: "80px auto",
        border: "1px solid #ddd",
        padding: 24,
        borderRadius: 8,
      }}
    >
      <h1 style={{ marginBottom: 16 }}>PANTALLA LOGIN TEST</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label>
            Usuario
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8 }}
            />
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8 }}
            />
          </label>
        </div>
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Accediendo..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}