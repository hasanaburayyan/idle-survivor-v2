import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
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

  let usernameHint: { text: string; ok: boolean } | null = null;
  if (usernameTooShort)
    usernameHint = {
      text: `At least ${MIN_USERNAME_LENGTH} characters`,
      ok: false,
    };
  else if (usernameTooLong)
    usernameHint = {
      text: `At most ${MAX_USERNAME_LENGTH} characters`,
      ok: false,
    };
  else if (usernameInvalidChars)
    usernameHint = {
      text: 'Only lowercase letters, numbers, and underscores',
      ok: false,
    };
  else if (usernameIsTaken)
    usernameHint = { text: 'Username already taken', ok: false };
  else if (normalized.length >= MIN_USERNAME_LENGTH)
    usernameHint = { text: 'Username is available', ok: true };

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

  const onSubmit = async () => {
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
    <View className="gap-4">
      <View>
        <Text className="text-xs font-medium text-slate-300 mb-1">
          Username
        </Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
          placeholderTextColor="#64748b"
        />
        {usernameHint ? (
          <Text
            className={`mt-1 text-xs ${
              usernameHint.ok ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {usernameHint.text}
          </Text>
        ) : null}
      </View>
      <View>
        <Text className="text-xs font-medium text-slate-300 mb-1">
          Password
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
          placeholderTextColor="#64748b"
        />
        {passwordHint ? (
          <Text className="mt-1 text-xs text-rose-400">{passwordHint}</Text>
        ) : null}
      </View>
      {lastAuthError ? (
        <Text className="text-sm text-rose-400">{lastAuthError}</Text>
      ) : null}
      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit}
        className={`rounded-lg py-3 items-center ${
          canSubmit ? 'bg-emerald-500' : 'bg-slate-800'
        }`}
      >
        <Text
          className={`text-sm font-medium ${
            canSubmit ? 'text-slate-950' : 'text-slate-500'
          }`}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </Text>
      </Pressable>
    </View>
  );
}
