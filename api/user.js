import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Akses ditolak: Tidak ada tiket sesi.' });
    }
    const token = authHeader.split(' ')[1];

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Menarik Kunci Master dari Vercel

    // Koneksi standar untuk mengecek apakah tiket pengguna valid
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi tidak valid, silakan login ulang.');

        // JIKA MINTA DATA UNTUK DITAMPILKAN
        if (req.method === 'GET') {
            return res.status(200).json({
                email: user.email,
                name: user.user_metadata.full_name || '',
                phone: user.user_metadata.phone || '',
                address: user.user_metadata.address || ''
            });
        } 
        
        // JIKA TOMBOL "SIMPAN" DITEKAN PENGGUNA
        else if (req.method === 'PUT') {
            if (!supabaseServiceKey) {
                throw new Error('Kunci Master belum dipasang di Vercel!');
            }

            const { name, phone, address } = req.body;
            
            // Buat koneksi Kunci Master khusus untuk operasi penyimpanan ini
            const adminAuthClient = createClient(supabaseUrl, supabaseServiceKey, {
                auth: { autoRefreshToken: false, persistSession: false }
            });

            // Menyimpan paksa pembaruan data pengguna
            const { error: updateError } = await adminAuthClient.auth.admin.updateUserById(
                user.id, 
                { user_metadata: { full_name: name, phone: phone, address: address } }
            );

            if (updateError) throw updateError;
            return res.status(200).json({ message: 'Profil berhasil diperbarui!' });
        } 
        
        else {
            return res.status(405).json({ error: 'Metode tidak diizinkan' });
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
