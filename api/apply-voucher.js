import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const { code, total_price } = req.body;
    const subtotal = parseInt(total_price);

    // Buka koneksi server ke database Supabase
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    try {
        // 1. Cek langsung ke tabel gg_vouchers di Database
        const { data: voucher, error } = await supabase
            .from('gg_vouchers')
            .select('*')
            .eq('code', code.toUpperCase())
            .maybeSingle(); 

        if (error || !voucher) {
            return res.status(400).json({ error: 'Kode promo tidak valid atau tidak ditemukan.' });
        }

        // 2. Cek Aturan Minimal Belanja
        if (subtotal < voucher.min_purchase) {
            return res.status(400).json({ error: `Minimal belanja Rp ${parseInt(voucher.min_purchase).toLocaleString('id-ID')} untuk pakai kode ini.` });
        }

        // 3. Hitung Kalkulasi Nilai Diskon
        let discountAmount = 0;
        const voucherValue = parseFloat(voucher.value);

        if (voucher.type === 'percent') {
            discountAmount = subtotal * voucherValue;
            // Jika ada batas maksimal diskon (cap)
            if (voucher.max_discount && discountAmount > voucher.max_discount) {
                discountAmount = parseInt(voucher.max_discount);
            }
        } else if (voucher.type === 'fixed') {
            discountAmount = parseInt(voucher.value); 
        }

        // Amankan nilai agar total tagihan tidak menjadi minus
        if (discountAmount > subtotal) discountAmount = subtotal;
        const finalTotal = subtotal - discountAmount;

        return res.status(200).json({
            message: 'Promo berhasil digunakan!',
            discount_amount: parseInt(discountAmount),
            final_total: parseInt(finalTotal)
        });

    } catch (err) {
        return res.status(500).json({ error: 'Terjadi kesalahan sistem database kasir.' });
    }
}
