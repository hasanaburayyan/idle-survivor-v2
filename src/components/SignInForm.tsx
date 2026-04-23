import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
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

  const onSubmit = async () => {
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
          textContentType="password"
          className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100"
          placeholderTextColor="#64748b"
        />
      </View>
      {lastAuthError ? (
        <Text className="text-sm text-rose-400">{lastAuthError}</Text>
      ) : null}
      <Pressable
        onPress={onSubmit}
        disabled={submitting}
        className={`rounded-lg py-3 items-center ${
          submitting ? 'bg-emerald-700' : 'bg-emerald-500'
        }`}
      >
        <Text className="text-sm font-medium text-slate-950">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Text>
      </Pressable>
    </View>
  );
}
