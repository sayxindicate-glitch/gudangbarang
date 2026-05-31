import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Sesi tidak valid' });
    const token = authHeader.split(' ')[1];

    const { code, total_price } = req.body;
    const subtotal = parseInt(total_price) || 0;

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return res.status(401).json({ error: 'Sesi tidak valid' });

        const upperCode = code.toUpperCase();

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

        if (subtotal < voucher.min_purchase) {
            return res.status(400).json({ error: `Minimal belanja Rp ${parseInt(voucher.min_purchase).toLocaleString('id-ID')} untuk pakai kode ini.` });
        }

        // 3. Eksekusi Rumus Perhitungan Diskon
        let discountAmount = 0;
        
        if (voucher.discount_type === 'percent') {
            discountAmount = subtotal * parseFloat(voucher.discount_value);
            if (voucher.max_discount && discountAmount > voucher.max_discount) discountAmount = parseInt(voucher.max_discount);
        } else if (voucher.discount_type === 'fixed') {
            discountAmount = parseInt(voucher.discount_value); 
        }

        if (discountAmount > subtotal) discountAmount = subtotal;
        const finalTotal = subtotal - discountAmount;

        return res.status(200).json({
            message: 'Promo berhasil divalidasi!',
            discount_amount: parseInt(discountAmount),
            final_total: parseInt(finalTotal)
        });

    } catch (error) {
        return res.status(500).json({ error: 'Terjadi kesalahan sistem' });
    }
}
