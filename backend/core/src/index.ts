import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireConnectorToken } from './auth/requireConnectorToken.js';
import { warnIfWebOriginMissing } from './corsOriginGuard.js';
import { createMcpServer } from './mcp/server.js';
import { apiRouter } from './rest/router.js';

const app = express();
warnIfWebOriginMissing();
app.use(cors({ origin: process.env.WEB_ORIGIN, credentials: true }));
app.use(express.json());
app.use('/api', apiRouter);

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post('/mcp', requireConnectorToken, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const server = createMcpServer(req.userId!);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    // Use the transport's own onclose (fired when the MCP session truly ends —
    // e.g. a DELETE request or the SDK's internal session teardown), not the
    // Express response's 'close' event. Streamable HTTP is one-POST-per-message:
    // res.on('close', ...) fires as soon as *this* request's response finishes,
    // which would delete the transport from the map after the very first request
    // and break every subsequent request in the same session ("Server not
    // initialized"). See @modelcontextprotocol/sdk's own
    // examples/server/simpleStreamableHttp.js for the same pattern.
    transport.onclose = () => {
      if (transport!.sessionId) {
        transports.delete(transport!.sessionId);
      }
    };
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', requireConnectorToken, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Unknown session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', requireConnectorToken, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Unknown session');
    return;
  }
  await transport.handleRequest(req, res);
});

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3001;
app.listen(PORT, () => {
  console.log(`Switch MCP server listening on http://localhost:${PORT}/mcp`);
});
