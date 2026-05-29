import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Menangkap data baru yang dikirim dari form register
    const { action, email, password, name, nickname, phone, address } = req.body;

    try {
        if (action === 'register') {
            // Mendaftarkan user baru dan menyimpan SEMUA datanya ke Supabase User Metadata
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: { 
                        full_name: name,
                        nickname: nickname,
                        phone: phone,
                        address: address
                    }
                }
            });
            if (error) throw error;
            return res.status(200).json({ message: 'Pendaftaran berhasil', data });
            
        } else if (action === 'login') {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            return res.status(200).json({ message: 'Login berhasil', session: data.session });
            
        } else {
            return res.status(400).json({ error: 'Aksi tidak dikenali' });
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
