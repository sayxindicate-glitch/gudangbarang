import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Akses ditolak' });
    const token = authHeader.split(' ')[1];

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sesi tidak valid');

        const { shipping_address, phone_number, total_price, items, used_vouchers } = req.body;

        // 1. Buat Pesanan
        const { data: order, error: orderError } = await supabase
            .from('gg_orders')
            .insert([{
                user_id: user.id,
                user_name: user.user_metadata?.full_name || 'Pelanggan',
                shipping_address,
                phone_number,
                total_price,
                status: 'Diproses'
            }])
            .select()
            .single();

        if (orderError) throw orderError;

        // 2. Pindahkan barang dari keranjang ke pesanan
        const orderItems = items.map(item => ({
            order_id: order.id,
            product_id: item.product_id,
            product_name: item.product_name,
            product_price: item.product_price,
            product_img: item.product_img,
            quantity: item.quantity
        }));
        await supabase.from('gg_order_items').insert(orderItems);

        // 3. Bersihkan keranjang
        await supabase.from('gg_cart_items').delete().eq('user_id', user.id);

        // 4. MENGUNCI VOUCHER: Catat di database agar tidak bisa dipakai lagi
        if (used_vouchers && used_vouchers.length > 0) {
            const claimedData = used_vouchers.map(code => ({
                user_id: user.id,
                voucher_code: code
            }));
            await supabase.from('gg_claimed_vouchers').insert(claimedData);
        }

        return res.status(200).json({ message: 'Pesanan berhasil dibuat' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
