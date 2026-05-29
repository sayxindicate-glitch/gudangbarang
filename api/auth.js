import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    // Memastikan hanya menerima request POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    // Mengambil kunci rahasia dari Vercel Environment Variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Menangkap data dari form HTML
    const { action, email, password, name } = req.body;

    try {
        if (action === 'register') {
            // Mendaftarkan user baru ke Supabase
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: { full_name: name } // Menyimpan nama user
                }
            });
            if (error) throw error;
            return res.status(200).json({ message: 'Pendaftaran berhasil', data });
            
        } else if (action === 'login') {
            // Memproses login
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            // Kirim tiket sesi ke browser
            return res.status(200).json({ message: 'Login berhasil', session: data.session });
            
        } else {
            return res.status(400).json({ error: 'Aksi tidak dikenali' });
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
