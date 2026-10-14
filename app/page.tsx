'use client';
import { AuthScreen, useToken } from './auth';
import Chat from './chat';

export default function Home() {
  const { token, login, logout } = useToken();
  if (token === undefined) return null;
  return token ? <Chat token={token} onLogout={logout} /> : <AuthScreen onLogin={login} />;
}
