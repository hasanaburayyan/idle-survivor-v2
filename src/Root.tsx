import { ActivityIndicator, View } from 'react-native';
import { tables } from './module_bindings';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import AuthScreen from './components/AuthScreen';
import HomeScreen from './components/HomeScreen';

export default function Root() {
  const { isActive } = useSpacetimeDB();
  const [sessions, isReady] = useTable(tables.mySession);

  if (!isActive || !isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  const session = sessions[0];
  return session ? <HomeScreen username={session.username} /> : <AuthScreen />;
}
