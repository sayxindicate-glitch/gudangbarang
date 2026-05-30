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

            if (dbError && dbError.code !== 'PGRST116') { // Abaikan error jika baris belum ada
                return res.status(500).json({ error: dbError.message });
            }

            // Jika baris profil belum ada, kembalikan data dasar dari Auth
            if (!profile) {
                return res.status(200).json({ email: user.email });
            }

            return res.status(200).json(profile);
        }

        // --- JIKA REQUEST PUT (SIMPAN PERUBAHAN PROFIL) ---
        if (req.method === 'PUT') {
            // jenis_kelamin sudah dihapus agar sinkron dengan frontend
            const { nama_lengkap, nama_panggilan, no_wa, alamat_lengkap } = req.body;

            // Update atau Insert (Upsert) ke tabel profiles
            const { data, error: updateError } = await supabase
                .from('profiles')
                .upsert({
                    id: user.id, // Pastikan ID sama dengan user auth
                    email: user.email, // Email dikunci dari auth asli
                    nama_lengkap,
                    nama_panggilan,
                    no_wa,
                    alamat_lengkap,
                    created_at: new Date().toISOString()
                }, { onConflict: 'id' })
                .select()
                .single();

            if (updateError) {
                // Tangani error jika nomor WA sudah dipakai akun lain (UNIQUE constraint)
                if (updateError.code === '23505') {
                    return res.status(400).json({ error: 'Nomor WhatsApp sudah digunakan oleh akun lain.' });
                }
                return res.status(500).json({ error: updateError.message });
            }

            return res.status(200).json({ message: 'Profil berhasil diperbarui', profile: data });
        }

        return res.status(405).json({ error: 'Metode tidak diizinkan' });

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan internal server' });
    }
}
