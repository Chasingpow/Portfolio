export default function NotAuthorized() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg)", gap: 16 }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <h1 style={{ color: "var(--text)", fontWeight: 800, fontSize: 24, margin: 0 }}>Access Restricted</h1>
      <p style={{ color: "var(--sub)", fontSize: 15, textAlign: "center", maxWidth: 400 }}>
        FlowState Alpha is only available to members of our Discord server.
        Join the server first, then sign in again.
      </p>
      <a href="/" style={{ background: "var(--accent)", color: "#fff", padding: "10px 24px", borderRadius: 8, fontWeight: 700, textDecoration: "none", fontSize: 14 }}>
        Back to Home
      </a>
    </div>
  )
}
