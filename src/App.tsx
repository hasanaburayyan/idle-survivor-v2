import { tables } from './module_bindings';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import AuthScreen from './components/AuthScreen';
import HomeScreen from './components/HomeScreen';

function App() {
  const { isActive } = useSpacetimeDB();
  const [sessions, isReady] = useTable(tables.mySession);

  if (!isActive || !isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <p className="text-sm">Connecting…</p>
      </div>
    );
  }

  const session = sessions[0];
  return session ? <HomeScreen username={session.username} /> : <AuthScreen />;
}

export default App;
