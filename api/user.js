import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Akses ditolak: Token hilang' });
    }
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        // Validasi Token
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return res.status(401).json({ error: 'Sesi tidak valid' });
        }

        // --- JIKA REQUEST GET (AMBIL DATA PROFIL) ---
        if (req.method === 'GET') {
            const { data: profile, error: dbError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            // SECURITY PATCH: Menyamarkan pesan error database
            if (dbError && dbError.code !== 'PGRST116') { 
                return res.status(500).json({ error: 'Gagal memuat profil' }); 
            }

            if (!profile) {
                return res.status(200).json({ email: user.email });
            }

            return res.status(200).json(profile);
        }

        // --- JIKA REQUEST PUT (SIMPAN PERUBAHAN PROFIL) ---
        if (req.method === 'PUT') {
            const { nama_lengkap, nama_panggilan, no_wa, alamat_lengkap } = req.body;

            // SECURITY PATCH: Batasi panjang input (Mencegah Database Overload / DoS)
            if (nama_lengkap && nama_lengkap.length > 100) return res.status(400).json({ error: 'Nama terlalu panjang' });
            if (nama_panggilan && nama_panggilan.length > 50) return res.status(400).json({ error: 'Panggilan terlalu panjang' });
            if (no_wa && no_wa.length > 20) return res.status(400).json({ error: 'Nomor WA tidak valid' });
            if (alamat_lengkap && alamat_lengkap.length > 500) return res.status(400).json({ error: 'Alamat terlalu panjang' });

            // Update atau Insert (Upsert) ke tabel profiles
            const { data, error: updateError } = await supabase
                .from('profiles')
                .upsert({
                    id: user.id, 
                    email: user.email, 
                    nama_lengkap,
                    nama_panggilan,
                    no_wa,
                    alamat_lengkap,
                    created_at: new Date().toISOString()
                }, { onConflict: 'id' })
                .select()
                .single();

            if (updateError) {
                if (updateError.code === '23505') {
                    return res.status(400).json({ error: 'Nomor WhatsApp sudah digunakan oleh akun lain.' });
                }
                // SECURITY PATCH: Menyamarkan pesan error jika gagal simpan
                return res.status(500).json({ error: 'Gagal memperbarui profil di server' }); 
            }

            return res.status(200).json({ message: 'Profil berhasil diperbarui', profile: data });
        }

        return res.status(405).json({ error: 'Metode tidak diizinkan' });

    } catch (error) {
        console.error("User API Error:", error);
        // SECURITY PATCH: Filter terakhir agar peretas tidak melihat detail sistem
        return res.status(500).json({ error: 'Terjadi kesalahan internal server' });
    }
}
