import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    // Memaksa server agar tidak menyimpan cache (Anti Nyangkut)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

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

        // 1. Ambil data pesanan utama dari gg_orders
        const { data: orders, error: dbError } = await supabase.from('gg_orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
        if (dbError) return res.status(500).json({ error: dbError.message });
        if (!orders || orders.length === 0) return res.status(200).json([]);

        const orderIds = orders.map(o => o.id);
        
        // 2. Ambil rincian barang dari gg_order_items
        const { data: items, error: itemsError } = await supabase.from('gg_order_items').select('*').in('order_id', orderIds);
        if (itemsError) return res.status(500).json({ error: itemsError.message });

        // 3. Tarik data dari gg_products berdasarkan product_id
        const productIds = [...new Set(items.map(i => i.product_id).filter(id => id != null))];
        let productsDict = {};
        
        if (productIds.length > 0) {
            const { data: products } = await supabase.from('gg_products').select('*').in('id', productIds);
            if (products) {
                products.forEach(p => { productsDict[String(p.id)] = p; }); 
            }
        }

        // 4. Jahit / Gabungkan kembali datanya
        const finalOrders = orders.map(order => {
            const orderItems = items ? items.filter(i => i.order_id === order.id) : [];
            const mappedItems = orderItems.map(item => {
                const prod = productsDict[String(item.product_id)] || {}; 
                
                return {
                    // PERBAIKAN: Menarik "title" agar akurat dengan database produk
                    product_name: prod.title || prod.product_name || prod.name || 'Barang Grosir',
                    // PERBAIKAN: Menarik "img"
                    product_img: prod.img || prod.product_img || prod.image || prod.img_url || '',
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
