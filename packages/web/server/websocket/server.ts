import { WebSocketServer, WebSocket } from 'ws';
import { MultiRepoService } from '../services/multi-repo-service.js';
import {
  initializeTerminalHandler,
  handleTerminalMessage,
  cleanupClientSubscriptions,
} from './terminal-handler.js';
import type { TerminalMessage } from '@ppds-orchestration/core';

interface WSMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Set up WebSocket server for real-time updates.
 */
export function setupWebSocket(
  wss: WebSocketServer,
  multiRepoService: MultiRepoService
): void {
  const clients = new Set<WebSocket>();

  // Initialize terminal handler for PTY streaming
  initializeTerminalHandler();

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    clients.add(ws);

    ws.on('message', (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());

        // Check if this is a terminal message first
        if (message.type?.startsWith('terminal:')) {
          handleTerminalMessage(ws, message as unknown as TerminalMessage);
          return;
        }

        handleClientMessage(ws, message, multiRepoService);
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      clients.delete(ws);
      // Clean up any terminal subscriptions
      cleanupClientSubscriptions(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
      // Clean up any terminal subscriptions
      cleanupClientSubscriptions(ws);
    });

    // Send initial connection message
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  });

  // Register for session events
  multiRepoService.onSessionEvent((event, repoId, session, sessionId) => {
    const message = JSON.stringify({
      type: `session:${event}`,
      repoId,
      session,
      sessionId,
      timestamp: new Date().toISOString(),
    });

    // Broadcast to all connected clients
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  });

  // Set up periodic status broadcast (polling fallback)
  setInterval(async () => {
    try {
      const sessions = await multiRepoService.listAllSessions();
      const message = JSON.stringify({
        type: 'sessions:snapshot',
        sessions,
        timestamp: new Date().toISOString(),
      });

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    } catch (error) {
      console.error('Error broadcasting sessions:', error);
    }
  }, 30000); // Fallback broadcast every 30 seconds (real-time via file watchers)

  // Set up periodic orphan detection broadcast (every 5 minutes)
  setInterval(async () => {
    try {
      const orphans = await multiRepoService.reconcileOrphans();
      if (orphans.length > 0 || clients.size > 0) {
        const message = JSON.stringify({
          type: 'orphans:detected',
          orphans,
          count: orphans.length,
          timestamp: new Date().toISOString(),
        });

        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        }
      }
    } catch (error) {
      console.error('Error detecting orphans:', error);
    }
  }, 300000); // Check for orphans every 5 minutes
}

/**
 * Handle incoming client messages.
 */
function handleClientMessage(
  _ws: WebSocket,
  message: WSMessage,
  _multiRepoService: MultiRepoService
): void {
  switch (message.type) {
    case 'ping':
      // Heartbeat - no action needed
      break;

    case 'subscribe:repo':
      // Future: track per-client subscriptions
      console.log('Client subscribed to repo:', message.repoId);
      break;

    default:
      console.log('Unknown message type:', message.type);
  }
}
