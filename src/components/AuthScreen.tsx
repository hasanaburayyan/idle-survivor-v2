import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import SafePressable from './SafePressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthUiStore } from '../store/authUiStore';
import SignInForm from './SignInForm';
import SignUpForm from './SignUpForm';

export default function AuthScreen() {
  const mode = useAuthUiStore(s => s.mode);
  const setMode = useAuthUiStore(s => s.setMode);

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 items-center justify-center p-6"
      >
        <View className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <Text className="text-3xl font-bold text-center text-slate-100 mb-1">
            Idle Survivor
          </Text>
          <Text className="text-sm text-slate-400 text-center mb-6">
            {mode === 'signin'
              ? 'Sign in to continue'
              : 'Create an account to get started'}
          </Text>

          <View className="flex-row mb-6 rounded-lg bg-slate-800 p-1">
            <ModeTab
              label="Sign in"
              active={mode === 'signin'}
              onPress={() => setMode('signin')}
            />
            <ModeTab
              label="Sign up"
              active={mode === 'signup'}
              onPress={() => setMode('signup')}
            />
          </View>

          {mode === 'signin' ? <SignInForm /> : <SignUpForm />}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ModeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <SafePressable
      onPress={onPress}
      className={`flex-1 rounded-md py-2 items-center ${
        active ? 'bg-slate-950' : ''
      }`}
    >
      <Text
        className={`text-sm ${
          active ? 'text-white font-semibold' : 'text-slate-400'
        }`}
      >
        {label}
      </Text>
    </SafePressable>
  );
}
