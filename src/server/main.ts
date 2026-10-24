import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { initBots } from './bots/scheduler';
import { setIo } from './net';
import { registerSocketHandlers } from './socket';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });
setIo(io);
initBots();

app.get('/health', (req, res) => res.status(200).send('ok'));
// Bundled output is dist/main.js (CJS), so __dirname is dist/ and static files live in dist/public.
app.use(express.static(path.join(__dirname, 'public')));

registerSocketHandlers(io);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Colonist-Style HexSettlers (Hard Bots + Full Trade) running at http://0.0.0.0:${PORT}`);
});
