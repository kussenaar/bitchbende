import { createServer } from 'node:http'
import { createRoomHandler } from './rooms.ts'
import { MemoryRoomRepository } from './memory-repository.ts'
import { isLocalDevOrigin } from './dev-origin.ts'

const port = Number(process.env.PORT ?? 8787)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.')

const configuredOrigins = process.env.ALLOWED_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean)
const handler = createRoomHandler(new MemoryRoomRepository(), {
  allowedOrigins: configuredOrigins,
  allowOrigin: configuredOrigins ? undefined : isLocalDevOrigin,
})

createServer(async (incoming, outgoing) => {
  if (incoming.url?.split('?')[0] !== '/api/rooms') {
    outgoing.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"Not found."}')
    return
  }
  try {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of incoming) {
      bytes += chunk.length
      if (bytes > 16_384) {
        outgoing.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"The request is too large."}')
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
    const method = incoming.method ?? 'GET'
    const response = await handler(new Request(`http://127.0.0.1:${port}${incoming.url}`, {
      method, headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
    }))
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(await response.text())
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(503, { 'Content-Type': 'application/json' })
    outgoing.end('{"error":"The local game server could not complete the request."}')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local room server: http://127.0.0.1:${port}/api/rooms (rooms reset when the server stops)`)
})
