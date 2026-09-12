export async function toWebRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks)
  });
}

export async function sendWebResponse(webResponse, response) {
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  if (!webResponse.body) {
    response.end(Buffer.from(await webResponse.arrayBuffer()));
    return;
  }
  for await (const chunk of webResponse.body) {
    response.write(Buffer.from(chunk));
    response.flushHeaders?.();
  }
  response.end();
}
