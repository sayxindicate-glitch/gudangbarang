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

        const { shipping_address, phone_number, items, used_vouchers } = req.body;
        
        // SECURITY PATCH: Pastikan item adalah array dan tidak kosong
        if (!items || !Array.isArray(items) || items.length === 0) throw new Error('Keranjang kosong');

        // SECURITY 1: AMBIL HARGA ASLI DARI DATABASE, JANGAN PERCAYA BROWSER!
        const productIds = items.map(item => item.product_id);
        const { data: realProducts, error: prodError } = await supabase.from('gg_products')
            .select('id, price, promo_price, is_promo').in('id', productIds);
            
        if (prodError || !realProducts) throw new Error('Data barang gagal divalidasi');

        let serverCalculatedTotal = 0;
        const secureOrderItems = items.map(item => {
            const realProd = realProducts.find(p => p.id == item.product_id);
            if (!realProd) throw new Error(`Barang ID ${item.product_id} tidak valid.`);
            
            // SECURITY PATCH KRITIS: Cegah Kuantitas Minus & Pastikan berupa Angka
            const safeQty = parseInt(item.quantity);
            if (isNaN(safeQty) || safeQty <= 0) {
                throw new Error(`Kuantitas untuk barang ID ${item.product_id} tidak valid!`);
            }

            const finalItemPrice = (realProd.is_promo && realProd.promo_price) ? realProd.promo_price : realProd.price;
            serverCalculatedTotal += (finalItemPrice * safeQty);

            return {
                product_id: item.product_id,
                quantity: safeQty,
                price_at_buy: finalItemPrice.toString()
            };
        });

        // SECURITY 2: VALIDASI VOUCHER DAN HITUNG POTONGAN MURNI DI SERVER
        if (used_vouchers && Array.isArray(used_vouchers) && used_vouchers.length > 0) {
            const safeVoucherCode = String(used_vouchers[0]).toUpperCase().trim();
            const { data: voucher } = await supabase.from('gg_vouchers')
                .select('*').eq('code', safeVoucherCode).single();
                
            if (voucher && serverCalculatedTotal >= voucher.min_purchase) {
                let discount = voucher.discount_type === 'percent' 
                    ? (serverCalculatedTotal * parseFloat(voucher.discount_value)) 
                    : parseInt(voucher.discount_value);
                
                if (voucher.max_discount && discount > voucher.max_discount) {
                    discount = parseInt(voucher.max_discount);
                }
                serverCalculatedTotal -= discount;
            }
        }

        if (serverCalculatedTotal < 0) serverCalculatedTotal = 0;

        // SECURITY PATCH: Batasi panjang string untuk mencegah Database Overload (DoS)
        const safeAddress = String(shipping_address).substring(0, 500);
        const safePhone = String(phone_number).substring(0, 50);

        // 1. Buat Baris Pesanan Baru DENGAN HARGA HASIL HITUNGAN SERVER
        const { data: order, error: orderError } = await supabase.from('gg_orders').insert([{
            user_id: user.id,
            total_price: serverCalculatedTotal, // AMAN 100%
            shipping_address: `${safeAddress} (Telp: ${safePhone})`,
            status: 'Diproses'
        }]).select().single();

        // Menyembunyikan pesan error internal Supabase
        if (orderError) throw new Error('Gagal memproses pesanan di peladen');

        // 2. Pindahkan rincian barang belanjaan
        const orderItemsWithOrderId = secureOrderItems.map(i => ({ ...i, order_id: order.id }));
        const { error: itemsInsertError } = await supabase.from('gg_order_items').insert(orderItemsWithOrderId);
        if (itemsInsertError) throw new Error('Gagal mencatat rincian barang pesanan');

        // 3. Kosongkan keranjang belanja
        await supabase.from('gg_cart_items').delete().eq('user_id', user.id);

        // 4. LOCKING VOUCHER (Kunci voucher agar tidak bisa di-spam)
        if (used_vouchers && Array.isArray(used_vouchers) && used_vouchers.length > 0) {
            const claimedData = used_vouchers.map(code => ({
                user_id: user.id, voucher_code: String(code).toUpperCase().trim(), is_used: true
            }));
            await supabase.from('gg_claimed_vouchers').upsert(claimedData, { onConflict: 'user_id, voucher_code' });
        }

        return res.status(200).json({ message: 'Pesanan diverifikasi & dibuat', order_id: order.id });
    } catch (error) {
        console.error("Checkout API Error:", error);
        return res.status(400).json({ error: error.message || 'Terjadi kesalahan sistem' });
    }
}
