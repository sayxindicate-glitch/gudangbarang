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

        // 1. Buat Baris Pesanan Baru (Sesuai Skema gg_orders)
        const { data: order, error: orderError } = await supabase
            .from('gg_orders')
            .insert([{
                user_id: user.id,
                total_price,
                shipping_address,
                status: 'Diproses'
            }])
            .select()
            .single();

        if (orderError) throw orderError;

        // 2. Pindahkan rincian barang belanjaan (SINKRON DENGAN SKEMA gg_order_items)
        const orderItems = items.map(item => ({
            order_id: order.id,
            product_id: item.product_id,
            quantity: item.quantity,
            price_at_buy: item.product_price.toString() // Disimpan sbg text sesuai struktur DB
        }));
        
        const { error: itemsInsertError } = await supabase.from('gg_order_items').insert(orderItems);
        if (itemsInsertError) throw itemsInsertError;

        // 3. Kosongkan keranjang belanja
        await supabase.from('gg_cart_items').delete().eq('user_id', user.id);

        // 4. LOCKING VOUCHER
        if (used_vouchers && used_vouchers.length > 0) {
            const claimedData = used_vouchers.map(code => ({
                user_id: user.id,
                voucher_code: code,
                is_used: true
            }));
            await supabase.from('gg_claimed_vouchers').upsert(claimedData, { onConflict: 'user_id, voucher_code' });
        }

        return res.status(200).json({ message: 'Pesanan berhasil dibuat', order_id: order.id });

    } catch (error) {
        console.error("Checkout Error:", error);
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan sistem' });
    }
}
