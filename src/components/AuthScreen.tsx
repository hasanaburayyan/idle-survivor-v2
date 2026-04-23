import { useAuthUiStore } from '../store/authUiStore';
import SignInForm from './SignInForm';
import SignUpForm from './SignUpForm';

export default function AuthScreen() {
  const mode = useAuthUiStore(s => s.mode);
  const setMode = useAuthUiStore(s => s.setMode);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-8">
        <h1 className="text-3xl font-bold mb-1 text-center">Idle Survivor</h1>
        <p className="text-sm text-slate-400 text-center mb-6">
          {mode === 'signin'
            ? 'Sign in to continue'
            : 'Create an account to get started'}
        </p>

        <div className="grid grid-cols-2 mb-6 rounded-lg bg-slate-800 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`rounded-md py-2 transition ${
              mode === 'signin'
                ? 'bg-slate-950 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`rounded-md py-2 transition ${
              mode === 'signup'
                ? 'bg-slate-950 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign up
          </button>
        </div>

        {mode === 'signin' ? <SignInForm /> : <SignUpForm />}
      </div>
    </div>
  );
}
