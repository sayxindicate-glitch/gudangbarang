import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Akses ditolak' });
    const token = authHeader.split(' ')[1];

    // Client 1: Mengecek Sesi User secara aman (Kunci Biasa)
    const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
        if (authError || !user) return res.status(401).json({ error: 'Sesi tidak valid' });

        // Client 2: KUNCI MASTER (Service Role) - Digunakan khusus untuk menembus RLS dan menarik relasi produk
        const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        // Supabase Magic JOIN: Menarik Pesanan, Rincian Barang, dan Info Produk sekaligus!
        const { data: orders, error: dbError } = await supabaseAdmin
            .from('gg_orders')
            .select(`
                *,
                gg_order_items (
                    id, quantity, price_at_buy, product_id,
                    gg_products ( id, product_name, product_img )
                )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (dbError) throw dbError;
        if (!orders || orders.length === 0) return res.status(200).json([]);

        // Merapikan format JSON agar sesuai standar bacaan pesanan.html
        const finalOrders = orders.map(order => {
            const items = order.gg_order_items || [];
            
            const formattedItems = items.map(item => {
                const prod = item.gg_products || {};
                return {
                    product_id: item.product_id,
                    // Tarik nama dari relasi tabel produk
                    product_name: prod.product_name || 'Barang Grosir',
                    // Tarik gambar dari relasi tabel produk
                    product_img: prod.product_img || '',
                    // Gunakan harga asli saat dibeli
                    product_price: item.price_at_buy || 0,
                    quantity: item.quantity
                };
            });

            // Hapus properti bawaan Supabase agar output lebih bersih
            delete order.gg_order_items; 
            
            return {
                ...order,
                items: formattedItems
            };
        });

        return res.status(200).json(finalOrders);

    } catch (error) {
        console.error("Fetch Orders Error:", error);
        return res.status(500).json({ error: 'Gagal memperoleh data secara akurat' });
    }
}
