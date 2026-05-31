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

        const { shipping_address, items, used_vouchers } = req.body;
        if (!items || items.length === 0) throw new Error('Keranjang kosong');

        // 1. KEAMANAN FATAL: AMBIL HARGA ASLI DARI DATABASE, JANGAN PERCAYA BROWSER!
        const productIds = items.map(item => item.product_id);
        const { data: realProducts, error: prodError } = await supabase.from('gg_products').select('id, price, promo_price, is_promo').in('id', productIds);
        if (prodError || !realProducts) throw new Error('Data barang tidak valid');

        let serverCalculatedTotal = 0;
        const secureOrderItems = items.map(item => {
            const realProd = realProducts.find(p => p.id == item.product_id);
            if (!realProd) throw new Error(`Barang ID ${item.product_id} tidak ditemukan di gudang`);
            
            const finalItemPrice = (realProd.is_promo && realProd.promo_price) ? realProd.promo_price : realProd.price;
            serverCalculatedTotal += (finalItemPrice * item.quantity);

            return {
                product_id: item.product_id,
                quantity: item.quantity,
                price_at_buy: finalItemPrice.toString() // Disimpan aman berdasarkan DB
            };
        });

        // 2. VALIDASI VOUCHER DI SERVER-SIDE
        if (used_vouchers && used_vouchers.length > 0) {
            const { data: voucher } = await supabase.from('gg_vouchers').select('*').eq('code', used_vouchers[0].toUpperCase()).single();
            if (voucher && serverCalculatedTotal >= voucher.min_purchase) {
                let discount = voucher.discount_type === 'percent' 
                    ? (serverCalculatedTotal * parseFloat(voucher.discount_value)) 
                    : parseInt(voucher.discount_value);
                
                if (voucher.max_discount && discount > voucher.max_discount) discount = parseInt(voucher.max_discount);
                serverCalculatedTotal -= discount;
            }
        }

        if (serverCalculatedTotal < 0) serverCalculatedTotal = 0;

        // 3. INSERT PESANAN YANG SUDAH DIVALIDASI
        const { data: order, error: orderError } = await supabase.from('gg_orders').insert([{
            user_id: user.id,
            total_price: serverCalculatedTotal, // MENGGUNAKAN HASIL HITUNGAN SERVER
            shipping_address,
            status: 'Diproses'
        }]).select().single();

        if (orderError) throw orderError;

        // 4. MASUKKAN ITEMS & KUNCI VOUCHER
        const orderItemsWithOrderId = secureOrderItems.map(i => ({ ...i, order_id: order.id }));
        await supabase.from('gg_order_items').insert(orderItemsWithOrderId);
        await supabase.from('gg_cart_items').delete().eq('user_id', user.id);

        if (used_vouchers && used_vouchers.length > 0) {
            const claimedData = used_vouchers.map(code => ({ user_id: user.id, voucher_code: code, is_used: true }));
            await supabase.from('gg_claimed_vouchers').upsert(claimedData, { onConflict: 'user_id, voucher_code' });
        }

        return res.status(200).json({ message: 'Pesanan divalidasi dan dibuat', order_id: order.id });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan sistem' });
    }
}
