import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnon = process.env.SUPABASE_ANON_KEY;
    const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY; 

    const supabase = createClient(supabaseUrl, supabaseAnon);
    const { action, email, password, name, nickname, phone, address } = req.body;

    try {
        if (action === 'register') {
            // Mendaftar akun
            const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
            if (authError) throw authError;

            // Simpan profil menggunakan Kunci Master agar pasti berhasil masuk!
            if (authData && authData.user) {
                const adminClient = createClient(supabaseUrl, supabaseService);
                const { error: profileError } = await adminClient.from('profiles').upsert({
                    id: authData.user.id,
                    email: email,
                    nama_lengkap: name,
                    nama_panggilan: nickname,
                    no_wa: phone,
                    alamat_lengkap: address
                });
                if (profileError) throw profileError;
            }
            return res.status(200).json({ message: 'Pendaftaran berhasil', user: authData.user });
        } 
        
        else if (action === 'login') {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
            if (authError) throw authError;

            const { data: profile } = await supabase.from('profiles').select('nama_lengkap, nama_panggilan').eq('id', authData.user.id).single();
            const displayName = (profile && profile.nama_panggilan) ? profile.nama_panggilan : (profile && profile.nama_lengkap) ? profile.nama_lengkap : authData.user.email;

            return res.status(200).json({ 
                message: 'Login berhasil', 
                session: authData.session,
                access_token: authData.session.access_token,
                user: authData.user,
                name: displayName
            });
        }

        else if (action === 'reset_password') {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
            if (resetError) throw resetError;
            return res.status(200).json({ message: 'Tautan reset password berhasil dikirim.' });
        }
        else { return res.status(400).json({ error: 'Aksi tidak dikenali' }); }

    } catch (error) {
        if (error.message.includes('already registered')) return res.status(400).json({ error: 'Email ini sudah terdaftar! Silakan ke halaman Login.' });
        return res.status(400).json({ error: error.message });
    }
}
