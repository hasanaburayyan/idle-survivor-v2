import { ScrollView, Text, View } from 'react-native';
import GroupLobby from './GroupLobby';

const SECTIONS = ['Friends', 'Guild', 'Recent'];

export default function SocialTab() {
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
      <GroupLobby />
      {SECTIONS.map(name => (
        <View
          key={name}
          className="rounded-2xl bg-slate-900 border border-slate-800 px-5 py-6"
        >
          <Text className="text-xs uppercase tracking-widest text-slate-500">
            {name}
          </Text>
          <Text className="text-sm text-slate-400 mt-1">Coming soon.</Text>
        </View>
      ))}
    </ScrollView>
  );
}
