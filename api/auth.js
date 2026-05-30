import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { action, email, password, name, nickname, phone, address } = req.body;

    try {
        // --- LOGIKA PENDAFTARAN ---
        if (action === 'register') {
            const { data: isPhoneTaken, error: rpcError } = await supabase.rpc('check_phone_exists', { check_wa: phone });

            if (rpcError) {
                console.error("RPC Error:", rpcError);
                throw new Error('Gagal memvalidasi nomor WhatsApp.');
            }

            if (isPhoneTaken) {
                return res.status(400).json({ error: 'Nomor WhatsApp ini sudah terdaftar oleh akun lain.' });
            }

            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
            });

            if (authError) throw authError;

            if (authData && authData.session) {
                const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
                    global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } }
                });

                const { error: profileError } = await userClient
                    .from('profiles')
                    .upsert({
                        id: authData.user.id,
                        email: email,
                        nama_lengkap: name,
                        nama_panggilan: nickname,
                        no_wa: phone,
                        alamat_lengkap: address
                    }, { onConflict: 'id' });
                
                if (profileError) {
                    throw new Error(profileError.message);
                }
            }

            return res.status(200).json({ message: 'Pendaftaran berhasil', user: authData.user });
        } 
        
        // --- LOGIKA LOGIN ---
        else if (action === 'login') {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) throw authError;

            const { data: profile } = await supabase
                .from('profiles')
                .select('nama_lengkap, nama_panggilan')
                .eq('id', authData.user.id)
                .single();

            const displayName = (profile && profile.nama_panggilan) ? profile.nama_panggilan : 
                                (profile && profile.nama_lengkap) ? profile.nama_lengkap : authData.user.email;

            return res.status(200).json({ 
                message: 'Login berhasil', 
                access_token: authData.session.access_token,
                user: authData.user,
                name: displayName
            });
        }

        // --- LOGIKA LUPA PASSWORD (BARU) ---
        else if (action === 'reset_password') {
            // Perintahkan Supabase untuk mengirimkan email reset
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
            
            if (resetError) throw resetError;
            
            return res.status(200).json({ message: 'Tautan reset password berhasil dikirim.' });
        }
        
        else {
            return res.status(400).json({ error: 'Aksi tidak dikenali' });
        }

    } catch (error) {
        console.error("Auth API Error:", error);
        
        let errorMessage = error.message;
        if (errorMessage.includes('already registered')) {
            return res.status(400).json({ error: 'Email ini sudah terdaftar! Silakan ke halaman Login.' });
        }
        // Jika ada pengguna yang meminta reset password tapi emailnya belum terdaftar
        if (errorMessage.includes('User not found')) {
            return res.status(400).json({ error: 'Alamat email tidak ditemukan di database kami.' });
        }

        return res.status(400).json({ error: errorMessage });
    }
}
