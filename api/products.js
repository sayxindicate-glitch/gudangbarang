import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    // SECURITY PATCH 1: Batasi API agar HANYA menerima metode GET (Mencegah penyalahgunaan)
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    // PERFORMANCE PATCH: Terapkan sistem Caching
    // Menyimpan data produk di memori peladen sementara (60 detik) untuk mencegah Server Down / DoS
    // sekaligus sangat menghemat kuota pembacaan database Supabase Anda.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    // Vercel akan mengambil kunci rahasia ini dari Environment Variables,
    // sehingga sama sekali tidak terekspos ke frontend HTML Anda.
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Menarik data dari tabel gg_products yang sudah kita buat
        const { data, error } = await supabase
            .from('gg_products')
            .select('*')
            .order('id', { ascending: true });

        // SECURITY PATCH 2: Menyamarkan error database
        if (error) throw new Error('Gagal mengakses data katalog');
        
        // Mengirimkan data dalam bentuk JSON ke website
        return res.status(200).json(data || []);
    } catch (error) {
        console.error("Products API Error:", error);
        // SECURITY PATCH 3: Mencegah Information Disclosure ke peretas
        return res.status(500).json({ error: 'Terjadi kesalahan sistem saat memuat produk.' });
    }
}
