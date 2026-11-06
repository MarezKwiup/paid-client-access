import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function LoginForm() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function signIn() {
        setBusy(true);
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
        setBusy(false);
    }

    return (
        <form className="card login" onSubmit={(e) => {
            e.preventDefault();
            void signIn()
        }}>
            <h1>Client Portal</h1>
            <p className='muted'>Sign in to view and purchase your documents.</p>
            <label>
                Email
                <input type='email' value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete='email' />
            </label>
            <label>
                Password
                <input
                    type='password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete='current-password'
                />
            </label>
            {error && <p className='error'>{error}</p>}
            <button type='submit' disabled={busy}>
                {busy ? 'Signing in...' : 'Sign in'}
            </button>
        </form>
    );
}