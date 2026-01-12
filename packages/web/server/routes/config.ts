import { Router, Request, Response } from 'express';
import { MultiRepoService } from '../services/multi-repo-service.js';
import {
  CentralConfig,
  saveCentralConfig,
  DEFAULT_CONFIG_PATH,
} from '@ppds-orchestration/core';

export const configRouter = Router();

/**
 * GET /api/config
 * Get current central config.
 */
configRouter.get('/', (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const config = service.getConfig();

    res.json({ config, path: DEFAULT_CONFIG_PATH });
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({ error: 'Failed to get config' });
  }
});

/**
 * PUT /api/config
 * Update central config.
 * Note: Requires server restart to take effect for repo services.
 */
configRouter.put('/', (req: Request, res: Response) => {
  try {
    const newConfig: CentralConfig = req.body;

    // Validate config structure
    if (!newConfig.version || !newConfig.repos) {
      return res.status(400).json({ error: 'Invalid config structure' });
    }

    // Save to disk
    saveCentralConfig(newConfig);

    // Update app locals (but note services won't be recreated)
    req.app.locals.centralConfig = newConfig;

    res.json({
      config: newConfig,
      message: 'Config saved. Restart server for repo service changes to take effect.',
    });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to save config',
    });
  }
});
