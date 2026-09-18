import { useState } from 'react';
import Login from './Login.jsx';
import Whiteboard from './Whiteboard.jsx';
import './App.css';

export default function App() {
  const [session, setSession] = useState(null);

  if (!session) {
    return <Login onLogin={(session) => setSession(session)} />;
  }

  return (
    <Whiteboard
      role={session.role}
      name={session.name}
      roomId={session.roomId}
    />
  );
}
