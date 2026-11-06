function required(name: string, value: string | undefined): string {
    if (!value) throw new Error(`Missing ${name} in web/.env`);
    return value;
}

const supabaseKey = required('VITE_SUPABASE_PUBLISHABLE_KEY', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

if (supabaseKey.startsWith('sb_secret_')) {
    throw new Error('A supabase SECRET key is configured in the frontend. Use the publishable key.');
}

export const env = {
    supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
    supabaseKey,
    apiUrl: required('VITE_API_URL', import.meta.env.VITE_API_URL),
};

