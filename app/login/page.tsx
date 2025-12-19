'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Loader2, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError('Incorrect password');
        setPassword('');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#18181b] px-4">
      <div className="w-full max-w-sm">
        {/* Logo/Icon */}
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <Lock className="w-8 h-8 text-zinc-400" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold text-center text-zinc-100 mb-2">
          GenUI for Archives
        </h1>
        <p className="text-zinc-500 text-center mb-8">
          Enter password to continue
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              disabled={isLoading}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl 
                         text-zinc-100 placeholder-zinc-500
                         focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-transparent
                         disabled:opacity-50 transition-all"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full py-3 px-4 bg-zinc-100 text-zinc-900 font-medium rounded-xl
                       hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              <span>Enter</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

