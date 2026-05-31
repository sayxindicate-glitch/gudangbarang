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

        const upperCode = String(code).toUpperCase().trim();

        // 1. Cek riwayat penggunaan (Mencegah Spam)
        const { data: claimStatus } = await supabase.from('gg_claimed_vouchers')
            .select('is_used').eq('user_id', user.id).eq('voucher_code', upperCode).maybeSingle();

        if (claimStatus && claimStatus.is_used) {
            return res.status(400).json({ error: 'Kode voucher ini sudah Anda gunakan sebelumnya.' });
        }

        // 2. Tarik Aturan Voucher dari Database
        const { data: voucher, error: vchError } = await supabase.from('gg_vouchers')
            .select('*').eq('code', upperCode).maybeSingle();

        if (vchError || !voucher) {
            return res.status(400).json({ error: 'Kode promo tidak valid atau tidak ditemukan.' });
        }

        // Cek Kadaluarsa
        if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Maaf, kode promo ini sudah kadaluarsa.' });
        }

        // Cek Syarat Minimal Belanja
        const minPurchase = parseInt(voucher.min_purchase) || 0;
        if (subtotal < minPurchase) {
            return res.status(400).json({ error: `Minimal belanja Rp ${minPurchase.toLocaleString('id-ID')} untuk pakai kode ini.` });
        }

        // 3. Eksekusi Rumus Perhitungan Diskon (TANGGUH & ANTI-GAGAL)
        let discountAmount = 0;
        
        // Standarisasi format tipe (membersihkan spasi & huruf besar yang mungkin masuk ke database)
        const dType = String(voucher.discount_type || '').trim().toLowerCase();
        let dValue = parseFloat(voucher.discount_value) || 0;
        
        if (dType === 'percent' || dType === 'persen') {
            // Konversi pintar: Jika admin ketik 50 (maksudnya 50%), otomatis jadi 0.5
            if (dValue >= 1 && dValue <= 100) {
                dValue = dValue / 100;
            }
            
            discountAmount = subtotal * dValue;
            
            const maxDisc = parseInt(voucher.max_discount) || 0;
            if (maxDisc > 0 && discountAmount > maxDisc) {
                discountAmount = maxDisc;
            }
        } else if (dType === 'fixed' || dType === 'nominal') {
            discountAmount = dValue; 
        }

        // Keamanan tambahan: Diskon tidak boleh melebihi total belanja (menghindari hasil minus)
        if (discountAmount > subtotal) {
            discountAmount = subtotal;
        }
        
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
