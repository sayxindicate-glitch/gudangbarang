import { createClient } from '@supabase/supabase-js';

// Konfigurasi koneksi ke Supabase mengambil dari Environment Variables Vercel
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
    // 1. Mencegah akses selain metode GET (Mengambil Data)
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    // 2. LAPISAN KEAMANAN: Tangkap tiket (token) dari Frontend
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Akses ditolak: Token tidak ditemukan' });
    }
    const token = authHeader.split(' ')[1];

    try {
        // 3. LAPISAN KEAMANAN: Verifikasi tiket ke Supabase untuk mendapatkan Data User Asli
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        
        if (authError || !user) {
            return res.status(401).json({ error: 'Akses ditolak: Sesi kedaluwarsa atau tidak valid' });
        }

        // 4. AMBIL DATA PESANAN HANYA MILIK USER INI (user_id harus cocok)
        // Kita juga melakukan JOIN (menggabungkan) tabel gg_orders dengan gg_order_items
        const { data: orders, error: dbError } = await supabase
            .from('gg_orders')
            .select(`
                id,
                total_price,
                status,
                created_at,
                items:gg_order_items (
                    product_id,
                    product_name,
                    product_price,
                    product_img,
                    quantity
                )
            `)
            .eq('user_id', user.id) // <--- INI KUNCI KEAMANANNYA: Filter berdasarkan akun
            .order('created_at', { ascending: false }); // Urutkan dari yang terbaru

        if (dbError) {
            console.error("Database Error:", dbError);
            return res.status(500).json({ error: 'Gagal mengambil data dari database' });
        }

        // 5. Kembalikan data pesanan ke pesanan.html dengan sukses
        return res.status(200).json(orders);

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server' });
    }
}