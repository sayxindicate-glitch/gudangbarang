import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Tidak ada akses' });
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { shipping_address, phone_number, total_price, items } = req.body;

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi tidak valid');

        // 1. Buat Induk Pesanan di gg_orders
        const { data: order, error: orderError } = await supabase.from('gg_orders').insert([{
            user_id: user.id,
            shipping_address,
            phone_number,
            total_price,
            status: 'Menunggu Pembayaran'
        }]).select().single();
        if (orderError) throw orderError;

        // 2. Masukkan rincian barang-barangnya ke gg_order_items
        const orderItemsData = items.map(item => ({
            order_id: order.id,
            product_id: item.product_id,
            product_name: item.product_name,
            product_price: item.product_price,
            product_img: item.product_img,
            quantity: item.quantity
        }));
        
        const { error: itemsError } = await supabase.from('gg_order_items').insert(orderItemsData);
        if (itemsError) throw itemsError;

        // 3. Kosongkan keranjang belanja karena sudah dicheckout
        const { error: deleteError } = await supabase.from('gg_cart_items').delete().eq('user_id', user.id);
        if (deleteError) throw deleteError;

        return res.status(200).json({ message: 'Checkout berhasil', order_id: order.id });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}