import { Router, Request, Response } from 'express';
import { MultiRepoService } from '../services/multi-repo-service.js';
import path from 'path';
import fs from 'fs';

export const soundsRouter = Router();

// Allowed sound file extensions for security
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];

/**
 * GET /api/sounds/:filename
 * Serve a sound file from the configured soundsDir.
 */
soundsRouter.get('/:filename', (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const config = service.getConfig();
    const soundsDir = config.sounds?.soundsDir;

    if (!soundsDir) {
      return res.status(404).json({ error: 'Sounds directory not configured' });
    }

    const filename = req.params.filename;
    const ext = path.extname(filename).toLowerCase();

    // Security: Only allow specific audio file extensions
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Security: Prevent path traversal
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(soundsDir, sanitizedFilename);

    // Verify the file is within the sounds directory
    const resolvedPath = path.resolve(filePath);
    const resolvedSoundsDir = path.resolve(soundsDir);
    if (!resolvedPath.startsWith(resolvedSoundsDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Sound file not found' });
    }

    // Set content type based on extension
    const contentTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
    };

    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    // Stream the file
    const stream = fs.createReadStream(resolvedPath);
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving sound file:', error);
    res.status(500).json({ error: 'Failed to serve sound file' });
  }
});
