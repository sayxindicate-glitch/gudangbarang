import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Akses ditolak' });
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return res.status(401).json({ error: 'Sesi tidak valid' });

        const { data: orders, error: dbError } = await supabase.from('gg_orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
        if (dbError) return res.status(500).json({ error: dbError.message });
        if (!orders || orders.length === 0) return res.status(200).json([]);

        const orderIds = orders.map(o => o.id);
        
        // PERBAIKAN UTAMA: Melakukan relasi (JOIN) ke tabel gg_products untuk mengambil nama & foto
        const { data: items, error: itemsError } = await supabase
            .from('gg_order_items')
            .select('*, gg_products(*)') 
            .in('order_id', orderIds);
            
        if (itemsError) return res.status(500).json({ error: itemsError.message });

        const finalOrders = orders.map(order => {
            const orderItems = items ? items.filter(i => i.order_id === order.id) : [];
            const mappedItems = orderItems.map(item => {
                // Menarik objek hasil JOIN dari gg_products
                const prod = item.gg_products || {}; 
                
                return {
                    // Cek nama dari database produk, jika tidak ada baru gunakan fallback
                    product_name: prod.product_name || prod.name || item.product_name || 'Barang Grosir',
                    // Cek foto dari database produk
                    product_img: prod.product_img || prod.image || prod.img_url || item.product_img || '',
                    // Gunakan price_at_buy sesuai dengan skema database Anda
                    product_price: item.price_at_buy || item.product_price || prod.price || 0, 
                    quantity: item.quantity
                };
            });

            return {
                ...order,
                items: mappedItems
            };
        });

        return res.status(200).json(finalOrders);

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan internal server' });
    }
}
