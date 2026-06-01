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
        const { data: orders, error: dbError } = await supabase.from('gg_orders')
            .select('*').eq('user_id', user.id).order('created_at', { ascending: false });
            
        // SECURITY PATCH: Menyamarkan pesan error asli dari Database Supabase
        if (dbError) throw new Error('Gagal memuat pesanan'); 
        
        if (!orders || orders.length === 0) return res.status(200).json([]);

        const orderIds = orders.map(o => o.id);
        
        // 2. Ambil rincian barang dari gg_order_items
        const { data: items, error: itemsError } = await supabase.from('gg_order_items')
            .select('*').in('order_id', orderIds);
            
        // SECURITY PATCH: Menyamarkan pesan error asli dari Database Supabase
        if (itemsError) throw new Error('Gagal memuat rincian pesanan');

        // 3. Tarik data dari gg_products berdasarkan product_id
        const productIds = [...new Set(items.map(i => i.product_id).filter(id => id != null))];
        let productsDict = {};
        
        if (productIds.length > 0) {
            // PERBAIKAN: Hanya panggil kolom yang benar-benar ada di tabel gg_products
            const { data: products, error: productError } = await supabase.from('gg_products')
                .select('id, title, img, price, promo_price').in('id', productIds);
                
            if (productError) {
                console.error("Gagal menarik data produk:", productError.message);
            } else if (products) {
                products.forEach(p => { productsDict[String(p.id)] = p; }); 
            }
        }

        // 4. Jahit / Gabungkan kembali datanya
        const finalOrders = orders.map(order => {
            const orderItems = items ? items.filter(i => i.order_id === order.id) : [];
            const mappedItems = orderItems.map(item => {
                const prod = productsDict[String(item.product_id)] || {}; 
                
                // PERBAIKAN: Format data 'price' dari database (misal: "Rp 650.000") menjadi angka murni
                let fallbackPrice = 0;
                if (prod.price) {
                    fallbackPrice = parseInt(prod.price.replace(/\D/g, '')) || 0;
                }
                
                return {
                    product_name: prod.title || 'Barang Grosir', // Ambil 'title' sesuai database
                    product_img: prod.img || '',                 // Ambil 'img' sesuai database
                    product_price: item.price_at_buy || fallbackPrice || 0, 
                    quantity: item.quantity
                };
            });

            return { ...order, items: mappedItems };
        });

        return res.status(200).json(finalOrders);

    } catch (error) {
        console.error("Orders API Error:", error);
        // SECURITY PATCH: Filter terakhir untuk memastikan tidak ada pesan error teknis yang bocor ke publik
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan internal server' });
    }
}
