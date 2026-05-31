import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    // SECURITY PATCH 1: Hanya izinkan metode GET untuk mencegah penyalahgunaan endpoint
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    // PERFORMANCE PATCH: Gunakan Cache agar server tidak jebol jika pengunjung ramai
    // Menyimpan memori di server selama 1 jam, sehingga menghemat kuota Supabase Anda
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Mengambil dari wadah bernama 'logos' di Supabase Storage
        const { data: files, error } = await supabase
            .storage
            .from('logos') 
            .list(); 

        if (error) throw new Error('Gagal mengakses penyimpanan'); // Menyamarkan error database

        // Membuang file sampah/placeholder
        const validFiles = (files || []).filter(file => file.name !== '.emptyFolderPlaceholder');

        // Merakit URL gambar agar bisa dibaca oleh HTML
        const logoUrls = validFiles.map(file => {
            const { data: publicUrlData } = supabase
                .storage
                .from('logos')
                .getPublicUrl(file.name);
                
            return {
                name: file.name,
                url: publicUrlData.publicUrl
            };
        });

        // Kirim ke website Anda
        return res.status(200).json(logoUrls);
        
    } catch (error) {
        console.error("Logos API Error:", error);
        // SECURITY PATCH 2: Jangan ekspos detail error internal Supabase ke publik
        return res.status(500).json({ error: 'Terjadi kesalahan saat memuat logo.' });
    }
}
