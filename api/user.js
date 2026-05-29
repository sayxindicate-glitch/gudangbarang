import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    // 1. Tangkap 'Tiket Sesi' (Token) yang dikirim dari browser pengguna
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Akses ditolak: Tidak ada tiket sesi.' });
    }
    const token = authHeader.split(' ')[1]; // Mengambil tokennya saja

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    // 2. Buat koneksi ke Supabase khusus mewakili pengguna pemegang tiket ini
    const supabase = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        // Cek apakah tiket (token) valid dan belum kadaluarsa
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi tidak valid, silakan login ulang.');

        // JIKA BROWSER MINTA DATA (TAMPILKAN PROFIL)
        if (req.method === 'GET') {
            return res.status(200).json({
                email: user.email,
                name: user.user_metadata.full_name || '',
                phone: user.user_metadata.phone || '',
                address: user.user_metadata.address || ''
            });
        } 
        
        // JIKA BROWSER KIRIM DATA BARU (EDIT PROFIL)
        else if (req.method === 'PUT') {
            const { name, phone, address } = req.body;
            
            // Simpan perubahan ke dalam Supabase User Metadata
            const { data, error: updateError } = await supabase.auth.updateUser({
                data: { full_name: name, phone: phone, address: address }
            });

            if (updateError) throw updateError;
            return res.status(200).json({ message: 'Profil berhasil diperbarui!' });
        } 
        
        else {
            return res.status(405).json({ error: 'Metode tidak diizinkan' });
        }
    } catch (error) {
        return res.status(401).json({ error: error.message });
    }
}