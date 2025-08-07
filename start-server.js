import { spawn } from 'child_process';

// Start the Express server
const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: '3001' }
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
});

process.on('SIGTERM', () => {
  server.kill();
});

process.on('SIGINT', () => {
  server.kill();
});
