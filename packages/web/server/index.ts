import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { sessionsRouter } from './routes/sessions.js';
import { reposRouter } from './routes/repos.js';
import { configRouter } from './routes/config.js';
import { ralphRouter } from './routes/ralph.js';
import { soundsRouter } from './routes/sounds.js';
import { setupWebSocket } from './websocket/server.js';
import { MultiRepoService } from './services/multi-repo-service.js';
import { RalphLoopManager } from './services/ralph-loop-manager.js';
import {
  loadCentralConfig,
  centralConfigExists,
  createDefaultConfig,
  saveCentralConfig,
  getConfigPath,
} from '@ppds-orchestration/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Load or create central config
const configPath = getConfigPath();
let centralConfig;
if (centralConfigExists()) {
  centralConfig = loadCentralConfig();
  console.log(`Loaded config from ${configPath}`);
} else {
  centralConfig = createDefaultConfig();
  saveCentralConfig(centralConfig);
  console.log(`Created default config at ${configPath}`);
}

// Initialize multi-repo service
const multiRepoService = new MultiRepoService(centralConfig);
await multiRepoService.initialize();

// Initialize Ralph loop manager
const ralphManager = new RalphLoopManager(multiRepoService, centralConfig);

// Start real-time file watching
multiRepoService.startWatching();

// Store service in app locals for routes
app.locals.multiRepoService = multiRepoService;
app.locals.centralConfig = centralConfig;
app.locals.ralphManager = ralphManager;

// API Routes
app.use('/api/sessions', sessionsRouter);
app.use('/api/repos', reposRouter);
app.use('/api/config', configRouter);
app.use('/api/ralph', ralphRouter);
app.use('/api/sounds', soundsRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// WebSocket setup
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss, multiRepoService);

// Serve static files (always serve if client directory exists)
const clientPath = path.join(__dirname, '../client');
if (fs.existsSync(clientPath)) {
  app.use(express.static(clientPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

// Start server
const port = centralConfig.dashboard?.port ?? 3847;
server.listen(port, () => {
  console.log(`Orchestration Hub running at http://localhost:${port}`);
  console.log(`WebSocket available at ws://localhost:${port}/ws`);
  console.log(`Repos configured: ${Object.keys(centralConfig.repos).join(', ') || 'none'}`);
});
