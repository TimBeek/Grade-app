// Aggregate sizes/timing only. Never log bodies, query parameters or credentials.
export function emitMetric(metric) {
  if (process.env.REMARKT_METRICS === '1') console.log(JSON.stringify({ type: 'remarkt_metric', ...metric }));
}
export function apiTelemetry(response, endpoint) {
  const started = Date.now(), original = response.json.bind(response);
  response.json = body => {
    emitMetric({ endpoint, status: response.statusCode || response.code || 200,
      durationMs: Date.now() - started, responseBytes: Buffer.byteLength(JSON.stringify(body)),
      errorCode: body?.ok === false ? body.code || 'ERROR' : null });
    return original(body);
  };
}
