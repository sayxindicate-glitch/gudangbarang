import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak diizinkan' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Sesi tidak valid' });
    const token = authHeader.split(' ')[1];

    const { code, total_price } = req.body;
    const subtotal = parseInt(total_price);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return res.status(401).json({ error: 'Sesi tidak valid' });

        const upperCode = code.toUpperCase();

        // 1. Cek riwayat penggunaan di database gg_claimed_vouchers
        const { data: claimStatus } = await supabase
            .from('gg_claimed_vouchers')
            .select('is_used')
            .eq('user_id', user.id)
            .eq('voucher_code', upperCode)
            .maybeSingle();

        if (claimStatus && claimStatus.is_used) {
            return res.status(400).json({ error: 'Anda sudah pernah menggunakan promo ini sebelumnya.' });
        }

        // 2. Ambil spesifikasi voucher asli dari database
        const { data: voucher, error: vError } = await supabase.from('gg_vouchers').select('*').eq('code', upperCode).maybeSingle(); 
        if (vError || !voucher) return res.status(400).json({ error: 'Kode promo tidak ditemukan di database.' });

        // Cek Batas Kadaluarsa Tanggal
        if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Maaf, kode promo ini sudah kadaluarsa.' });
        }

        // Cek Syarat Minimal Belanja
        if (subtotal < voucher.min_purchase) {
            return res.status(400).json({ error: `Minimal belanja Rp ${parseInt(voucher.min_purchase).toLocaleString('id-ID')} untuk pakai kode ini.` });
        }

        // 3. Eksekusi Rumus Perhitungan Diskon (DIPERBAIKI MENYESUAIKAN SKEMA DATABASE)
        let discountAmount = 0;
        
        // Menggunakan voucher.discount_type dan voucher.discount_value
        if (voucher.discount_type === 'percent') {
            discountAmount = subtotal * parseFloat(voucher.discount_value);
            if (voucher.max_discount && discountAmount > voucher.max_discount) discountAmount = parseInt(voucher.max_discount);
        } else if (voucher.discount_type === 'fixed') {
            discountAmount = parseInt(voucher.discount_value); 
        }

        if (discountAmount > subtotal) discountAmount = subtotal;
        const finalTotal = subtotal - discountAmount;

        return res.status(200).json({
            message: 'Promo berhasil diterapkan!',
            discount_amount: parseInt(discountAmount),
            final_total: parseInt(finalTotal)
        });
    } catch (err) { 
        return res.status(500).json({ error: 'Terjadi kesalahan sistem kasir.' }); 
    }
}
