import { useState } from 'react';

const ROOM_ID = 'whiteboard-1';
const PEER_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function Login({ onLogin }) {
  const [selectedRole, setSelectedRole] = useState('');
  const [name, setName] = useState('');

  const handleLogin = () => {
    if (!selectedRole || !name.trim()) return;
    onLogin({ role: selectedRole, name: name.trim(), roomId: ROOM_ID });
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1 className="login-title">Whiteboard</h1>
        <p className="login-subtitle">Select your role and enter your name</p>

        <div className="role-group">
          <label className="role-label">
            <input
              type="radio"
              name="role"
              value="teacher"
              checked={selectedRole === 'teacher'}
              onChange={(e) => setSelectedRole(e.target.value)}
            />
            <span>Admin (Teacher)</span>
          </label>
          <label className="role-label">
            <input
              type="radio"
              name="role"
              value="student"
              checked={selectedRole === 'student'}
              onChange={(e) => setSelectedRole(e.target.value)}
            />
            <span>Student</span>
          </label>
        </div>

        <input
          type="text"
          className="name-input"
          placeholder="Enter your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
        />

        <button
          className="login-button"
          disabled={!selectedRole || !name.trim()}
          onClick={handleLogin}
        >
          Enter Whiteboard
        </button>
      </div>
    </div>
  );
}

export { PEER_CONFIG };
