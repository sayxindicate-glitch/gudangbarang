import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Sesi tidak valid' });
    const token = authHeader.split(' ')[1];

    // Mengambil kode saja. total_price dari frontend diabaikan demi keamanan mutlak.
    const { code } = req.body; 

    // VALIDASI INPUT (Mencegah Server Crash akibat format tidak valid)
    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Format kode promo tidak valid.' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return res.status(401).json({ error: 'Sesi tidak valid' });

        const upperCode = code.trim().toUpperCase();

        // -------------------------------------------------------------------------
        // SECURITY PATCH: MENGHITUNG TOTAL BELANJA ASLI DARI DATABASE
        // -------------------------------------------------------------------------
        const { data: cartItems, error: cartError } = await supabase
            .from('gg_cart_items')
            .select('product_id, quantity')
            .eq('user_id', user.id);
        
        if (cartError) throw new Error('Gagal mengambil data keranjang');
        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ error: 'Keranjang belanja kosong.' });
        }

        const productIds = cartItems.map(item => item.product_id);
        const { data: realProducts, error: prodError } = await supabase
            .from('gg_products')
            .select('id, price, promo_price, is_promo')
            .in('id', productIds);

        if (prodError || !realProducts) throw new Error('Data barang gagal divalidasi');

        let realSubtotal = 0;
        cartItems.forEach(item => {
            const realProd = realProducts.find(p => p.id == item.product_id);
            // Pastikan quantity valid dan positif untuk mencegah underflow (minus)
            if (realProd && Number.isInteger(item.quantity) && item.quantity > 0) {
                const finalItemPrice = (realProd.is_promo && realProd.promo_price) ? realProd.promo_price : realProd.price;
                realSubtotal += (finalItemPrice * item.quantity);
            }
        });
        // -------------------------------------------------------------------------

        // 1. Cek riwayat penggunaan (Mencegah Spam / Abuse)
        const { data: claimStatus } = await supabase.from('gg_claimed_vouchers')
            .select('is_used').eq('user_id', user.id).eq('voucher_code', upperCode).maybeSingle();

        if (claimStatus && claimStatus.is_used) {
            return res.status(400).json({ error: 'Kode voucher ini sudah Anda gunakan sebelumnya.' });
        }

        // 2. Tarik Aturan Voucher
        const { data: voucher, error: vchError } = await supabase.from('gg_vouchers')
            .select('*').eq('code', upperCode).maybeSingle();

        if (vchError || !voucher) {
            return res.status(400).json({ error: 'Kode promo tidak valid atau tidak ditemukan.' });
        }

        if (voucher.max_usage !== null && voucher.used_count >= voucher.max_usage) {
            return res.status(400).json({ error: 'Kouta pemakaian promo ini sudah habis (Fully Claimed).' });
        }

        if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Maaf, kode promo ini sudah kadaluarsa.' });
        }

        // Menggunakan realSubtotal hasil hitungan server, bukan dari frontend
        if (realSubtotal < voucher.min_purchase) {
            return res.status(400).json({ error: `Minimal belanja Rp ${parseInt(voucher.min_purchase).toLocaleString('id-ID')} untuk pakai kode ini.` });
        }

        // 3. Eksekusi Rumus Perhitungan Diskon
        let discountAmount = 0;
        
        if (voucher.discount_type === 'percent') {
            discountAmount = realSubtotal * parseFloat(voucher.discount_value);
            if (voucher.max_discount && discountAmount > voucher.max_discount) {
                discountAmount = parseInt(voucher.max_discount);
            }
        } else if (voucher.discount_type === 'fixed') {
            discountAmount = parseInt(voucher.discount_value); 
        }

        if (discountAmount > realSubtotal) discountAmount = realSubtotal;
        const finalTotal = realSubtotal - discountAmount;

        return res.status(200).json({
            message: 'Promo berhasil divalidasi!',
            discount_amount: parseInt(discountAmount),
            final_total: parseInt(finalTotal)
        });

    } catch (error) {
        console.error("Apply Voucher API Error:", error);
        // Jangan ekspos pesan error database ke klien (Mencegah Information Disclosure)
        return res.status(500).json({ error: 'Terjadi kesalahan sistem internal.' });
    }
}
