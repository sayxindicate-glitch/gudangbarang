import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnon = process.env.SUPABASE_ANON_KEY;
    const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY; // Kunci Master

    const supabase = createClient(supabaseUrl, supabaseAnon);
    const { action, email, password, name, nickname, phone, address } = req.body;

    try {
        // --- LOGIKA PENDAFTARAN ---
        if (action === 'register') {
            // Lapis 1: Deteksi Awal WA Kembar
            const { data: isPhoneTaken } = await supabase.rpc('check_phone_exists', { check_wa: phone });
            if (isPhoneTaken) {
                return res.status(400).json({ error: 'Nomor WhatsApp ini sudah terdaftar oleh akun lain.' });
            }

            // Mendaftarkan Email & Password ke Auth Inti
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
            });

            if (authError) throw authError;

            // Lapis 2: Mengisi Tabel Profil (Dengan Kunci Master)
            if (authData && authData.user) {
                const adminClient = createClient(supabaseUrl, supabaseService);

                const { error: profileError } = await adminClient
                    .from('profiles')
                    .upsert({
                        id: authData.user.id,
                        email: email,
                        nama_lengkap: name,
                        nama_panggilan: nickname,
                        no_wa: phone,
                        alamat_lengkap: address
                    }, { onConflict: 'id' });
                
                // JIKA PENGISIAN PROFIL GAGAL (Ditendang oleh Gembok Unik Database)
                if (profileError) {
                    // FITUR ROLLBACK: Segera hancurkan akun dari sistem Auth agar email tidak nyangkut!
                    await adminClient.auth.admin.deleteUser(authData.user.id);
                    
                    if (profileError.code === '23505') { // 23505 adalah kode Postgres untuk Unique Violation
                        return res.status(400).json({ error: 'Nomor WhatsApp sudah digunakan. Silakan gunakan nomor lain.' });
                    }
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
                name: displayName,
                session: authData.session
            });
        }

        // --- LOGIKA LUPA PASSWORD ---
        else if (action === 'reset_password') {
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
        if (errorMessage.includes('User not found')) {
            return res.status(400).json({ error: 'Alamat email tidak ditemukan di database kami.' });
        }

        return res.status(400).json({ error: errorMessage });
    }
}
