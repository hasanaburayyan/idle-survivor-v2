import { Text, View } from 'react-native';

const SECTIONS = ['Friends', 'Guild', 'Recent'];

export default function SocialTab() {
  return (
    <View className="flex-1 px-6 py-6 gap-3">
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
    </View>
  );
}
