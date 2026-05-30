import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Akses ditolak: Token hilang' });
    }
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return res.status(401).json({ error: 'Sesi tidak valid' });
        }

        // 1. Ambil Data Pesanan
        const { data: orders, error: dbError } = await supabase
            .from('gg_orders')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (dbError) return res.status(500).json({ error: dbError.message });
        if (!orders || orders.length === 0) return res.status(200).json([]);

        // 2. Ambil Rincian Item berdasarkan order_id
        const orderIds = orders.map(o => o.id);
        const { data: items, error: itemsError } = await supabase
            .from('gg_order_items')
            .select('*')
            .in('order_id', orderIds);

        if (itemsError) return res.status(500).json({ error: itemsError.message });

        // 3. Ambil Nama dan Gambar Produk dari tabel gg_products
        let products = [];
        if (items && items.length > 0) {
            const productIds = [...new Set(items.map(i => i.product_id))];
            const { data: prods, error: prodError } = await supabase
                .from('gg_products')
                .select('id, title, img')
                .in('id', productIds);
            
            if (!prodError && prods) products = prods;
        }

        // 4. Rakit datanya agar siap dihidangkan ke HTML
        const finalOrders = orders.map(order => {
            const orderItems = items ? items.filter(i => i.order_id === order.id) : [];
            
            const mappedItems = orderItems.map(item => {
                // Cocokkan product_id dengan data produk
                const productDetail = products.find(p => p.id == item.product_id) || {};
                return {
                    product_name: productDetail.title || 'Barang Grosir',
                    product_img: productDetail.img || '',
                    product_price: item.price_at_buy, // Membaca kolom baru price_at_buy
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
        return res.status(500).json({ error: 'Terjadi kesalahan server' });
    }
}
