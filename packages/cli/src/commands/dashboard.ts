import chalk from 'chalk';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCentralConfig,
  centralConfigExists,
  createDefaultConfig,
  saveCentralConfig,
  DEFAULT_CONFIG_PATH,
} from '@ppds-orchestration/core';

/**
 * Dashboard command - starts the web server and optionally opens browser.
 */
export async function dashboardCommand(options: { open?: boolean; port?: number }): Promise<void> {
  // Ensure config exists
  if (!centralConfigExists()) {
    console.log(chalk.yellow('No central config found. Creating default config...'));
    const defaultConfig = createDefaultConfig();
    saveCentralConfig(defaultConfig);
    console.log(chalk.green(`Created config at ${DEFAULT_CONFIG_PATH}`));
    console.log(chalk.yellow('Add repos to the config before spawning workers.'));
  }

  const config = loadCentralConfig();
  const port = options.port ?? config.dashboard?.port ?? 3847;

  console.log(chalk.blue('Starting Orchestration Hub...'));
  console.log(chalk.gray(`Config: ${DEFAULT_CONFIG_PATH}`));
  console.log(chalk.gray(`Repos: ${Object.keys(config.repos).join(', ') || 'none configured'}`));

  // Find the web package server entry point
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const webServerPath = path.resolve(__dirname, '../../../web/dist/server/index.js');

  // Check if web package is built
  const fs = await import('node:fs');
  if (!fs.existsSync(webServerPath)) {
    console.log(chalk.red('Web package not built.'));
    console.log(chalk.yellow('Run: npm run build -w packages/web'));
    process.exit(1);
  }

  // Start the server
  const serverProcess: ChildProcess = spawn('node', [webServerPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  serverProcess.on('error', (error) => {
    console.error(chalk.red(`Failed to start server: ${error.message}`));
    process.exit(1);
  });

  // Open browser if requested
  if (options.open) {
    const url = `http://localhost:${port}`;
    console.log(chalk.green(`Opening ${url} in browser...`));

    // Platform-specific open command
    const openCmd = process.platform === 'win32' ? 'start' :
                   process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(openCmd, [url], { shell: true, detached: true, stdio: 'ignore' }).unref();
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nShutting down...'));
    serverProcess.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    serverProcess.kill();
    process.exit(0);
  });
}
