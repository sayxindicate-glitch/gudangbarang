import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Akses ditolak' });
    const token = authHeader.split(' ')[1];

    // Gunakan Kunci Master untuk menembus RLS
    const supabase = createClient(
        process.env.SUPABASE_URL, 
        process.env.SUPABASE_SERVICE_ROLE_KEY // Menggunakan kunci sakti
    );

    try {
        // Validasi user via token
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Sesi tidak valid' });

        // AMBIL PESANAN & JOIN KE ITEMS & PRODUK
        // Catatan: Pastikan 'gg_products' memiliki relasi dengan 'gg_order_items' di Supabase
        const { data: orders, error: dbError } = await supabase
            .from('gg_orders')
            .select(`
                *,
                gg_order_items (
                    id, quantity, price_at_buy, product_id,
                    gg_products ( id, title, img )
                )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (dbError) throw dbError;

        // FORMAT DATA UNTUK FRONTEND
        const finalOrders = orders.map(order => ({
            ...order,
            items: order.gg_order_items.map(item => ({
                product_name: item.gg_products?.title || 'Barang Grosir',
                product_img: item.gg_products?.img || '',
                product_price: item.price_at_buy || 0,
                quantity: item.quantity
            }))
        }));

        return res.status(200).json(finalOrders);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
