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

        // PERHATIKAN: Kita membuang 'total_price' dari browser, kita hanya menerima 'items'
        const { shipping_address, phone_number, items, used_vouchers } = req.body;
        if (!items || items.length === 0) throw new Error('Keranjang kosong');

        // =========================================================================
        // SECURITY 1: MENGHITUNG ULANG HARGA ASLI DARI GUDANG DATABASE
        // =========================================================================
        const productIds = items.map(item => item.product_id);
        const { data: realProducts, error: prodError } = await supabase.from('gg_products')
            .select('id, price, promo_price, is_promo').in('id', productIds);
            
        if (prodError || !realProducts) throw new Error('Data barang gagal divalidasi');

        let serverCalculatedTotal = 0;
        const secureOrderItems = items.map(item => {
            const realProd = realProducts.find(p => p.id == item.product_id);
            if (!realProd) throw new Error(`Barang ID ${item.product_id} tidak valid.`);
            
            const finalItemPrice = (realProd.is_promo && realProd.promo_price) ? realProd.promo_price : realProd.price;
            serverCalculatedTotal += (finalItemPrice * item.quantity);

            return {
                product_id: item.product_id,
                quantity: item.quantity,
                price_at_buy: finalItemPrice.toString() // Disimpan sbg text, tapi HARGA DARI SERVER
            };
        });

        // =========================================================================
        // SECURITY 2: VALIDASI VOUCHER & DISKON DI SERVER (SINKRON DENGAN SKEMA BARU)
        // =========================================================================
        if (used_vouchers && used_vouchers.length > 0) {
            const { data: voucher } = await supabase.from('gg_vouchers')
                .select('*').eq('code', used_vouchers[0].toUpperCase()).single();
                
            if (voucher) {
                const minPurchase = parseInt(voucher.min_purchase) || 0;
                
                // Cek syarat belanja
                if (serverCalculatedTotal >= minPurchase) {
                    let discountAmount = 0;
                    const dType = String(voucher.discount_type || '').trim().toLowerCase();
                    let dValue = parseFloat(voucher.discount_value) || 0;

                    if (dType === 'percent' || dType === 'persen') {
                        if (dValue >= 1 && dValue <= 100) dValue = dValue / 100;
                        discountAmount = serverCalculatedTotal * dValue;
                        const maxDisc = parseInt(voucher.max_discount) || 0;
                        if (maxDisc > 0 && discountAmount > maxDisc) discountAmount = maxDisc;
                    } else if (dType === 'fixed' || dType === 'nominal') {
                        discountAmount = dValue; 
                    }

                    if (discountAmount > serverCalculatedTotal) discountAmount = serverCalculatedTotal;
                    serverCalculatedTotal -= discountAmount;
                }
            }
        }

        if (serverCalculatedTotal < 0) serverCalculatedTotal = 0;

        // =========================================================================
        // 3. EKSEKUSI PENYIMPANAN KE DATABASE DENGAN HARGA YANG SUDAH AMAN
        // =========================================================================
        const { data: order, error: orderError } = await supabase.from('gg_orders').insert([{
            user_id: user.id,
            total_price: serverCalculatedTotal, // AMAN 100%: Dihitung oleh server
            shipping_address: `${shipping_address} (Telp: ${phone_number})`,
            status: 'Diproses'
        }]).select().single();

        if (orderError) throw orderError;

        // 4. Masukkan items ke tabel gg_order_items
        const orderItemsWithOrderId = secureOrderItems.map(i => ({ ...i, order_id: order.id }));
        const { error: itemsInsertError } = await supabase.from('gg_order_items').insert(orderItemsWithOrderId);
        if (itemsInsertError) throw itemsInsertError;

        // 5. Kosongkan keranjang belanja
        await supabase.from('gg_cart_items').delete().eq('user_id', user.id);

        // 6. Kunci Voucher agar tidak bisa dipakai 2x
        if (used_vouchers && used_vouchers.length > 0) {
            const claimedData = used_vouchers.map(code => ({
                user_id: user.id, voucher_code: code, is_used: true
            }));
            await supabase.from('gg_claimed_vouchers').upsert(claimedData, { onConflict: 'user_id, voucher_code' });
        }

        return res.status(200).json({ message: 'Pesanan diverifikasi & dibuat', order_id: order.id });

    } catch (error) {
        console.error("Checkout Error:", error);
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan sistem' });
    }
}
