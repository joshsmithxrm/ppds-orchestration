import type { WebSocket } from 'ws';
import {
  getSharedPtyManager,
  type TerminalMessage,
  type TerminalConnectMessage,
  type TerminalInputMessage,
  type TerminalResizeMessage,
} from '@ppds-orchestration/core';

/**
 * Map of WebSocket clients to their subscribed terminal sessions.
 * A client can be subscribed to multiple sessions (for multi-pane views).
 */
const clientSubscriptions = new Map<WebSocket, Set<string>>();

/**
 * Map of session IDs to subscribed WebSocket clients.
 */
const sessionClients = new Map<string, Set<WebSocket>>();

/**
 * Initializes terminal WebSocket handling.
 * Should be called once at server startup.
 */
export function initializeTerminalHandler(): void {
  const ptyManager = getSharedPtyManager();

  // Forward PTY data to subscribed clients
  ptyManager.onData((sessionId, data) => {
    console.log(`[PTY] Data received for ${sessionId.slice(0, 8)}... (${data.length} bytes)`);
    const clients = sessionClients.get(sessionId);
    if (!clients) {
      console.log(`[PTY] No clients subscribed for ${sessionId.slice(0, 8)}...`);
      return;
    }

    console.log(`[PTY] Forwarding to ${clients.size} client(s)`);
    const message = JSON.stringify({
      type: 'terminal:data',
      sessionId,
      data,
    });

    for (const client of clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    }
  });

  // Forward PTY exit to subscribed clients
  ptyManager.onExit((sessionId, exitCode) => {
    const clients = sessionClients.get(sessionId);
    if (!clients) return;

    const message = JSON.stringify({
      type: 'terminal:exit',
      sessionId,
      exitCode,
    });

    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  });
}

/**
 * Handles terminal-related WebSocket messages.
 * @returns true if the message was handled, false otherwise
 */
export function handleTerminalMessage(ws: WebSocket, message: TerminalMessage): boolean {
  switch (message.type) {
    case 'terminal:connect':
      handleConnect(ws, message);
      return true;

    case 'terminal:input':
      handleInput(ws, message);
      return true;

    case 'terminal:resize':
      handleResize(ws, message);
      return true;

    case 'terminal:disconnect':
      handleDisconnect(ws, message.sessionId);
      return true;

    default:
      return false;
  }
}

/**
 * Handles client connection to a terminal session.
 */
function handleConnect(ws: WebSocket, message: TerminalConnectMessage): void {
  const { sessionId, cols, rows } = message;
  const ptyManager = getSharedPtyManager();

  console.log(`[Terminal] Client connecting to session ${sessionId.slice(0, 8)}...`);
  console.log(`[Terminal] Available PTY sessions:`, ptyManager.listSessions().map(s => s.sessionId.slice(0, 8)));

  // Check if session exists
  const state = ptyManager.getState(sessionId);
  if (!state) {
    console.log(`[Terminal] PTY session ${sessionId.slice(0, 8)}... NOT FOUND`);
    sendError(ws, sessionId, `PTY session ${sessionId} not found`);
    return;
  }
  console.log(`[Terminal] PTY session found, running: ${state.running}`);

  // Track subscription
  if (!clientSubscriptions.has(ws)) {
    clientSubscriptions.set(ws, new Set());
  }
  clientSubscriptions.get(ws)!.add(sessionId);

  if (!sessionClients.has(sessionId)) {
    sessionClients.set(sessionId, new Set());
  }
  sessionClients.get(sessionId)!.add(ws);

  // Resize if dimensions provided
  if (cols && rows && state.running) {
    try {
      ptyManager.resize(sessionId, cols, rows);
    } catch {
      // Ignore resize errors on connect
    }
  }

  // Send current state
  ws.send(JSON.stringify({
    type: 'terminal:connected',
    sessionId,
    state: {
      running: state.running,
      exitCode: state.exitCode,
      cols: state.cols,
      rows: state.rows,
    },
  }));

  // Send buffered output (history) to late-joining clients
  const buffer = ptyManager.getBuffer(sessionId);
  if (buffer && buffer.length > 0) {
    console.log(`[Terminal] Sending ${buffer.length} bytes of buffered output`);
    ws.send(JSON.stringify({
      type: 'terminal:data',
      sessionId,
      data: buffer,
    }));
  }
}

/**
 * Handles stdin input from client.
 */
function handleInput(_ws: WebSocket, message: TerminalInputMessage): void {
  const { sessionId, data } = message;
  const ptyManager = getSharedPtyManager();

  try {
    ptyManager.write(sessionId, data);
  } catch (error) {
    // Session might have exited - ignore
    console.log(`Terminal input ignored for ${sessionId}: ${error}`);
  }
}

/**
 * Handles terminal resize from client.
 */
function handleResize(_ws: WebSocket, message: TerminalResizeMessage): void {
  const { sessionId, cols, rows } = message;
  const ptyManager = getSharedPtyManager();

  try {
    ptyManager.resize(sessionId, cols, rows);
  } catch (error) {
    // Session might have exited - ignore
    console.log(`Terminal resize ignored for ${sessionId}: ${error}`);
  }
}

/**
 * Handles client disconnection from a terminal session.
 */
function handleDisconnect(ws: WebSocket, sessionId: string): void {
  // Remove from client subscriptions
  const sessions = clientSubscriptions.get(ws);
  if (sessions) {
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      clientSubscriptions.delete(ws);
    }
  }

  // Remove from session clients
  const clients = sessionClients.get(sessionId);
  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) {
      sessionClients.delete(sessionId);
    }
  }
}

/**
 * Cleans up subscriptions when a WebSocket client disconnects.
 */
export function cleanupClientSubscriptions(ws: WebSocket): void {
  const sessions = clientSubscriptions.get(ws);
  if (!sessions) return;

  for (const sessionId of sessions) {
    const clients = sessionClients.get(sessionId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        sessionClients.delete(sessionId);
      }
    }
  }

  clientSubscriptions.delete(ws);
}

/**
 * Sends an error message to a client.
 */
function sendError(ws: WebSocket, sessionId: string, error: string): void {
  ws.send(JSON.stringify({
    type: 'terminal:error',
    sessionId,
    error,
  }));
}

/**
 * Gets the number of clients subscribed to a session.
 */
export function getSessionClientCount(sessionId: string): number {
  return sessionClients.get(sessionId)?.size ?? 0;
}

/**
 * Gets all sessions with subscribed clients.
 */
export function getActiveTerminalSessions(): string[] {
  return Array.from(sessionClients.keys());
}
