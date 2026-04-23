import { FormEvent, useState } from 'react';
import { reducers } from '../module_bindings';
import { useReducer } from 'spacetimedb/react';
import { useAuthUiStore } from '../store/authUiStore';

export default function SignInForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lastAuthError = useAuthUiStore(s => s.lastAuthError);
  const setLastAuthError = useAuthUiStore(s => s.setLastAuthError);
  const clearAuthError = useAuthUiStore(s => s.clearAuthError);

  const login = useReducer(reducers.login);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    clearAuthError();
    setSubmitting(true);
    try {
      await login({ username, password });
    } catch {
      setLastAuthError('Invalid username or password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="block text-xs font-medium text-slate-300 mb-1">
          Username
        </span>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          required
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-300 mb-1">
          Password
        </span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          required
        />
      </label>
      {lastAuthError && (
        <p className="text-sm text-rose-400" role="alert">
          {lastAuthError}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-700 disabled:cursor-not-allowed py-2 text-sm font-medium text-slate-950 transition"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
