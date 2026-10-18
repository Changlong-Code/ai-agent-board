import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/client');
const api = `http://127.0.0.1:${process.env.ORIGINAL_API_PORT || '8777'}`;
export default {
  root, envFile: false, publicDir: false,
  build: { outDir: path.join(root, 'dist') },
  preview: {
    host: '127.0.0.1', port: Number(process.env.ORIGINAL_BOARD_PORT || 8776), strictPort: true,
    allowedHosts: ['127.0.0.1', 'localhost'],
    proxy: { '/api': { target: api }, '/ws': { target: api.replace('http:', 'ws:'), ws: true } },
  },
};
