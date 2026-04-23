import './global.css';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Identity } from 'spacetimedb';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, ErrorContext } from './src/module_bindings';
import Root from './src/Root';

const HOST =
  process.env.EXPO_PUBLIC_SPACETIMEDB_HOST ?? 'ws://127.0.0.1:3000';
const DB_NAME =
  process.env.EXPO_PUBLIC_SPACETIMEDB_DB_NAME ?? 'idle-survivor';
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

export default function App() {
  const [initialToken, setInitialToken] = useState<string | null | undefined>(
    undefined
  );

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY)
      .then(value => setInitialToken(value))
      .catch(() => setInitialToken(null));
  }, []);

  const connectionBuilder = useMemo(() => {
    if (initialToken === undefined) return null;
    return DbConnection.builder()
      .withUri(HOST)
      .withDatabaseName(DB_NAME)
      .withToken(initialToken ?? undefined)
      .onConnect((_conn, identity: Identity, token: string) => {
        AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
        console.log(
          'Connected to SpacetimeDB with identity:',
          identity.toHexString()
        );
      })
      .onDisconnect(() => console.log('Disconnected from SpacetimeDB'))
      .onConnectError((_ctx: ErrorContext, err: Error) =>
        console.log('Error connecting to SpacetimeDB:', err)
      );
  }, [initialToken]);

  if (!connectionBuilder) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
        <Root />
      </SpacetimeDBProvider>
    </SafeAreaProvider>
  );
}
