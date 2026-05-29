import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    // Memastikan hanya menerima data yang dikirim via metode POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    // Kunci Rahasia ditarik langsung dari brankas Vercel (Environment Variables)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Menerima data email, password, aksi, DAN NAMA dari website
    const { action, email, password, name } = req.body;

    try {
        if (action === 'register') {
            // Mendaftarkan akun sekaligus menyimpan nama ke dalam User Metadata
            const { data, error } = await supabase.auth.signUp({ 
                email, 
                password,
                options: {
                    data: {
                        full_name: name 
                    }
                }
            });
            
            if (error) throw error;
            return res.status(200).json({ message: 'Pendaftaran berhasil', data });
            
        } else if (action === 'login') {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            // Jika berhasil, kirimkan "Tiket Sesi" ke website
            return res.status(200).json({ message: 'Login berhasil', session: data.session });
            
        } else {
            return res.status(400).json({ error: 'Aksi tidak dikenali' });
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
