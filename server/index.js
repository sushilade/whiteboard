import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, '..', 'client', 'dist');
const isProd = process.env.NODE_ENV === 'production';

const PORT = process.env.PORT || 3001;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

if (isProd) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.get('/health', (_req, res) => res.send('ok'));

let rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      teacher: null,
      students: new Map(),
      strokes: []
    };
  }
  return rooms[roomId];
}

io.on('connection', (socket) => {
  socket.on('join', ({ roomId, role, name }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;
    socket.data.name = name;

    const room = getRoom(roomId);

    if (role === 'teacher') {
      room.teacher = socket.id;
      socket.emit('existing-strokes', room.strokes);
      const existingStudents = Array.from(room.students.entries()).map(
        ([sid, sname]) => ({ socketId: sid, name: sname })
      );
      if (existingStudents.length > 0) {
        socket.emit('existing-students', existingStudents);
      }
    } else {
      room.students.set(socket.id, name);
      socket.emit('existing-strokes', room.strokes);
    }

    io.to(roomId).emit('room-users', {
      teacher: room.teacher,
      students: Array.from(room.students.values())
    });

    if (room.teacher && role !== 'teacher') {
      socket.to(roomId).emit('new-student', { socketId: socket.id, name });
    }
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('stroke', ({ roomId, stroke }) => {
    const room = getRoom(roomId);
    room.strokes.push(stroke);
    if (room.strokes.length > 5000) {
      room.strokes = room.strokes.slice(room.strokes.length - 5000);
    }
    socket.to(roomId).emit('stroke', stroke);
  });

  socket.on('clear', ({ roomId }) => {
    const room = getRoom(roomId);
    room.strokes = [];
    socket.to(roomId).emit('clear');
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;

    if (socket.data.role === 'teacher') {
      room.teacher = null;
      io.to(roomId).emit('teacher-disconnected');
    } else if (room.students.has(socket.id)) {
      room.students.delete(socket.id);
    }

    io.to(roomId).emit('room-users', {
      teacher: room.teacher,
      students: Array.from(room.students.values())
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});
