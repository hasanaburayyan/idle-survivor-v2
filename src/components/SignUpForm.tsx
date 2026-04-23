import { FormEvent, useMemo, useState } from 'react';
import { reducers, tables } from '../module_bindings';
import { useReducer, useTable } from 'spacetimedb/react';
import { useAuthUiStore } from '../store/authUiStore';

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

function normalize(username: string): string {
  return username.trim().toLowerCase();
}

export default function SignUpForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lastAuthError = useAuthUiStore(s => s.lastAuthError);
  const setLastAuthError = useAuthUiStore(s => s.setLastAuthError);
  const clearAuthError = useAuthUiStore(s => s.clearAuthError);

  const [directory] = useTable(tables.usernameDirectory);
  const taken = useMemo(
    () => new Set(directory.map(r => r.username)),
    [directory]
  );

  const signup = useReducer(reducers.signup);

  const normalized = normalize(username);
  const usernameTooShort =
    normalized.length > 0 && normalized.length < MIN_USERNAME_LENGTH;
  const usernameTooLong = normalized.length > MAX_USERNAME_LENGTH;
  const usernameInvalidChars =
    normalized.length >= MIN_USERNAME_LENGTH &&
    !USERNAME_PATTERN.test(normalized);
  const usernameIsTaken =
    normalized.length >= MIN_USERNAME_LENGTH && taken.has(normalized);

  let usernameHint: string | null = null;
  if (usernameTooShort)
    usernameHint = `At least ${MIN_USERNAME_LENGTH} characters`;
  else if (usernameTooLong)
    usernameHint = `At most ${MAX_USERNAME_LENGTH} characters`;
  else if (usernameInvalidChars)
    usernameHint = 'Only lowercase letters, numbers, and underscores';
  else if (usernameIsTaken) usernameHint = 'Username already taken';

  const passwordTooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordHint = passwordTooShort
    ? `At least ${MIN_PASSWORD_LENGTH} characters`
    : null;

  const canSubmit =
    normalized.length >= MIN_USERNAME_LENGTH &&
    !usernameTooLong &&
    !usernameInvalidChars &&
    !usernameIsTaken &&
    password.length >= MIN_PASSWORD_LENGTH &&
    !submitting;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    clearAuthError();
    setSubmitting(true);
    try {
      await signup({ username: normalized, password });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed';
      setLastAuthError(message);
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
        {usernameHint && (
          <p className="mt-1 text-xs text-rose-400">{usernameHint}</p>
        )}
        {!usernameHint && normalized.length >= MIN_USERNAME_LENGTH && (
          <p className="mt-1 text-xs text-emerald-400">Username is available</p>
        )}
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-300 mb-1">
          Password
        </span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          required
        />
        {passwordHint && (
          <p className="mt-1 text-xs text-rose-400">{passwordHint}</p>
        )}
      </label>
      {lastAuthError && (
        <p className="text-sm text-rose-400" role="alert">
          {lastAuthError}
        </p>
      )}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-700 disabled:cursor-not-allowed py-2 text-sm font-medium text-slate-950 transition"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
