import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    // 1. Pastikan hanya menerima permintaan GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    // 2. Tangkap tiket keamanan dari pengguna
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Akses ditolak: Token hilang' });
    }
    const token = authHeader.split(' ')[1];

    // 3. Hubungkan ke Supabase menggunakan Token Pengguna (Membantu menembus RLS jika masih aktif)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        // Cek keaslian token
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return res.status(401).json({ error: 'Sesi tidak valid atau telah kedaluwarsa' });
        }

        // 4. AMBIL DATA PESANAN (Query sederhana anti-error)
        const { data: orders, error: dbError } = await supabase
            .from('gg_orders')
            .select('*')
            .eq('user_id', user.id) // Filter ketat khusus pesanan milik pengguna ini
            .order('created_at', { ascending: false });

        if (dbError) return res.status(500).json({ error: dbError.message });
        
        // Jika belum ada pesanan, kembalikan array kosong
        if (!orders || orders.length === 0) return res.status(200).json([]);

        // 5. AMBIL RINCIAN BARANGNYA
        const orderIds = orders.map(o => o.id);
        const { data: allItems, error: itemsError } = await supabase
            .from('gg_order_items')
            .select('*')
            .in('order_id', orderIds);

        if (itemsError) return res.status(500).json({ error: itemsError.message });

        // 6. GABUNGKAN DATA SECARA MANUAL (Menghindari error Foreign Key Supabase)
        const finalOrders = orders.map(order => ({
            ...order,
            items: allItems ? allItems.filter(item => item.order_id === order.id) : []
        }));

        // Kirim pesanan ke pesanan.html
        return res.status(200).json(finalOrders);

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server' });
    }
}
