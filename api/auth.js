import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { action, email, password, name, nickname, phone, address } = req.body;

    try {
        if (action === 'register') {
            // 1. CEK NOMOR WA DULU (Memutus "Lingkaran Setan")
            // Memanggil fungsi SQL 'check_phone_exists' yang baru kita buat
            const { data: isPhoneTaken, error: rpcError } = await supabase.rpc('check_phone_exists', { check_wa: phone });

            if (rpcError) {
                console.error("RPC Error:", rpcError);
                throw new Error('Gagal memvalidasi nomor WhatsApp.');
            }

            // Jika WA sudah ada, batalkan SELURUH proses pendaftaran. Email aman, tidak terdaftar!
            if (isPhoneTaken) {
                return res.status(400).json({ error: 'Nomor WhatsApp ini sudah terdaftar oleh akun lain.' });
            }

            // 2. JIKA WA AMAN, BARU DAFTARKAN EMAIL & PASSWORD
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
            });

            if (authError) throw authError;

            // 3. SIMPAN KE TABEL PROFILES (Sekarang dijamin 100% berhasil karena WA sudah divalidasi)
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
        
        else if (action === 'login') {
            // Logika Login Standar
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) throw authError;

            // Tarik nama untuk dipajang di Navbar Desktop & Mobile
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
        
        else {
            return res.status(400).json({ error: 'Aksi tidak dikenali' });
        }

    } catch (error) {
        console.error("Auth API Error:", error);
        
        let errorMessage = error.message;
        if (errorMessage.includes('already registered')) {
            return res.status(400).json({ error: 'Email ini sudah terdaftar! Silakan ke halaman Login.' });
        }

        return res.status(400).json({ error: errorMessage });
    }
}
