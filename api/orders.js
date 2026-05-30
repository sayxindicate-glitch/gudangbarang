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

        // 1. Ambil data pesanan utama
        const { data: orders, error: dbError } = await supabase.from('gg_orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
        if (dbError) return res.status(500).json({ error: dbError.message });
        if (!orders || orders.length === 0) return res.status(200).json([]);

        const orderIds = orders.map(o => o.id);
        
        // 2. Ambil item-item pesanan
        const { data: items, error: itemsError } = await supabase.from('gg_order_items').select('*').in('order_id', orderIds);
        if (itemsError) return res.status(500).json({ error: itemsError.message });

        // 3. TEKNIK MANUAL JOIN: Ambil data nama & foto produk secara paksa dari gg_products
        const productIds = [...new Set(items.map(i => i.product_id))];
        let productsDict = {};
        if (productIds.length > 0) {
            const { data: products } = await supabase.from('gg_products').select('*').in('id', productIds);
            if (products) {
                products.forEach(p => { productsDict[p.id] = p; });
            }
        }

        // 4. Rakit kembali datanya untuk dikirim ke pesanan.html
        const finalOrders = orders.map(order => {
            const orderItems = items ? items.filter(i => i.order_id === order.id) : [];
            const mappedItems = orderItems.map(item => {
                const prod = productsDict[item.product_id] || {}; 
                
                return {
                    product_name: prod.product_name || prod.name || 'Barang Grosir',
                    product_img: prod.product_img || prod.image || prod.img_url || '',
                    product_price: item.price_at_buy || prod.product_price || prod.price || 0, 
                    quantity: item.quantity
                };
            });

            return { ...order, items: mappedItems };
        });

        return res.status(200).json(finalOrders);

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: 'Terjadi kesalahan internal server' });
    }
}
