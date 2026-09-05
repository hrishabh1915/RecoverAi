export default async function handler(req, res) {
  try {
    const { default: app } = await import('./server.js');
    return app(req, res);
  } catch (err) {
    console.error('Serverless error:', err);
    res.status(500).json({
      error: 'SERVERLESS_CRASH',
      message: err?.message || String(err),
      stack: err?.stack,
      name: err?.name,
    });
  }
}
