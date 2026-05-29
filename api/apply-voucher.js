import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    // Tambahan Keamanan: Cek Token User di Mesin Kasir
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Sesi tidak valid' });
    const token = authHeader.split(' ')[1];

    const { code, total_price } = req.body;
    const subtotal = parseInt(total_price);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user } } = await supabase.auth.getUser();

        // 1. CEK APAKAH KODE SUDAH PERNAH DIPAKAI SEBELUMNYA
        const { data: alreadyClaimed } = await supabase
            .from('gg_claimed_vouchers')
            .select('*')
            .eq('user_id', user.id)
            .eq('voucher_code', code.toUpperCase())
            .maybeSingle();

        if (alreadyClaimed) {
            return res.status(400).json({ error: 'Anda sudah pernah menggunakan promo ini sebelumnya.' });
        }

        // 2. Cek apakah kode ada di sistem promo
        const { data: voucher, error } = await supabase.from('gg_vouchers').select('*').eq('code', code.toUpperCase()).maybeSingle(); 
        if (error || !voucher) return res.status(400).json({ error: 'Kode promo tidak valid.' });
        if (subtotal < voucher.min_purchase) return res.status(400).json({ error: `Minimal belanja Rp ${parseInt(voucher.min_purchase).toLocaleString('id-ID')}` });

        // 3. Hitung Diskon
        let discountAmount = 0;
        if (voucher.type === 'percent') {
            discountAmount = subtotal * parseFloat(voucher.value);
            if (voucher.max_discount && discountAmount > voucher.max_discount) discountAmount = parseInt(voucher.max_discount);
        } else if (voucher.type === 'fixed') {
            discountAmount = parseInt(voucher.value); 
        }

        if (discountAmount > subtotal) discountAmount = subtotal;
        const finalTotal = subtotal - discountAmount;

        return res.status(200).json({
            message: 'Promo berhasil diterapkan!',
            discount_amount: parseInt(discountAmount),
            final_total: parseInt(finalTotal)
        });
    } catch (err) { return res.status(500).json({ error: 'Terjadi kesalahan sistem kasir.' }); }
}
