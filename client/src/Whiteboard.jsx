import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { PEER_CONFIG } from './Login.jsx';
import './Whiteboard.css';

const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL || window.location.origin;

export default function Whiteboard({ role, name, roomId }) {
  const svgRef = useRef(null);
  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const strokesRef = useRef([]);
  const remotePeerRef = useRef(null);
  const useDataChannelRef = useRef(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('Connecting...');
  const [teacherOnline, setTeacherOnline] = useState(false);
  const [students, setStudents] = useState([]);

  useEffect(() => {
    const socket = io(SIGNALING_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { roomId, role, name });
    });

    socket.on('existing-strokes', (strokes) => {
      strokesRef.current = [...strokes];
      redraw();
    });

    socket.on('existing-students', (students) => {
      if (role === 'teacher') {
        students.forEach((s) => handleNewStudent(s.socketId, s.name));
      }
    });

    socket.on('new-student', ({ socketId, name }) => {
      if (role === 'teacher') {
        handleNewStudent(socketId, name);
      }
    });

    socket.on('teacher-disconnected', () => {
      setTeacherOnline(false);
      setStatus('Teacher left the room');
    });

    socket.on('room-users', ({ teacher, students }) => {
      setTeacherOnline(!!teacher);
      setStudents(students || []);
    });

    socket.on('offer', async ({ from, offer }) => {
      if (role === 'teacher') return;
      remotePeerRef.current = from;
      await initPeerAsStudent();
      await pcRef.current.setRemoteDescription(offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer });
    });

    socket.on('answer', async ({ from, answer }) => {
      remotePeerRef.current = from;
      await pcRef.current.setRemoteDescription(answer);
    });

    socket.on('ice-candidate', ({ from, candidate }) => {
      try {
        pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Failed to add ice candidate', e);
      }
    });

    socket.on('stroke', (stroke) => {
      if (!useDataChannelRef.current) {
        addStroke(stroke, false);
      }
    });

    socket.on('clear', () => {
      if (!useDataChannelRef.current) {
        strokesRef.current = [];
        redraw();
      }
    });

    return () => {
      dataChannelRef.current?.close();
      pcRef.current?.close();
      socket.disconnect();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  function initPeerAsStudent() {
    if (pcRef.current) return Promise.resolve();

    const pc = new RTCPeerConnection(PEER_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && remotePeerRef.current) {
        socketRef.current.emit('ice-candidate', {
          to: remotePeerRef.current,
          candidate
        });
      }
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      dataChannelRef.current = dc;

      dc.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'stroke') {
          addStroke(data.stroke, false);
        } else if (data.type === 'clear') {
          strokesRef.current = [];
          redraw();
        } else if (data.type === 'existing') {
          strokesRef.current = [...data.strokes];
          redraw();
          useDataChannelRef.current = true;
        }
      };

      dc.onopen = () => {
        setIsConnected(true);
        setStatus('Connected to teacher');
      };
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    return Promise.resolve();
  }

   async function handleNewStudent(studentSocketId, studentName) {
    if (!localStreamRef.current) {
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.muted = true;
        }
      } catch (e) {
        console.warn('Camera access denied:', e);
        setStatus('Camera access denied');
      }
    }

    const pc = new RTCPeerConnection(PEER_CONFIG);
    pcRef.current = pc;
    remotePeerRef.current = studentSocketId;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && studentSocketId) {
        socketRef.current.emit('ice-candidate', {
          to: studentSocketId,
          candidate
        });
      }
    };

    const dc = pc.createDataChannel('whiteboard');
    dataChannelRef.current = dc;

    dc.onopen = async () => {
      setIsConnected(true);
      setStatus(`Connected to ${studentName || 'student'}`);
      dc.send(
        JSON.stringify({ type: 'existing', strokes: strokesRef.current })
      );
    };

    dc.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === 'existing') {
        strokesRef.current = [...data.strokes];
        redraw();
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit('offer', { to: studentSocketId, offer });
  }

  function sendViaChannel(type, payload) {
    const dcMessage = { type, ...payload };
    const socketPayload = { ...payload, roomId };

    if (
      dataChannelRef.current &&
      dataChannelRef.current.readyState === 'open'
    ) {
      dataChannelRef.current.send(JSON.stringify(dcMessage));
    } else {
      socketRef.current.emit(type, socketPayload);
    }
  }

  function redraw() {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = '';
    strokesRef.current.forEach((stroke) => {
      const path = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path'
      );
      path.setAttribute('d', stroke.path);
      path.setAttribute('stroke', stroke.color);
      path.setAttribute('stroke-width', stroke.width);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    });
  }

  function addStroke(stroke, isLocal = true) {
    strokesRef.current.push(stroke);
    if (isLocal) {
      const svg = svgRef.current;
      if (!svg) return;
      const path = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path'
      );
      path.setAttribute('d', stroke.path);
      path.setAttribute('stroke', stroke.color);
      path.setAttribute('stroke-width', stroke.width);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    } else {
      redraw();
    }
  }

  function getRelativePos(e) {
    const rect = svgRef.current.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function pathFromPoints(points) {
    if (points.length < 2) return '';
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
    }
    return d;
  }

  function startDrawing(e) {
    e.preventDefault();
    drawingRef.current = true;
    lastPointRef.current = getRelativePos(e);
  }

  function draw(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const pos = getRelativePos(e);
    const stroke = {
      path: pathFromPoints([lastPointRef.current, pos]),
      color: '#38bdfa',
      width: 4
    };
    addStroke(stroke, true);
    sendViaChannel('stroke', { stroke });
    lastPointRef.current = pos;
  }

  function stopDrawing() {
    drawingRef.current = false;
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    svg.addEventListener('mousedown', startDrawing);
    svg.addEventListener('mousemove', draw);
    svg.addEventListener('mouseup', stopDrawing);
    svg.addEventListener('mouseleave', stopDrawing);
    svg.addEventListener('touchstart', startDrawing, { passive: false });
    svg.addEventListener('touchmove', draw, { passive: false });
    svg.addEventListener('touchend', stopDrawing);

    return () => {
      svg.removeEventListener('mousedown', startDrawing);
      svg.removeEventListener('mousemove', draw);
      svg.removeEventListener('mouseup', stopDrawing);
      svg.removeEventListener('mouseleave', stopDrawing);
      svg.removeEventListener('touchstart', startDrawing);
      svg.removeEventListener('touchmove', draw);
      svg.removeEventListener('touchend', stopDrawing);
    };
  }, []);

  function handleClear() {
    strokesRef.current = [];
    redraw();
    sendViaChannel('clear', {});
  }

  const canDraw = role === 'teacher';

  return (
    <div className="whiteboard-page">
      <div className="whiteboard-toolbar">
        <div className="toolbar-left">
          <span className="role-badge">
            {name} ({role})
          </span>
        </div>
        <div className="toolbar-right">
          <span
            className={`status-dot ${isConnected ? 'online' : ''}`}
          ></span>
          <span className="status-text">{status}</span>
          <button
            className="clear-button"
            onClick={handleClear}
            disabled={!canDraw}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="whiteboard-layout">
        <div
          className={`whiteboard-area ${role === 'student' ? 'student' : ''}`}
        >
          <svg ref={svgRef} className="whiteboard-svg"></svg>
        </div>

        <div className="sidebar">
          <h3>Room Info</h3>
          <div className="teacher-status">
            <div className="label">Teacher</div>
            <div
              className={`value ${teacherOnline ? 'online' : 'offline'}`}
            >
              {teacherOnline ? 'Online' : 'Offline'}
            </div>
          </div>

          <video
            ref={localVideoRef}
            className="teacher-video-sidebar"
            autoPlay
            playsInline
            muted
            style={{ display: role === 'teacher' ? 'block' : 'none' }}
          />

          <video
            ref={remoteVideoRef}
            className="teacher-video-sidebar"
            autoPlay
            playsInline
            style={{ display: role === 'student' ? 'block' : 'none' }}
          />

          {role === 'teacher' && (
            <>
              <div className="connection-info">
                <div className="label">WebRTC Data Channel</div>
                <div className="value">
                  {isConnected ? 'Connected' : 'Waiting for students...'}
                </div>
              </div>

              <h3>Students ({students.length})</h3>
              <div className="student-list">
                {students.length === 0 ? (
                  <span className="student-item">No students connected</span>
                ) : (
                  students.map((student, i) => (
                    <span key={i} className="student-item">
                      {student}
                    </span>
                  ))
                )}
              </div>
            </>
          )}

          {role === 'student' && teacherOnline && (
            <div className="connection-info">
              <div className="label">Connection</div>
              <div className="value">
                {isConnected
                  ? 'Connected to teacher'
                  : 'Connecting...'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
