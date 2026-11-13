export function App() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Campaign Atlas</h1>
      <p>Platform: {window.atlasApi?.platform ?? 'unknown'}</p>
    </main>
  );
}
